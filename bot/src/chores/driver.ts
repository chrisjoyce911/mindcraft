// Starting chores (5.6; the old agent._startChore): the director answered idle with nothing on the stack (its onIdle).
// A run starts only when chores are on, nothing is being chosen or runs, the stack is empty, the body is free, the 4.3
// restore has run (a chore-only stack removes the saved job file: it must be read first), no player's !stop holds
// chores (CHORES_HOLD_MS, until chores are turned on again) and no player's command came in the last PLAYER_GAP_MS. The
// run goes on the stack as a job of origin chore (never saved to laya-job.json); when it leaves the stack (done,
// failed, a player's command, stop, death) its run line is written. A safety activity pauses and resumes it: the
// same run goes on.
import type { JobEnd, JobSpec } from '../types/index.js';
import type { ChoreRun } from './chores.js';

/** A player's !stop holds chores this long (the old CHORES_HOLD_MS). */
export const CHORES_HOLD_MS = 5 * 60_000;
/** No chore starts this soon after a player's command (the old PLAYER_GAP_MS). */
export const PLAYER_GAP_MS = 3000;

/** What the driver needs of the director (structural: chores sit below the director). */
export interface ChoreDirector {
    readonly stack: { readonly depth: number; job(): { origin: string } | null };
    startJob(spec: JobSpec, origin: 'chore', progress: object, by: undefined, opts: { label: string }): Promise<object | null>;
    ended(entry: never): Promise<JobEnd>;
    stop(): Promise<void>;
}

export interface ChoreSource {
    readonly on: boolean;
    next(): Promise<ChoreRun | null>;
    ended(run: ChoreRun, end: JobEnd): unknown;
}

export interface DriverDeps {
    chores: ChoreSource;
    /** The body is free (no lease held). */
    free(): boolean;
    note(text: string): void;
    now?: () => number;
}

export class ChoreDriver {
    /** The 4.3 restore has run for the current director. */
    restored = false;
    private holdUntil = 0;
    private playerAt = 0;
    private choosing: object | null = null;
    /** The run on the stack, or null. */
    current: ChoreRun | null = null;
    private readonly now: () => number;

    constructor(private readonly d: DriverDeps) { this.now = d.now ?? Date.now; }

    /** playerCommand: a player's command came (stop: chores are held for CHORES_HOLD_MS). */
    playerCommand(stop = false): void {
        this.playerAt = this.now();
        if (stop) this.holdUntil = this.now() + CHORES_HOLD_MS;
    }

    /** turnedOn: chores were turned on or off: the hold and the gap end. */
    turned(): void { this.holdUntil = 0; this.playerAt = 0; }

    /** busy: a run is being chosen or is on the stack. */
    get busy(): boolean { return this.choosing !== null; }

    /** canStart: every gate open now. */
    canStart(dir: ChoreDirector): boolean {
        const t = this.now();
        return !this.choosing && this.d.chores.on && this.restored && dir.stack.depth === 0 && this.d.free()
            && t >= this.holdUntil && t - this.playerAt >= PLAYER_GAP_MS;
    }

    /** idle: the director's onIdle: ask for the next run and start it; resolves when the run has left the stack. */
    async idle(dir: ChoreDirector, current: () => ChoreDirector | null = () => dir): Promise<void> {
        if (!this.canStart(dir)) return;
        const slot = {};
        this.choosing = slot;
        try {
            const at = this.playerAt;
            const run = await this.d.chores.next();
            // something started while it asked (a player's command, a new director): don't start it
            if (!run || current() !== dir || !this.d.chores.on || dir.stack.depth > 0 || !this.d.free() || this.playerAt !== at) return;
            const entry = await dir.startJob(run.spec, 'chore', {}, undefined, { label: run.label });
            if (!entry) { this.d.chores.ended(run, { how: 'failed', reason: 'stuck' }); return; }
            this.current = run;
            const end = await dir.ended(entry as never);
            this.current = null;
            this.d.chores.ended(run, end);
        } catch (e) {
            this.d.note(`chores: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
            if (this.choosing === slot) this.choosing = null;
            this.current = null;
        }
    }

    /** off: chores turned off: a chore on the stack stops (a player's job runs on). */
    async off(dir: ChoreDirector | null): Promise<void> {
        if (dir?.stack.job()?.origin === 'chore') await dir.stop();
    }
}
