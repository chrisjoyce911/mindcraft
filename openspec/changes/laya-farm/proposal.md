# Proposal

## Why

Farming keeps the bot and the player fed. laya-go's `farm` game trains a small model to choose the next farming step; the bot needs to read its farm the same way, ask the model, and carry out the answer safely, making the tools it lacks.

## What Changes

- **`src/agent/laya/farm_state.js`:** reads laya-go's farm prompt `v1` from the world:
  - the 9×9 cells around the bot, with crop age from block properties and hydration from water within 4 blocks;
  - carried items, with any hoe counted as `hoe`;
  - adult animals within 16;
  - the Target and Item options, ported from laya-go's rules.
- **`src/agent/laya/farm.js`:** the farm loop.
  - **Starter kit:** before starting, it gets a hoe and seeds if missing.
  - **Each step:** it asks the model, waits on low confidence, and stops after repeated no-answers.
  - **Missing items:** when an answer needs an item the bot doesn't carry (water bucket, bone meal, a seed), it gets it through an injected `craft(item, count)` and reads again.
  - **Veto:** the target must fit the action (ripe crop to harvest, empty farmland to plant, ground to till, dry farmland to water, growing crop to bone meal, a pair and its food to breed).
  - **Logging:** counters and a step log, `bots/<name>/logs/laya-farm.jsonl`.
- **`src/agent/laya/farm_actions.js`:** the in-game actions.
  - Movement avoids farmland and crops, with no parkour or sprinting, so the bot never tramples.
  - Water goes into a hole dug in dry farmland, and is refused if it could flow out (flooding).
  - Breeding feeds the two nearest adults.
  - `craft` uses the craft task's `runCraft` when present (the `laya-craft` change). Otherwise it uses Mindcraft's skills: a wooden hoe, seeds from breaking grass, a crafted and filled bucket, bone meal.
- **`!layaFarm(minutes)`** command, `skills.farmWithLayaModel`, and the `farm` task in `settings.js` (off by default).

## Capabilities

### New Capabilities
- `laya-farm`: farming with a Laya decision model.

### Modified Capabilities

## Impact

- **New:** `src/agent/laya/farm_state.js`, `farm.js`, `farm_actions.js`, `test/laya_farm.test.js`, `test/fixtures/laya-farm-v1/`, `docs/laya-farm.md`.
- **Changed:** `src/agent/library/skills.js`, `src/agent/commands/actions.js`, `settings.js`.
