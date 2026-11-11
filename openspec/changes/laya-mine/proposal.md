# Proposal

## Why

Mindcraft can collect ore it can see, but finding ore underground is left to the language model, which digs straight down, wanders, and walks into lava. laya-go's `mine` game (`docs/mine.md` there) trains a small model to take one safe step at a time towards a target ore: stairs down to the ore's height, branch tunnels, torches, blocking lava and water, collecting once the ore is in sight. This change connects that model to the bot.

## What Changes

- **A `mine` task** in `decision_models`, **off by default**: server, model (`mine-a`), timeout, confidence, `max_steps`, `max_failures`, `torch_batch` and step logging.
- **Mine state** (`src/agent/laya/mine_state.js`): writes laya-go's mine prompt `v1` from the world:
  - a status line: ore, feet Y, best pickaxe tier, torches, throwaway blocks, blocks dug since the last torch, heading;
  - `Seen` (the distance to the nearest target ore within 16 blocks);
  - the 5×5×5 view around the bot.

  It also ports laya-go's mine rules: `unsafe` (the veto), `touching`, `hazard` and `decide` (the rule answer).
- **A mine loop** (`src/agent/laya/mine.js`): asks the task each step, then runs the step:
  - `collect` uses the existing collect skill;
  - `tunnel`, `down` and `up` dig with `breakBlockAt` and step with the pathfinder; it never digs straight down;
  - `torch` and `block` use `placeBlock`.

  It takes the rule answer instead when the model has no answer, isn't confident, is vetoed as unsafe, or makes no sense (`collect` with nothing in sight, `block` with no fluid, `torch` without torches, `stop` while a step is possible).
- **Crafting what it needs:** it calls `craft(item, count)` for the pickaxe the ore needs (before starting, on `stop` for a weak pickaxe, and when the pickaxe breaks) and for torches when they run out. The default uses the Laya craft task's `runCraft` when present (`laya-craft`), else `craftRecipe`.
- **Command `!layaMine(ore, count)`** and skill `skills.mineOre`. With the task off, it collects the nearest ore blocks as before.
- **Step log** in `bots/<name>/logs/laya-mine.jsonl`.
- `npm run laya:check` asks the mine sample.

## Capabilities

### New Capabilities
- `laya-mine`: the mine task, its state, veto, rule fallback, crafting and command.

### Modified Capabilities

## Impact

- **New:** `src/agent/laya/mine_state.js` and `mine.js`, tests, fixtures (`test/fixtures/laya-mine-v1/`), `docs/laya-mine.md`.
- **Changed:** `settings.js`, `skills.js` (`mineOre`, `craftForTask`), `actions.js` (`!layaMine`) and `laya_check.js`.
