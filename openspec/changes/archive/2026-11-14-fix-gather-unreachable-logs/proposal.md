# Proposal

## Why

In a real LAN game on 14 Nov 2026 (14:17–14:21 AEST), andy was asked "gather 128 logs" and got stuck under one tree.

**What happened:**
- He chopped the bottom of an oak trunk, leaving logs 6–7 blocks above his head. He can't reach them and doesn't pillar up.
- `collectBlock` (`src/agent/library/skills.js`) picks the nearest matching block on every pass. When collecting it fails, it logs the error and `continue`s, but nothing remembers the failed block. The next pass picks the same unreachable log again.
- Each failure costs a full pathfinder think timeout: "Failed to collect oak_log: Timeout: Took to long to decide path to goal!", repeated many times per run.
- Failures also use up the `num` loop. Two runs of `!layaGather("log", 12)` took about 1 m 40 s each and got 2 and then 3 logs. Both ended "I couldn't get 12 log: gather log failed", with good trees within 64 blocks.
- `layaGatherBlocks('log')` makes it worse. It locks onto the name of the first log it finds (`findBlock(... endsWith('_log'))` → `collectBlock(bot, block.name, n)`). When those logs are the unreachable ones, the birch or spruce next to them is never tried.
- After a "come to me", the director answered `resume` (`resume-paused`) and sent him back to the same tree. To the player, he "doesn't come when asked and keeps going back to the logs he can't reach".

## What Changes

- **Remember failures:** `collectBlock` keeps a per-call set of positions whose collect failed (not an interrupt, not `NoChests`) and skips them in its block filter. It never tries the same block twice in one call.
- **Failures don't use up the goal:** only collected blocks count toward `num`. The call ends after `MAX_COLLECT_FAILURES` (5) failed blocks in a row, or when no candidates are left.
- **Skip logs that can't be reached from the ground:** when gathering logs, a log is a candidate only if there is standable ground within reach below it. Walking down its column through its own trunk, air and leaves, the first solid, non-leaf block must be at most `LOG_REACH_ABOVE_GROUND` (6) blocks down: eyes at ground + 2.6, reach 4.5. A trunk with its bottom cut is then skipped without a path search. The failure memory stays as the fallback for anything else unreachable (in water, behind walls, on cliffs).
- **Any log will do:** `layaGatherBlocks('log')` passes every `*_log` type (overworld logs; stems stay out as before) to `collectBlock`, so the nearest reachable tree wins whatever its wood.
- **Say why:** when a log gather ends short because everything left was unreachable, the chat reason says so, e.g. "I couldn't get 12 log: no more logs I can reach here (I have 5)". The existing "Failed jobs say why" requirement covers the wording path.
- **Prove it:** a unit test with a fake bot, and a new game scenario `gather-logs-unreachable` on the test world.

## Out of scope

- **Pillaring up or placing blocks to reach high logs.** That's a later skill (the bot-rebuild's gather model may learn it).
- **The director resuming a paused gather after "come to me".** That's by design (`resume-paused`); with this fix the resumed gather goes to a reachable tree instead. Whether "come" should cancel the paused job is a separate change.
- **"gather 128 logs" parsed as 12.** That's the command model's count slot (laya-command), a separate change.

## Capabilities

### Modified Capabilities
- `laya-jobs`: collecting skips blocks it has failed on and logs it can't reach from the ground. It ends with a reason instead of retrying one block.

## Impact

- `src/agent/laya/reach.js` (new, pure: `logReachable`, `CollectTries`, log types).
- `src/agent/library/skills.js`: `collectBlock` (failure set, candidate filter, loop count) and `layaGatherBlocks` (all log types, reason).
- `src/agent/laya/craft.js`: a step's act may return `{ ok: false, why }`, and the why becomes the job's reason.
- `test/laya_gather_reach.test.js` (new); `test/game/scenarios.json` (new `gather-logs-unreachable`, still to do).
- Other `collectBlock` callers (mine, wheat, seeds, ores) also get failure skipping. The log reach filter applies to `*_log` only.
- **Bot rebuild:** `collectBlock` moves to `bot/actuators/` in bot-rebuild. Port this behaviour forward with it ("fixes they land in the old bot are ported forward phase by phase").
- **Depends on:** nothing.
