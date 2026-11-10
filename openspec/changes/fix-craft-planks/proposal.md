# Proposal

## Why

The strict baseline (`bots/andy/logs/game-tests/baseline-2026-11-10_13-04.md`) found one unexpected failure: **craft-stone-pickaxe**, failing 2 of 2 runs.

**What happened:**
- Andy made the planks. His chat said "Successfully crafted oak_planks, you now have 4 oak_planks." The laya-craft log shows oak_log −2, oak_planks +4.
- But `act.craft` in `layaCraftDeps` (`src/agent/library/skills.js`) returned false, so the craft loop logged `craft planks → failed` and stopped after 1 step: "Laya craft stopped after 1 steps: craft planks failed."

**The check:** `act.craft` compares `countOf(bot, 'planks')` before and after `craftRecipe`, and that compare reported no gain.

**Suspects:**
- the after-count is read before mineflayer has applied the crafting window's inventory update;
- `realName` picks a different planks name from the one crafted;
- `craftRecipe`'s `times` handling: 2 logs went for 4 planks, and one craft should make 4.

craft-wooden-pickaxe crafts planks from 3 logs and passes, so the bug is in a particular path.

## What Changes

- **Reproduce first:** a unit test with a fake bot whose inventory update arrives after `bot.craft` resolves, in the baseline's exact state (`Have cobblestone x3 crafting_table x1 log x2`, goal stone_pickaxe). The test must fail before the fix.
- **Fix `act.craft` (and `act.smelt`, which has the same pattern):**
  - success is "the count of the generic item went up", measured after the inventory has settled: wait for the next `updateSlot` or for at most 500 ms, then count;
  - `craftRecipe`'s return value counts as success when the count can't be read.
  - If the root cause turns out to be `realName` or `times`, fix that instead and record which in the design note.
- **Log the cause:** the craft step log records `before` and `after` counts, so a future mismatch is visible in `laya-craft.jsonl`.
- **Re-run the in-game scenario** `craft-stone-pickaxe` on the test world; it must pass.

## Capabilities

### Modified Capabilities
- `laya-craft`: a craft or smelt step's success is judged on the settled inventory, with before and after counts logged.

## Impact

- `src/agent/library/skills.js` (`layaCraftDeps.act.craft`, `act.smelt`), `src/agent/laya/craft.js` (log fields), `test/laya_craft*.test.js`.
- **Depends on:** nothing.
- **Shipping:** ship it first, in the current test round. With it the baseline's only unexpected failure should be gone.
