# Proposal

## Why

The live play session on 2026-11-10 (`bots/andy/logs/game-tests/live-play-2026-11-10.md`, bot log
`bot-2026-11-10_17-39-28.log`, `laya-*.jsonl`) showed the chat LLM steering andy wrong (an interrupted iron job
became a coal job; a fake `home_chest`; a memory summary that "frequently requests coal"), and mine v2 bugs:
branch mining at the surface through the base, digging into a 25-block drop at health 4 (death, pack lost),
a new staircase beside an existing one, a failed unload blocking the ore beside him, failing torches and ore
filtered out right below him. The user decided to take the chat LLM out of the loop.

## What Changes

- **`settings.llm`** (default `true`, upstream behaviour). With `false`: player chat goes only to the Laya
  command model, and chat, unsure or unknown messages get a canned reply listing example commands; system and
  self messages (mode interrupt auto-messages, death, conversation timeouts, `init_message`) and other bots'
  messages never reach the LLM; a death is announced with its position and andy stays stopped; no
  self-prompting, memory summaries, bot-to-bot LLM talk, `!newAction`, NPC goal setting or vision; typed
  `!commands` still work.
- **Resume after an interrupt**: a Laya job (mine, farm, craft) interrupted by a mode (defend, unstuck, ...)
  resumes with the same arguments and what is left once the mode is done, even when the interrupt aborted a dig
  (that exception used to cancel the resume). A player's new command still replaces it.
- **Mine plan**: the staircase always goes down first, to at least `surface_depth` (10) below the entrance and to
  the ore's best level (coal 45, copper 48, iron 16, lapis 0, gold -16, redstone -58, diamond -58, clamped to the
  band), then the grid.
- **Mine safety** (rule `heal`): health ≤ 8 stops the descent; andy eats until food ≥ 18, waits to regenerate,
  and with hostiles near retreats up the staircase; with no food he goes home (or stops) and asks for food.
  A move whose new floor has more than 3 air blocks below it is vetoed (`drop`), for the model and the rules,
  and two `no floor`/`drop` vetoes in a row on the staircase end the descent there.
- **Mine memory**: each mine (entrance, heading, band, levels reached) is saved; a mine job within 16 blocks of a
  saved mine whose band reach covers the ore resumes it instead of a new staircase.
- **Home chest**: `!rememberHere("home_chest")` is refused (or only accepted on a chest); a saved home whose
  chest is gone is dropped.
- **Unload failure** backs off and andy goes on collecting.
- **Torches**: stick crafting, one withdrawal of planks, and a failed torch place backs off.
- **Collect filter**: ore deeper than `collect_below` but in the open next to the stair is collected.
- **Memory**: finished requests are kept out of the memory summary.

Mine defaults `collect_range` 12, `collect_below` 4, `collect_budget` 24 and the Mine prompt v2 text are unchanged.

## Capabilities

### New Capabilities
- `laya-chat`: the chat LLM switch.

### Modified Capabilities
- `laya-mine`: plan depth, safety, mine memory, unload back-off, torches.
- `laya-jobs`: resume after interrupt.

## Impact

`src/agent/agent.js`, `llm_gate.js`, `modes.js`, `action_manager.js`, `self_prompter.js`, `history.js`,
`conversation.js`, `npc/controller.js`, `vision/vision_interpreter.js`, `commands/actions.js`,
`src/agent/laya/*`, `src/agent/library/skills.js`, tests. `settings.js` is not changed (the lead sets `llm`).
