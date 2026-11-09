# Proposal

## Why

Crafting, gathering and storage are the next skills the user wants handled by small local decision models instead of the chat LLM. laya-go's craft game (prompt `v2`, `craft-store`) plans the next step towards any item: it gathers what's missing with the right pickaxe, smelts, places stations, and stores junk in a chest (making one) when the inventory is full. Mining and farming need the same loop to make the tools they lack.

## What Changes

- **`src/agent/laya/craft_state.js`:** the craft prompt `v2` state from the bot's inventory (generic `log` and `planks`), nearby stations and chest, and a goal, matching laya-go byte for byte. `craft_data.js` is laya-go's item table and food stacks.
- **`src/agent/laya/craft.js`:** `runCraft`, the loop. It asks for the next step, checks it is possible, does it, and stops with a reason when it can't.
- **`skills.layaMake(bot, item, count)`:** the loop with Mindcraft's skills, for commands and other Laya skills.
- **New commands** `!layaCraft(item, num)` and `!layaGather(item, num)`.
- **A new task** `decision_models.tasks.craft`, off by default.

## Capabilities

### New Capabilities
- `laya-craft`: crafting, gathering and storage steps from a Laya craft model.

### Modified Capabilities

## Impact

- New files: `src/agent/laya/{craft_state,craft_data,craft}.js`, two test files and fixtures, `docs/laya-craft.md`.
- Changed: `skills.js` (`layaMake`), `actions.js` (two commands), `settings.js` (the `craft` task, off).
- With the task off, nothing changes.
