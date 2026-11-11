# Proposal

## Why

Eating is the second decision handed from fixed rules and the language model to a small Laya model, after following. laya-go's `eat` game (`docs/eat.md` there) trains a model to decide **when** to eat and **what**, from health, hunger, saturation, danger and the food carried:
- it keeps golden apples for emergencies;
- it avoids harmful food unless starving;
- it doesn't waste food points;
- it doesn't stop to eat beside danger.

Today Mindcraft uses the `mineflayer-auto-eat` plugin: it eats at hunger 14 or below, the most food points first, with five foods banned. That's the baseline. This change connects the eat model to the bot, keeping the plugin as the fallback.

## What Changes

- **An `eat` task** in `decision_models`, **off by default**: server, model, timeout, confidence, how often to check (`check_ms`), how long to fall back (`fallback_ms`), and step logging.
- **Eat state** (`src/agent/laya/eat_state.js`): writes laya-go's eat prompt `v1` from the bot:
  - `Eat.`;
  - a status line: health (rounded down), food, saturation to one decimal place, and danger;
  - a line per carried food, with its name, count, points, **true** saturation and `rare` or `bad` tag.

  It uses a copy of laya-go's 40-food table. minecraft-data's `saturation` field is wrong; true saturation is `saturationRatio ÷ 2`. At most six kinds are listed: rare first, then normal by points, then bad, written in inventory order.
- **Danger:** a hostile mob within 8 blocks, or lava within 2.
- **A Laya eating reflex:** a new mode, `laya_eating`, active only when the task is on.
  - **Check:** every `check_ms`, it asks the eat task.
  - **Eat:** when the answer is confident and says eat, it eats the chosen food if carried. The safety rules must allow it:
    - no bad food unless starving;
    - no rare food unless health is 6 or less;
    - no eating in danger or at full hunger, except a golden apple in an emergency.
  - **Fall back** otherwise: on no answer or low confidence, `mineflayer-auto-eat` is switched on for `fallback_ms`, which is today's behaviour, then off again.
  - With the task on, the plugin stays off outside fallbacks. With it off, nothing changes.
- **Measurements:** counters (asks, eats by food, fallbacks by reason, vetoes), and a step log `bots/<name>/logs/laya-eat.jsonl` with each decision's state, answer and outcome.
- **Tests:**
  - a contract test against laya-go's eat golden request;
  - the food table against laya-go's values;
  - the reflex's decisions with a fake bot and model.

## Capabilities

### New Capabilities
- `laya-eat`: deciding when and what to eat with the Laya eat model through the `eat` task: the eat state, danger, the reflex, the safety rules, the fallback to auto-eat, and the measurements.

### Modified Capabilities

## Impact

- **New code:** `src/agent/laya/eat_state.js`, `src/agent/laya/eat.js`, tests, and `test/fixtures/laya-eat-v1/`.
- **Changed:**
  - `settings.js` gains the `eat` task (off);
  - `src/agent/modes.js` gains `laya_eating`.
- **Untouched:** every behaviour while the task is off.
