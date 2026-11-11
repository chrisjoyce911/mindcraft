// A stoppable run: the work of a Laya job or chore returns within STOP_MS of
// an interrupt, even when a skill under it doesn't (a pathfinder wait or a
// collect that never settles). Mindcraft's ActionManager kills the process
// when an action refuses to stop for 10 s (live play 3, 2026-11-11: an
// interrupted "collect 4 coal" → exit 1 → restart, job lost).
//
// The work runs under a {cancelled} token (AsyncLocalStorage). Once the run
// has given up on it (an interrupt, or it ended), the token is cancelled:
// skills that check stopped(bot) in their loops stop at the next check,
// instead of carrying on in the background after the interrupt has cleared
// (the next action clears bot.interrupt_code).

import { AsyncLocalStorage } from 'async_hooks';

const RUN = new AsyncLocalStorage();
export const STOP_MS = 100;

// stopped: the bot was interrupted, or the run this code belongs to was
// given up on.
// A run inside another (a chore inside its job) is given up on with it.
export const cancelledRun = () => { for (let t = RUN.getStore(); t; t = t.parent) if (t.cancelled) return true; return false; };
export const stopped = bot => !!bot?.interrupt_code || cancelledRun();

// runStoppable runs f() under a new token and returns its result, or
// onStop() within STOP_MS of bot.interrupt_code. Never throws when f
// throws after an interrupt (onStop's value then); other errors propagate.
export async function runStoppable(bot, f, onStop = () => undefined, ms = STOP_MS) {
    const token = { cancelled: false, parent: RUN.getStore() || null };
    let timer = null;
    const stop = new Promise(resolve => {
        timer = setInterval(() => {
            if (bot.interrupt_code) { token.cancelled = true; resolve({ stopped: true }); }
        }, ms);
    });
    const work = RUN.run(token, () => Promise.resolve().then(f)).then(v => ({ value: v }), err => ({ err }));
    try {
        const r = await Promise.race([work, stop]);
        if (r.stopped) return onStop();
        if (r.err) {
            if (bot.interrupt_code) return onStop();
            throw r.err;
        }
        return r.value;
    } finally {
        token.cancelled = true; // nothing of this run goes on after it ends
        clearInterval(timer);
    }
}
