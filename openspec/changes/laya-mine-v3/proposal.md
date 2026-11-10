# Proposal

## Why

Roadmap item 1 (`docs/laya-roadmap.md`, agreed 2026-11-10). Mining should:
- pick up valuable ore beside the tunnel;
- remember ore it couldn't or didn't mine, and go back for it on request ("andy go get the diamonds you saw");
- use the right pickaxe;
- upgrade before carrying on when that is due.

laya-go's `mine-v3` adds the matching model inputs: `V`/`K` cells, Near, Memory and Kit lines, `grab` and `recall` actions, and the `Upgrade` question.

## What Changes

- **Ore memory** (`ore_memory.js`, pure, with game hooks in `mine.js`):
  - **Recording:** every valuable ore block the bot sees while mining (within 16 blocks, looked up as the view is read) and doesn't mine is recorded with its position, kind, the tier it needs and when it was seen.
  - **Storage:** memory key `ores` (a list, capped at 200, nearest-to-home kept when full).
  - **Pruning:** an ore is removed when it is collected, or when its block is found to be something else.
  - **Queries:** nearest by kind, and list (used by `!listOres` and `!goToOre` in `laya-commands-v3`).
- **Prompt v3 state** (`mine_state.js`):
  - `V`/`K` cells from the bot's pickaxe tier;
  - the `Near` line from blocks seen outside the view;
  - `Memory` from ore memory;
  - `Kit` from the inventory;
  - questions with `Upgrade`;
  - a port of laya-go's v3 rules used when the model is unsure;
  - golden v3 fixtures from laya-go byte for byte.
- **`grab`:** collect the chosen valuable ore (nearest safe `V`, or the Near ore), pick up the drops, then walk back onto the plan (`plan.next` already walks back to the plan cell). A grab that fails twice for the same block marks it skipped in ore memory.
- **`recall`:** path to the remembered target ore and collect it. When the position no longer holds that ore, drop it from memory and continue the plan.
- **Upgrade:** when Upgrade is confidently true (or the rule says so when unsure), and the bot is not in danger:
  1. run the craft loop for the next pickaxe tier (iron, then diamond, or the tier Need asks for);
  2. take materials from the `mine` chest first when `laya-purpose-chests` is present;
  3. resume at the plan.

  If the craft fails, say so once and carry on with the current pickaxe.
- **Tool choice** (`tools.js`, pure):
  - **Default:** for every dig, equip the cheapest carried pickaxe that can mine the block.
  - **Fastest carried:** used when the job is open-ended or has a count of 16 or more, or when the player's message said hurry or quickly (passed by `laya-commands-v3`, or `!layaMine(ore, count, "fast")`; `!layaMine(ore, "fast")` is open-ended and fast).
  - **Iron and diamond:** used only for blocks that need them, or when hurrying.
- **Settings** (`decision_models.tasks.mine`):
  - `prompt: 'v3'`;
  - `grab_detour` (12);
  - `recall_radius` (64);
  - `ore_memory_max` (200).

  `prompt: 'v2'` keeps the v2 loop unchanged.

## Capabilities

### Modified Capabilities
- `laya-mine`: ore memory, opportunist grab, recall, upgrade, tool choice, prompt v3.

## Impact

- **New:** `src/agent/laya/{ore_memory,tools}.js`, `test/laya_ore_memory.test.js`, `test/laya_tools.test.js`, `test/fixtures/laya-mine-v3/` (from laya-go goldens).
- **Changed:** `mine_state.js`, `mine.js`, `library/skills.js` (equip by tool choice), `settings.js` (mine options, `prompt` stays `'v2'` until a v3 model is promoted), `src/models/laya_check.js`, `docs/laya-mine.md`.
- **New in-game scenarios** (`test/game/scenarios.json`):
  - `mine-grab-diamond`: a diamond ore placed beside the iron mine's tunnel line; andy collects it and still gets 3 raw iron;
  - `mine-remember`: a stone pickaxe and an exposed diamond ore; `!layaMine("iron", 2)` → ore memory holds the diamond (checked by `!listOres` once `laya-commands-v3` lands, else by the log);
  - `mine-upgrade`: a stone pickaxe and 3 raw iron, `!layaMine("diamond", 1)`; andy smelts and crafts an iron pickaxe and doesn't answer `stop`;
  - `mine-cheap-pick`: wooden, stone and iron pickaxes carried, mining coal; the stone or wooden pickaxe is used, not iron.
- **Depends on:**
  - laya-go `mine-v3` (prompt v3 and a model);
  - `laya-mine-plan` (merged);
  - optionally `laya-purpose-chests` (mine chest).
- **Shipping:** works with `prompt: 'v2'` until a v3 model is served; ore memory and tool choice work under v2 too.
