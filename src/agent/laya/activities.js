// The director's own activities (eat, heal, unload, and defend-player and flee-ranged): the agent runs them as
// its action ("director:<activity>"). Every wait here checks stopped() at
// least every STEP_MS, so a mode taking over (laya_defending, unstuck, ...),
// !stop or the director answering something else ends the activity at once
// instead of making ActionManager.stop() wait (and, after 10 s, kill the
// process). Pure: the agent passes the bot side in, tests pass fakes.

export const STEP_MS = 100;

const realSleep = ms => new Promise(r => setTimeout(r, ms));

// pause waits ms, or less when stopped() turns true; it returns whether it
// was stopped.
export async function pause(ms, stopped, sleep = realSleep, step = STEP_MS) {
    let waited = 0;
    while (waited < ms) {
        if (stopped()) return true;
        const t = Math.min(step, ms - waited);
        await sleep(t);
        waited += t;
    }
    return !!stopped();
}

// performActivity runs one director activity. deps:
//   stopped() → true once the activity must end (bot.interrupt_code)
//   health(), food(), eat() → Promise<bool> (eats the best food carried)
//   nearestDist() → the nearest hostile's distance or null
//   say(msg), askedFoodAt / setAskedFoodAt (the "no food" message at most
//   every 2 min), unload() → Promise (walk home and deposit), now(), sleep
// It returns why it ended: 'done', 'stopped', 'no-food', 'mob-near', 'time'.
export async function performActivity(activity, deps) {
    const { stopped } = deps;
    const sleep = deps.sleep || realSleep;
    const now = deps.now || (() => Date.now());
    if (activity === 'eat') {
        if (stopped()) return 'stopped';
        await deps.eat();
        return stopped() ? 'stopped' : 'done';
    }
    if (activity === 'heal') {
        // stop, eat to full, wait to regenerate (until 9 health, a mob within 8, or 60 s)
        while (!stopped() && deps.food() < 18 && await deps.eat()) {
            if (await pause(200, stopped, sleep)) return 'stopped';
        }
        if (stopped()) return 'stopped';
        if (deps.food() < 18) {
            if (now() - (deps.askedFoodAt?.() || 0) > 120000) {
                deps.setAskedFoodAt?.(now());
                deps.say?.("I'm hurt and I have no food. Can someone give me some?");
            }
            return await pause(10000, stopped, sleep) ? 'stopped' : 'no-food';
        }
        const end = now() + 60000;
        while (now() < end && deps.health() <= 8) {
            const d = deps.nearestDist?.();
            if (d != null && d <= 8) return 'mob-near';
            if (await pause(1000, stopped, sleep)) return 'stopped';
        }
        return stopped() ? 'stopped' : deps.health() <= 8 ? 'time' : 'done';
    }
    if (activity === 'unload') {
        if (stopped()) return 'stopped';
        await deps.unload?.();
        return stopped() ? 'stopped' : 'done';
    }
    // defend (v1.2 defend-player: the player's attacker) and flee (v1.2
    // flee-ranged: away from a skeleton out of the modes' reach)
    if (activity === 'defend' || activity === 'flee') {
        if (stopped()) return 'stopped';
        await deps[activity]?.();
        return stopped() ? 'stopped' : 'done';
    }
    return 'done';
}

// stopActivity ends the director's running action `label` (e.g.
// "director:heal") and nothing else: it interrupts only while that action
// is still the current one, so a mode that has taken over meanwhile
// (laya_defending) is never interrupted. deps: currentLabel(), interrupt(),
// executing(), idle() (called when nothing runs afterwards), sleep.
// Returns whether the action ended within ms.
export async function stopActivity(label, deps, ms = 3000) {
    const sleep = deps.sleep || realSleep;
    let waited = 0;
    while (deps.currentLabel() === label) {
        if (waited >= ms) return false;
        deps.interrupt();
        await sleep(STEP_MS);
        waited += STEP_MS;
    }
    if (!deps.executing()) deps.idle?.();
    return true;
}
