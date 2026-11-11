// BodyLease: at most one runner (a job step or a director activity) holds the body (design §4).
// Taking the lease aborts the holder's signal and waits for it to settle; a holder that hasn't
// settled after overrunMs (default 2 s) loses the lease anyway: the body is reset, a stop-overrun
// event is logged naming the runner, and its late result is ignored. Never a process exit.

export type Runner<T> = (signal: AbortSignal) => Promise<T>;
export type Settled<T> = { how: 'settled'; value: T } | { how: 'threw'; error: unknown } | { how: 'overrun' };

export interface LeaseEvent { event: 'stop-overrun'; runner: string; waitedMs: number }

export interface LeaseOptions {
    overrunMs?: number;
    resetBody?: () => void;              // clearControlStates, setGoal(null), stopDigging, pvp.stop
    log?: (e: LeaseEvent) => void;
    /** Told after the holder changes (taken or freed): the harness pushes the state at once (5.6). Never throws into the lease. */
    onHolder?: (name: string | null) => void;
    now?: () => number;
}

interface Holder { name: string; controller: AbortController; settled: Promise<void>; id: number; overran: () => void }

export interface Held<T> {
    name: string;
    /** the runner's result; 'overrun' when it lost the lease without settling */
    result: Promise<Settled<T>>;
}

export class BodyLease {
    private holder: Holder | null = null;
    private queue: Promise<unknown> = Promise.resolve();
    private seq = 0;
    readonly overrunMs: number;
    private readonly resetBody: () => void;
    private readonly log: (e: LeaseEvent) => void;
    private readonly now: () => number;
    private readonly onHolder: (name: string | null) => void;

    constructor(opts: LeaseOptions = {}) {
        this.onHolder = opts.onHolder ?? (() => {});
        this.overrunMs = opts.overrunMs ?? 2000;
        this.resetBody = opts.resetBody ?? (() => {});
        this.log = opts.log ?? (() => {});
        this.now = opts.now ?? Date.now;
    }

    /** the name of the runner holding the body, or null when free */
    get holderName(): string | null { return this.holder?.name ?? null; }
    get isFree(): boolean { return this.holder === null; }

    /**
     * take: stop the current holder (bounded), then start run as the new holder. Resolves once the
     * new runner holds the body. Calls are serialised in order.
     */
    take<T>(name: string, run: Runner<T>): Promise<Held<T>> {
        const next = this.queue.then(async () => {
            await this.stopHolder();
            return this.start(name, run);
        });
        this.queue = next.catch(() => {});
        return next;
    }

    /** release: stop the current holder (bounded); the body is free afterwards. */
    release(): Promise<void> {
        const next = this.queue.then(() => this.stopHolder());
        this.queue = next.catch(() => {});
        return next;
    }

    private start<T>(name: string, run: Runner<T>): Held<T> {
        const controller = new AbortController();
        const id = ++this.seq;
        let overran!: () => void;
        const overrun = new Promise<Settled<T>>(r => { overran = () => r({ how: 'overrun' }); });
        // the holder is recorded before the runner starts: its first (synchronous) body call is already
        // under the lease
        const holder: Holder = { name, controller, settled: Promise.resolve(), id, overran };
        this.holder = holder;
        this.changed();
        let runP: Promise<T>;
        try { runP = run(controller.signal); } catch (error) { runP = Promise.reject(error); }
        const own: Promise<Settled<T>> = runP.then(
            value => ({ how: 'settled', value }) as Settled<T>,
            error => ({ how: 'threw', error }) as Settled<T>,
        );
        holder.settled = own.then(() => {
            // a runner that ends by itself frees the body (unless it already lost it)
            if (this.holder?.id === id) { this.holder = null; this.changed(); }
        });
        return { name, result: Promise.race([own, overrun]) };
    }

    private async stopHolder(): Promise<void> {
        const h = this.holder;
        if (!h) return;
        const t0 = this.now();
        h.controller.abort();
        let timer: NodeJS.Timeout | undefined;
        const late = await Promise.race([
            h.settled.then(() => false),
            new Promise<boolean>(r => { timer = setTimeout(() => r(true), this.overrunMs); }),
        ]);
        clearTimeout(timer);
        if (late) {
            try { this.resetBody(); } catch { /* best effort */ }
            this.log({ event: 'stop-overrun', runner: h.name, waitedMs: this.now() - t0 });
            h.overran();
        }
        if (this.holder?.id === h.id) { this.holder = null; this.changed(); }
    }

    private changed(): void { try { this.onHolder(this.holderName); } catch { /* never stops the lease */ } }
}
