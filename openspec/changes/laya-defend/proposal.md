# Proposal

## Why

In the first in-game trial the bot died six times at night: `self_defense` attacks the nearest hostile mob whatever it is, and `cowardice`/`self_preservation` run without judging the fight. laya-go's `defend` game trains a small model to decide what to do, about which mob, with which weapon.

## What Changes

- **A `defend` decision task** (`decision_models.tasks.defend`, off by default).
- **The `laya_defending` mode,** placed before `cowardice` and `self_defense`. While mobs are active it runs an engagement that asks the defend model every 400 ms and acts: fight, shield, back off, flee, eat a golden apple, or ignore.
- **Safety rules:**
  - fighting a close creeper becomes flee, unless the bot is strong and the creeper is alone;
  - ignoring a melee threat, eating without an apple, a missing target or a bow without arrows fall back.
- **The ordinary modes** (`cowardice`, `self_defense`, and `self_preservation`'s low-health flight) stand aside while the model is in control, and take over during fallbacks.
- **State** from the bot: health, food, worn armour, night, a player within 8, up to 3 weapons, arrows, shield, golden apples, and up to 4 mobs. It matches laya-go's golden request byte for byte.
- **A step log** at `bots/<name>/logs/laya-defend.jsonl`.

## Capabilities

### New Capabilities
- `laya-defend`: defending with the Laya defend model.

### Modified Capabilities

## Impact

- **New files:** `src/agent/laya/defend_state.js`, `defend.js`, `defend_actions.js`, the tests and the fixture.
- **Changed:** `src/agent/modes.js` (the new mode, plus guards in three modes) and `settings.js` (the task).
