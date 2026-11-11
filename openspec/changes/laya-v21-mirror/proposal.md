# Proposal

## Why

laya-go's v2.1 data (`~/lnkz/laya-go-v21`, OpenSpec `laya-v2.1-data`, commit `cb1c791`) changes the command prompt
and the mine and farm rules. The served v2.1 models must see the same options and the bot's rules must agree with
the rules the data was labelled with ("Mindcraft mirroring" in that proposal's Impact).

## What Changes

- **Command v2.1:** `questionsFor('v2.1')` with `ITEMS_V21` (v2's items, then beef, pork, mutton, leather, feather,
  egg, then none); the drops with their mobs; `resolve(..., 'v2.1')` (a gather of a drop gets the drop, a mine of
  one none); `huntFor`. A gather of a drop runs a new `!hunt(mob, item, count)` Laya job: attack and pick up until
  the count. Fixtures from laya-go.
- **Mine:** with a plan, collect only when Seen ≤ 12; a step down at health ≤ 8 is a `stop` (rule `low-health`),
  which mine.js takes to the heal path, not "needs a pickaxe".
- **Farm:** the pond cell skips a dry cell with an `X` beside it unless every dry cell has one.
- `prompt: 'v2.1'` is accepted for command, mine and farm (mine and farm keep v2's prompt text); `laya:check` has
  v2.1 samples. Craft's prompt is unchanged (v2).

## Capabilities

### Modified Capabilities
- `laya-command`: prompt v2.1, hunting for drops.
- `laya-mine`: v2.1 rules.
- `laya-farm`: v2.1 pond cell.

## Impact

`src/agent/laya/command_state.js`, `command.js`, `hunt.js`, `mine_state.js`, `mine.js`, `farm_state.js`, `farm.js`,
`src/agent/commands/actions.js`, `src/agent/library/skills.js`, `src/models/laya_check.js`, fixtures and tests.
settings.js is not changed: switch with `decision_models.tasks.command.prompt: "v2.1"` (and mine/farm when their
v2.1 models are served).
