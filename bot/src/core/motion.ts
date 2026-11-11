// Motion owns the pathfinder (design §4): abort = setGoal(null) once (ends goto() at once, the
// fix-round4 lesson) + stopDigging + clearControlStates, and the call resolves {ok:false,
// reason:'cancelled'}. Nothing else in the bot calls pathfinder.goto or setGoal.
import { fail, OK, type Outcome } from '../types/index.js';
import { withTimeout, timedOut } from './abort.js';

/** The part of a mineflayer bot Motion uses (a fake in tests). */
export interface MotionBot {
    pathfinder: {
        goto(goal: unknown): Promise<unknown>; setGoal(goal: unknown | null, dynamic?: boolean): void;
        /** The movements in use (a live pathfinder has them; the safe goTo swaps them and puts them back). */
        movements?: unknown; setMovements?(m: unknown): void;
    };
    stopDigging(): void;
    clearControlStates(): void;
}

export interface GoToOptions {
    timeoutMs?: number;
    /**
     * safe: the safe movements for this goTo (the old skills.safeMovements: never off a drop of more than 3 blocks,
     * no parkour, liquids cost 100 and no digging that lets them flow); the previous movements come back after,
     * also on an abort or a timeout.
     */
    safe?: boolean;
}

/** sleepFor resolves true after ms, false as soon as the signal aborts (never rejects). */
function sleepFor(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve(false);
        const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, ms);
        const onAbort = () => { clearTimeout(timer); resolve(false); };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

export class Motion {
    /** how many times the goal was cleared by an abort (tests) */
    cleared = 0;
    private inFlight = 0;
    /** moving: a goTo is in flight (the stuck watch counts only then). */
    get moving(): boolean { return this.inFlight > 0; }
    /** safeMovements builds the safe movements (body.ts: pathfinder Movements; null: a safe goTo uses the current ones). */
    constructor(private readonly bot: MotionBot, private readonly defaultTimeoutMs = 60000, private readonly safeMovements: (() => unknown) | null = null) {}

    /** stop: clear the goal and controls now (the lease's body reset uses this too). */
    stop(): void {
        this.cleared++;
        try { this.bot.pathfinder.setGoal(null); } catch { /* not pathing */ }
        try { this.bot.stopDigging(); } catch { /* not digging */ }
        try { this.bot.clearControlStates(); } catch { /* best effort */ }
    }

    /**
     * moveFor: chase a dynamic goal (a GoalFollow, an inverted one) for ms, then clear it: the old
     * defend actions' bounded move. ok after ms; cancelled (goal cleared at once) on abort.
     */
    async moveFor(goal: unknown, ms: number, signal: AbortSignal): Promise<Outcome> {
        if (signal.aborted) return fail('cancelled');
        this.inFlight++;
        try {
            try { this.bot.pathfinder.setGoal(goal, true); } catch (e) { return fail('error', String(e)); }
            const ran = await sleepFor(ms, signal);
            try { this.bot.pathfinder.setGoal(null); } catch { /* not pathing */ }
            if (!ran) { this.stop(); return fail('cancelled'); }
            return OK;
        } finally { this.inFlight--; }
    }

    /**
     * moveUntil: set a fixed goal and poll every 50 ms until done() or ms (the follow step: GoalXZ until the
     * bot stands in that column). ok when done; stuck after ms (the goal is cleared); cancelled on abort.
     */
    async moveUntil(goal: unknown, ms: number, done: () => boolean, signal: AbortSignal): Promise<Outcome> {
        if (signal.aborted) return fail('cancelled');
        this.inFlight++;
        try {
            try { this.bot.pathfinder.setGoal(goal); } catch (e) { return fail('error', String(e)); }
            const end = Date.now() + ms;
            while (Date.now() < end) {
                if (!(await sleepFor(50, signal))) { this.stop(); return fail('cancelled'); }
                if (done()) return OK;
            }
            try { this.bot.pathfinder.setGoal(null); } catch { /* not pathing */ }
            return fail('stuck');
        } finally { this.inFlight--; }
    }

    goTo(goal: unknown, signal: AbortSignal, opts: GoToOptions = {}): Promise<Outcome> {
        if (signal.aborted) return Promise.resolve(fail('cancelled'));
        const t = withTimeout(opts.timeoutMs ?? this.defaultTimeoutMs, signal);
        this.inFlight++;
        const pf = this.bot.pathfinder;
        const swap = !!opts.safe && !!this.safeMovements && typeof pf.setMovements === 'function';
        const prev = swap ? pf.movements : undefined;
        if (swap) { try { pf.setMovements!(this.safeMovements!()); } catch { /* the current ones then */ } }
        const restore = () => { if (swap && prev) { try { pf.setMovements!(prev); } catch { /* best effort */ } } };
        return new Promise<Outcome>(resolve => {
            let done = false;
            const finish = (o: Outcome) => { if (done) return; done = true; this.inFlight--; restore(); t.dispose(); t.signal.removeEventListener('abort', onAbort); resolve(o); };
            const onAbort = () => { if (done) return; this.stop(); finish(timedOut(t.signal) ? fail('timeout') : fail('cancelled')); };
            t.signal.addEventListener('abort', onAbort, { once: true });
            this.bot.pathfinder.goto(goal).then(
                () => finish(OK),
                (e: unknown) => finish(classifyPathError(e)),
            );
        });
    }
}

export function classifyPathError(e: unknown): Outcome {
    const name = e instanceof Error ? e.name : '';
    const msg = e instanceof Error ? e.message : String(e);
    if (name === 'NoPath' || /no path/i.test(msg)) return fail('no-path', msg);
    if (name === 'GoalChanged' || /goal was changed/i.test(msg)) return fail('cancelled', msg);
    if (/timeout|took to long/i.test(msg)) return fail('timeout', msg);
    return fail('unreachable', msg);
}
