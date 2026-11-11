# Proposal

## Why

In the user's trial `!layaFarm(3)` on a savanna plateau far from water read every grass cell as `L` (dry ground, no water within 4). The bot had a hoe and one seed; the farm model (prompt v1) can't till dry ground, so it answered `wait` 73 times in a row and the bot stood still until the time ran out (`bots/andy/logs/laya-farm.jsonl`). Farming also only runs for some minutes, can't be asked for "20 wheat" or "keep farming", and a full pack stops it being useful.

laya-go's change `farm-v2` adds farm prompt v2: the crop being farmed, the same pack line as mine prompt v2, an `Unload` question and actions for a dry place (make a pond from a water bucket, or go and find water / stop). The chat command game gets a `farm` command.

## What Changes

- **`!layaFarm(crop, count)`**: both optional. Crop `wheat`, `carrots`, `potatoes`, `beetroot` or `any` (default). No count (or `any`) farms until stopped, unloading into the home chest when the pack fills; a count farms until that many of the crop's produce have been harvested since starting, then stops. The old `!layaFarm(minutes)` still works: a lone number is minutes. Commands can now have optional trailing parameters (`optional: true`).
- **Farm prompt v2** (`farm_state.js`): `Crop` and `Pack` lines, the `Unload` question and the v2 actions, matching laya-go's golden request byte for byte; a port of laya-go's v2 rules (`decide`, `unload`) used when the model is unsure.
- **No water** (`farm.js`):
  - `pond`: on a dry ground cell, dig a 1-block hole and pour a water bucket in (refused if the water could flow out). A bucket is crafted or filled only when the materials (a bucket or 3 iron ingots) and water are there.
  - Find water: when the model (or rule) says there's no water to farm with, search for water within `water_radius` (64) blocks, walk there and carry on; if there is none, say "No water near here — take me to water or give me a water bucket" and stop.
  - Never wait forever: after `wait_limit` waits in a row with nothing growing, stop.
- **Unload**: like mine v2. When Unload is confidently true (or the rule says so when the model is unsure), or the pack has 0 free slots, and a home chest is known (memory place `home_chest`): walk to it, deposit everything except tools, food, buckets and up to 16 of each seed, walk back to the farm and continue.
- **Shared pack helpers** (`src/agent/laya/pack.js`, pure; `src/agent/laya/pack_actions.js`, mineflayer): pack line, home distance, hostiles and unload rule, deposit list, home chest lookup and deposit. The mine change `laya-mine-plan` has its own copies in `mine_state.js`, `mine.js` and `skills.js`; it should switch to these at merge time.
- **Command mapping** (`command.js`): the `farm` command runs `!layaFarm(crop, n)`, or open-ended `!layaFarm(crop)` when Count is `any`; `mine` with Count `any` runs open-ended `!layaMine(ore)` when `!layaMine` accepts a lone ore (the mine loop itself is `laya-mine-plan`'s), otherwise the default `mine_count` as before. `!layaMine` now gets the ore name it takes (`iron`, not `raw_iron`).
- **Home chest** (`src/agent/laya/home_chest.js`, pure; game side in `pack_actions.js`), approved scope addition:
  - `!setHomeChest`: the chest nearest the player who spoke last (or the bot) within 8 blocks becomes `home_chest` (its exact block position).
  - Chat: the command game's `home` command runs `!setHomeChest` and replies "That's my chest now."
  - Sign: with no `home_chest` saved, a sign within 32 blocks bearing the bot's name, on or next to a chest, makes that chest the home chest (the bot says so).
  - A full home chest spills into the chests touching it before unloading gives up.
- **Settings** (`decision_models.tasks.farm`): `prompt: 'v2'`, `wait_limit`, `water_radius`, `keep_seeds`; `laya_check.js` asks the v2 farm sample; docs.

## Capabilities

### Modified Capabilities
- `laya-farm`: crop and count goals, prompt v2 with pack and unload, pond and find water, no endless waiting.
- `laya-command`: the `farm` and `home` commands and open-ended counts.

### New Capabilities
- `laya-home-chest`: setting the home chest by command, chat or sign, and spilling into touching chests.

## Impact

- **New:** `src/agent/laya/pack.js`, `src/agent/laya/pack_actions.js`, `src/agent/laya/home_chest.js`, `test/laya_pack.test.js`, `test/laya_home_chest.test.js`, `test/fixtures/laya-farm-v2/` (and command fixtures updated) from laya-go's golden requests.
- **Changed:** `farm_state.js`, `farm.js`, `farm_actions.js`, `command.js`, `command_state.js`, `commands/actions.js`, `commands/index.js` (optional params), `library/skills.js`, `settings.js`, `src/models/laya_check.js`, `docs/laya-farm.md`, `docs/laya-command.md`.
- **Depends on** laya-go `farm-v2` (prompt v2 and a v2 farm model). Until a v2 model is served, set `prompt: 'v1'` (the v1 model `farm-a` keeps working; the wait limit and the find-water fallback still apply).
- **Merge note:** `laya-mine-plan` should pass `packDeps(bot, homeChest, adopter)` (sign adoption, spill-over) and replace its private `homeDistance`, `valuables` pack line, `depositList`, `homeChestBlock` and `depositInChestAt` with `pack.js` / `pack_actions.js`.
