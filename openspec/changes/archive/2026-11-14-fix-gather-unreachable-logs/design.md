# Design

> As built: the pure parts are in `src/agent/laya/reach.js`. The reach limit is 6 above the ground under the column: a log at ground + 6 is cut from the ground, and the live case at ground + 8 isn't. The column walk passes through the log's own trunk, which the first draft below got wrong. `collectBlock` leaves `bot._lastCollect = {collected, reason}` for `layaGatherBlocks`, rather than changing its return value.

## Failure memory in `collectBlock`

```
const failed = new Set();                     // "x,y,z" of blocks whose collect threw
let collected = 0, failuresInRow = 0;
while (collected < num && failuresInRow < MAX_COLLECT_FAILURES && !stopped(bot)) {
    blocks = getNearestBlocksWhere(bot, b => ... && !failed.has(key(b.position)) && reachableLog(b), 64, 1);
    if (!blocks.length) break;                 // "No more <type> nearby I can reach."
    try { collect; collected++; failuresInRow = 0; }
    catch (err) {
        if (err.name === 'NoChests') break;
        if (stopped(bot)) break;
        failed.add(key(block.position)); failuresInRow++;
        log(bot, `Failed to collect ${blockType}: ${err}.`);
    }
}
```

- The set is per call, not global. A block that fails now (a mob in the way, a path being built) may be fine on the next job.
- `exclude` (the caller's list) and `failed` are checked the same way. `exclude` may become a `Set` of keys internally.
- `MAX_COLLECT_FAILURES = 5` caps the worst case at about 5 pathfinder timeouts instead of `num` of them.
- An outer safety cap (`collected + failed.size <= num + MAX_COLLECT_FAILURES * 2`) keeps the loop bounded even if failures and successes alternate.

## Log reach filter

A player standing on ground at `g` (feet at `g + 1`) reaches about 4.5 blocks from eye height (`g + 2.62`). So a log at height `y` is reachable from directly below if `y - g <= 4` (rounded down for safety).

`reachableLog(block)`, used only for `*_log`:
- walk down from `block.y - 1` for at most `LOG_REACH_ABOVE_GROUND + 1` blocks;
- skip other logs of the same trunk (they are reachable themselves, so the column counts) and air;
- reachable if a solid, non-leaf, non-liquid block is found within `LOG_REACH_ABOVE_GROUND` blocks below the log, or another log is directly below (a standing trunk; the lower log is chopped first);
- leaves don't count as ground: andy doesn't stand on canopies.

This is deliberately a column check, not a path search. Standing beside the column (one block over) gives the same reach, and the failure memory catches whatever the cheap check lets through.

## Log types

`layaGatherBlocks('log')` calls `collectBlock(bot, 'log', n)`, and `collectBlock` expands `log` to every overworld `*_log` name from minecraft-data (oak, spruce, birch, jungle, acacia, dark_oak, mangrove, cherry, pale_oak). The generic `countOf(bot, 'log')` already counts them all.

## Reason in chat

`collectBlock` returns `{ collected, reason }` internally (the public boolean return stays for other callers through a thin wrapper). `layaGatherBlocks` turns `reason: 'unreachable'` into the gather failure reason "no more logs I can reach here (got N)", which the craft/gather job reports through the existing failed-job message.
