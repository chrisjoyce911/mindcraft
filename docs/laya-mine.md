# Laya mine

The `mine` task finds ore underground with a small Laya decision model, laya-go's `mine` game (see `docs/mine.md` in laya-go). It's off by default.

## Using it

1. Serve a mine model: `golaya serve -dir data/serve` with `mine-p` (prompt v2) in it, or `mine-a` with `prompt: "v1"`.
2. Set `decision_models.tasks.mine.enabled` to `true`, and check with `npm run laya:check mine`.
3. Optional: stand by a chest and `!rememberHere("home_chest")`, so the bot can empty its pack there.
4. Ask the bot: `!layaMine("iron", 3)`, or in words ("mine 3 iron").

Until a v2 model is served, laya-go's rule answer drives every step (the loop falls back to the rules when there's no answer).

With the task off, `!layaMine` collects the nearest ore blocks, as `!collectBlocks` does.

## The mine plan (prompt v2)

With `prompt: "v2"` (the default) the bot digs an orderly mine (`src/agent/laya/mine_plan.js`), laid out from where it stands and the way it faces when it starts. It says where the mine starts in chat ("The iron mine starts at 120 70 -45, heading N.").

1. **Staircase:** 1 wide, 2 high, straight ahead, down to the first level: the top of the ore's band, or the bot's height if it's already inside the band (up to the band's bottom if it starts below it).
2. **Grid at each level:** a main tunnel `main_length` (32) blocks ahead; every `branch_every` (3) blocks of it a branch `branch_length` (16) blocks to the left, then one to the right (2 blocks of rock between branches).
3. **Next level:** from the end of the main tunnel the staircase carries on ahead `level_gap` (4) blocks down, and that level's main tunnel runs back the other way, so the levels stack.
4. **Below the band:** when the next level would be below the band's bottom (or the bottom of the world), a tunnel `next_shaft` (40) blocks to the right starts a new column: a grid at that level, then a staircase climbing back up level by level, and so on.

Following the plan:
- The plan's next step goes to the model as the `Plan` line. Ore in sight, lava and water, and a due torch still come first.
- After collecting ore off the line, at the end of a branch and after unloading, the bot walks back (the pathfinder, through the dug mine) to where it left the plan.
- When the plan step is unsafe, the bot takes the safe detour the model or rule gives, and the plan abandons the rest of that branch or main tunnel (an abandoned main tunnel ends its level: the staircase continues from there). An unsafe staircase step shifts the staircase one block to the right; after `max_shifts` (3) shifts in a row the plan ends.
- A move the model answers that isn't the plan step, while the plan step is safe, is overruled (`off-plan`).
- **Torches** go on the left wall in the direction of travel, so walking out they're on your right.

### Unloading into the home chest

