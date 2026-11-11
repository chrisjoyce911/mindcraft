// Motion owns the pathfinder (design §4): abort = setGoal(null) once (ends goto() at once, the
// fix-round4 lesson) + stopDigging + clearControlStates, and the call resolves {ok:false,
// reason:'cancelled'}. Nothing else in the bot calls pathfinder.goto or setGoal.
import { fail, OK, type Outcome } from '../types/index.js';
import { withTimeout, timedOut } from './abort.js';

/** The part of a mineflayer bot Motion uses (a fake in tests). */
export interface MotionBot {
    pathfinder: { goto(goal: unknown): Promise<unknown>; setGoal(goal: unknown | null, dynamic?: boolean): void };
    stopDigging(): void;
    clearControlStates(): void;
}

export interface GoToOptions { timeoutMs?: number }

export class Motion {
    /** how many times the goal was cleared by an abort (tests) */
    cleared = 0;
    constructor(private readonly bot: MotionBot, private readonly defaultTimeoutMs = 60000) {}

    /** stop: clear the goal and controls now (the lease's body reset uses this too). */
    stop(): void {
        this.cleared++;
        try { this.bot.pathfinder.setGoal(null); } catch { /* not pathing */ }
        try { this.bot.stopDigging(); } catch { /* not digging */ }
        try { this.bot.clearControlStates(); } catch { /* best effort */ }
    }

    goTo(goal: unknown, signal: AbortSignal, opts: GoToOptions = {}): Promise<Outcome> {
        if (signal.aborted) return Promise.resolve(fail('cancelled'));
        const t = withTimeout(opts.timeoutMs ?? this.defaultTimeoutMs, signal);
        return new Promise<Outcome>(resolve => {
            let done = false;
            const finish = (o: Outcome) => { if (done) return; done = true; t.dispose(); t.signal.removeEventListener('abort', onAbort); resolve(o); };
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
