# Proposal

## Why

`!layaMine` finds ore, but its tunnels wander: each step's direction is the model's choice, so a person can't follow the mine, reuse it or find the bot in it. The user wants an orderly layout: a staircase down to the ore's starting level, a strip (branch) mine grid there, then the staircase continues down to the next level and another grid, until the bottom of the ore's band, then it starts again beside the first one.

## What Changes

- **A mine plan** (`src/agent/laya/mine_plan.js`, pure, no mineflayer): from the start position and heading it lays out waypoints and gives the next plan step (`tunnel`, `down` or `up` and a direction) from the bot's position:
  1. **Staircase**: 1 wide, 2 high, straight ahead, down to the first level: the ore's best band top (`hi`), or the bot's height if already inside the band.
  2. **Grid** at each level: a main tunnel 32 blocks ahead; side branches every 3 blocks of it, 16 blocks left and right (2 blocks of rock between branches).
  3. **Next level**: from the end of the main tunnel the staircase continues ahead 4 blocks down (tunnels 4 apart leave no unseen rock between levels), and that level's main tunnel runs back the other way (a serpentine, so levels stack).
  4. **Below the band's bottom** (`lo`, or just above bedrock): it starts again with a new staircase 40 blocks to the right, climbing back up level by level (so no long walk back), and so on.
- **Following the plan**: the mine loop sends laya-go's mine prompt **v2** (prompt v1 plus `Plan <kind> <dir>`) and runs the answer as now. Ore in sight, torches and lava/water still come first; after collecting ore off the line, or after walking to the end of a branch, it walks back (pathfinder through already-dug tunnel) to the plan's next waypoint. When the plan step is unsafe (the model or the rule answers a detour) it abandons that branch or main-tunnel segment and moves to the next; for an unsafe staircase step it shifts the staircase one block right and carries on.
- **Torches** on the left wall going out, so the torches are always on your right when walking out.
- **Stops** when it has the count asked for, after `max_steps` (raised to 2000 by default for a plan), when trapped, or after `max_failures` failed steps; it says where the mine starts (its entrance coordinates) in chat when it begins.
- **Settings**: the `mine` task gets `prompt: 'v2'` (default), `branch_every: 3`, `branch_length: 16`, `main_length: 32`, `level_gap: 4`, `next_shaft: 40`. With `prompt: 'v1'` the old free-roaming behaviour stays.
- `npm run laya:check` asks the v2 sample.

## Capabilities

### Modified Capabilities
- `laya-mine`: the mine plan (staircase, branch grid, levels, next shaft) and prompt v2.

## Impact

- **New:** `src/agent/laya/mine_plan.js`, `test/laya_mine_plan.test.js`, fixture `test/fixtures/laya-mine-v2/` (copied from laya-go's v2 golden request).
- **Changed:** `mine_state.js` (v2 state, `decide` with plan), `mine.js` (plan loop, walking back), `settings.js` (mine task options), `laya_check.js` (v2 sample), `docs/laya-mine.md`.
- **Depends on** laya-go change `mine-plan` (prompt v2 and a v2 model `mine-p`); until that model is served, the rule answer drives every step (the loop already falls back to rules when the model's answer doesn't parse or isn't confident).
