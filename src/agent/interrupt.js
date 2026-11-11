// interruptBot stops what the bot's actuators are doing, so the running
// action returns and ActionManager.stop() doesn't have to kill the process.
// ActionManager.stop() calls it every 300 ms until the action ends.
//
// pathfinder.stop() alone only takes effect when the bot reaches its next
// path node, which a stuck bot (the reason unstuck interrupts) never does:
// clearing the goal ends every pathfinder.goto() at once (GoalChanged), and
// with it collectBlock's collect(). collectBlock.cancelTask() waits for
// "collectBlock_finished" and adds a listener (and an "error" listener) per
// call, so it is asked once per stuck task, not every 300 ms (the
// MaxListenersExceededWarning before the 2026-11-11 crash).
export function interruptBot(bot) {
    bot.interrupt_code = true;
    try { bot.stopDigging(); } catch { /* not digging */ }
    try { bot.pathfinder.stop(); } catch { /* no pathfinder */ }
    try { if (bot.pathfinder?.goal) bot.pathfinder.setGoal(null); } catch { /* no pathfinder */ }
    if (bot.collectBlock && !bot._cancellingCollect) {
        let p;
        try { p = bot.collectBlock.cancelTask(); } catch { p = null; }
        if (p && typeof p.then === 'function') {
            bot._cancellingCollect = true;
            p.catch(() => {}).finally(() => { bot._cancellingCollect = false; });
        }
    }
    try { bot.pvp?.stop(); } catch { /* no pvp */ }
}