Each v2 request also asks **Unload** ("I should go and empty my pack into the home chest now."). The home chest is the remembered place `home_chest` (`!rememberHere("home_chest")` by the chest). When the model is sure it should (or, when it isn't sure, the rule says so) the bot walks home, puts everything in the chest except tools, food, torches and `keep_blocks` (32) throwaway blocks, and walks back to the plan. Ore put in the chest still counts towards the count asked for.

- **The rule (laya-go `rules.Unload`):** never with no home chest known or with lava or water touching the bot; yes with 2 or fewer free slots, with 6 or fewer free slots and home within 24 blocks, or with 4 or more valuables while hurt (health 8 or less), hungry (food 6 or less) or with 2 or more hostile mobs near.
- **A completely full pack** (0 free slots) always unloads, whatever the model says, when a home chest is known.
- When unloading fails, it doesn't try again for `unload_retry_steps` (50) steps.

## What it does

Each step, the bot sends laya-go's mine prompt v2 (v1 with `prompt: "v1"`, which has no `Plan` and `Pack` lines and no Unload question):

```
Mine.
Ore iron Y 41 Pick stone Torches 6 Blocks 20 Dark 7 Heading E
Plan tunnel E
Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0
Seen none
ASSSS AASSS SSSSS SSSSS SSSSS
SSSSS SSSSS SSSSS SSSSS SSSSS
SSSSS AAASS AAASL SSSSL SSSSS
SSSSS SSSSS SSSSS SSSSS SSSSS
SSSSS SSSSS SSSSS SSSSS SSSSS
```

- **Status line:** the ore, feet height, best pickaxe, torches, throwaway blocks (cobblestone, dirt and the like), blocks dug since the last torch, and heading.
- **Plan (v2):** the plan's next step, `Plan <tunnel|down|up> <N|E|S|W>`.
- **Pack (v2):** `Pack <free slots> Home <blocks to the home chest, or none> Health <0–20> Food <0–20> Hostiles <within 16 blocks, up to 9> Valuables <n>`. Valuables count diamonds, emeralds, raw and smelted iron and gold, raw copper, redstone and lapis, and half the coal (up to 999).
- **Seen:** the distance to the nearest target ore within 16 blocks.
- **View:** the 5×5×5 blocks around the bot. Cells are `S` solid, `A` air, `W` water, `L` lava, `O` ore and `B` bedrock.

It runs the model's step as a short macro:

| Step | Macro |
|---|---|
| `collect` | the collect skill on the nearest ore block |
| `tunnel N/E/S/W` | dig head and feet ahead, step in |
| `down N/E/S/W` | stairs down: dig head, feet and floor ahead, step down |
| `up N/E/S/W` | stairs up: dig above the head, and head and above ahead, step up |
| `torch` | v2: a torch on the left wall at head height; v1 (or no wall): place a torch behind |
| `block` | fill lava or water touching the bot with a throwaway block |
| `stop` | craft a better pickaxe if that's the reason, otherwise stop |

It never digs straight down.

## Safety and fallbacks

**The veto:** laya-go's unsafe rules are ported to `mine_state.js`. A step is refused when it digs lava, water or bedrock, digs a block with lava or water behind it, or leaves nothing solid to stand on.

**The rule answer (`decide`)** is laya-go's `rules.Decide`. With a plan (v2), rule 5 follows the plan step when it's safe (`follow-plan`), otherwise detours: the plan's kind to the right, left and back of the plan's direction, then the other kinds ahead, right, left and back (`detour`), never down below Y −59, and stops when nothing is safe (`trapped`).

**The bot takes the rule answer instead when:**
- there's no answer;
- the answer isn't confident (`min_confidence`);
- the veto refuses it;
- the answer makes no sense: `collect` with no ore in sight, `block` with no fluid or no blocks, `torch` without torches, or `stop` while a step is possible;
- (v2) it's a move other than the plan step while the plan step is safe.

**It gives up** when the plan ends, after `max_steps` steps, after `max_failures` failed steps in a row, or when trapped.

## Crafting

It crafts what it needs through `skills.craftForTask`, which uses the Laya craft task's `runCraft` when present, otherwise `craftRecipe`:
- **A pickaxe:** stone for iron, copper and lapis; iron for gold, redstone and diamond. It crafts one before starting, when the model stops for a weak pickaxe, and when the pickaxe breaks.
- **Torches:** `torch_batch` of them when they run out with 8 or more dark blocks.

## Settings

| Setting | Default | |
|---|---|---|
| `enabled` | `false` | off: `!layaMine` collects the nearest ore |
| `server`, `model` | `golaya`, `mine-p` | `mine-p` is a v2 model, `mine-a` v1 |
| `prompt` | `v2` | v2: the mine plan and unloading; v1: roams as the model and rules say |
| `timeout_ms`, `min_confidence` | 300, 0.4 | |
| `max_steps`, `max_failures` | 2000, 4 | without a setting, 2000 for v2 and 300 for v1 |
| `torch_batch` | 4 | |
| `main_length`, `branch_every`, `branch_length` | 32, 3, 16 | the grid at each level |
| `level_gap`, `next_shaft` | 4, 40 | between levels; the next column to the right |
| `keep_blocks` | 32 | throwaway blocks kept when unloading |
| `log_steps` | `true` | `bots/<name>/logs/laya-mine.jsonl`: state, rule answer, model answer, the step taken and its outcome |

## Tests

- **`test/laya_mine_state.test.js`:** the golden state against laya-go byte for byte, the rules port, and the rules port against 300 laya-go answers.
- **`test/laya_mine_v2.test.js`:** the v2 golden state against laya-go byte for byte (`fixtures/laya-mine-v2/request.json`, laya-go's `v2_sample_request.json`), and Decide, Hazard and Unload against 300 laya-go v2 situations (`decisions.jsonl`, from `generate.PlanSituations(7, 300)`).
- **`test/laya_mine_plan.test.js`:** the plan: staircase, branches, next level, the next column, abandoning, the staircase shift.
- **`test/laya_mine_loop.test.js`:** the loop in a fake world, v1 and v2 (walking back, detours, torch wall, unloading).
