# Proposal

## Why

The v2 test round on 2026-11-10 (`bots/andy/logs/game-tests/v2-mine-farm-report-2026-11-10_15-53.md`, "Bugs found") found seven bot-side bugs in the mine v2, farm v2 and craft loops:

- andy chained ore to ore away from the mine and drowned in 2 of 2 runs;
- buckets never poured or filled;
- failed or vetoed farm steps repeated forever;
- a full home chest counted as a failed mine unload;
- a stale inventory after a multi-count craft led to a 20 s stall;
- `till` and `plant` reported done without checking;
- torches were crafted at most once per mine job.

## What Changes

- **Mine collect:** ore is collected only when it is within `collect_range` (12) of the plan cell, has no water or lava touching it or on the straight way there, and the collects since leaving the plan stay within `collect_budget` (24) blocks. Then andy walks back onto the plan. The game side digs that exact block over a path that avoids fluids. Walk and `walk-first` step logs carry the state and position.
- **Mine unload:** this uses `pack_actions.packDeps` (the home chest and the chests touching it), as the farm does. If the chests fill after something went in, the unload is partial. That is not a failure, and Unload still backs off.
- **Mine torches:** andy crafts a batch whenever he has fewer than `torch_low` (4) torches and carries coal or charcoal plus sticks or wood, or when he has none left in the dark. After a failed craft he waits `torch_retry_steps` (50) steps before trying again.
- **Farm buckets:** water is poured and buckets are filled by looking at the block and using the item (`activateItem`). Both are checked afterwards.
- **Farm failures:** a vetoed or failed action is banned on that cell for `ban_steps` (20) steps, and the rules answer instead. The job stops after `max_bad` (6) bad steps in a row. A pond next to a hole or lower ground is vetoed.
- **Farm till/plant:** the result is checked: farmland after `till`, a crop after `plant`.
- **Craft:** after a craft, andy waits until the inventory shows the crafted items (up to 3 s) before the next step reads it.
- **followPlayer:** no crash when the player's entity isn't loaded.

## Capabilities

### Modified Capabilities
- `laya-mine`: bounded, safe collecting; partial unloads; torch batches.
- `laya-farm`: working buckets, checked till/plant, no endless failed steps.
- `laya-craft`: the inventory settles after a craft.

## Impact

`src/agent/laya/mine.js`, `farm.js`, `farm_actions.js`, `farm_state.js`, `craft.js`, `src/agent/library/skills.js`, and the tests. This does not touch laya-go or the models.
