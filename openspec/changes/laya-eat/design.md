# Design

## Context

- **laya-go's `eat` game:**
  - prompt `v1`: the state and the `Eat` (noul) and `Food` (choice) questions;
  - the rules in `games/eat/rules`;
  - the food table in `games/eat/food`;
  - the golden request `games/eat/prompt/testdata/v1_sample_request.json`.
- **`mineflayer-auto-eat` 3.3.6** has `disable()`, `enable()` and `eat()`. Mindcraft sets `startAt: 14`, priority `foodPoints`, and bans rotten flesh, spider eye, poisonous potato, pufferfish and raw chicken.
- **Modes** (`src/agent/modes.js`) run every tick. An update must not block for more than about 100 ms.
- **Mineflayer:** `bot.health` (0–20, in halves), `bot.food` (0–20), `bot.foodSaturation`, `bot.inventory.items()`, `bot.equip`, `bot.consume`.

## Decisions

### Settings (the `eat` task)
```js
"eat": {
    "enabled": false, "server": "golaya", "model": "eat-a", "timeout_ms": 300, "min_confidence": 0.5,
    "check_ms": 2000,      // how often to ask
    "fallback_ms": 10000,  // auto-eat runs this long after a fallback
    "log_steps": true      // bots/<name>/logs/laya-eat.jsonl
}
```

### State
- **Status:** `Health floor(bot.health)`, clamped to at least 1, so 0.5 reads as 1 and the bot isn't dead. `Food bot.food`. `Saturation` to one decimal place. `Danger yes/no`.
- **Foods:** group the inventory by item name, keeping only names in the table. If more than 6 kinds are carried, keep 6 by priority (rare, then normal by points, ties by saturation, then bad in laya-go's bad order), and write the kept ones in inventory order. Counts are summed across stacks.
- **The table** (`eat_state.js`) is copied from laya-go `games/eat/food`, with name, points, true saturation and tag. A test checks the copy against laya-go's eat golden request and the known values.

### Danger
`world.getNearestEntityWhere(bot, mc.isHostile, 8)`, or lava (`bot.findBlock({matching: lava, maxDistance: 2})`). This is injected in the reflex, so tests use fakes.

### The reflex (mode `laya_eating`)
- **Off:** when the task is off, it does nothing, and `mineflayer-auto-eat` behaves as before. When the task turns off, auto-eat is switched back on.
- **On:** auto-eat is switched off except during fallbacks.
- **Each `check_ms`,** unless already eating or in a fallback window:
  1. **Ask** with the state and both questions.
     - **No answer:** fall back with reason `no-answer`.
     - **Not confident:** if either answer is below `min_confidence`, fall back with reason `low-confidence`.
  2. **If `Eat` is below 0.5, or `Food` is `none`:** don't eat. If the two disagree (eat, but `none`; or don't eat, but a food), fall back with reason `disagree`.
  3. **Safety check** of the chosen food. Refuse (reason `veto`, then fall back) when:
     - it isn't carried;
     - it's bad and food is above 6;
     - it's rare and health is above 6;
     - danger is near, or food is 20, and it isn't a golden apple at health 6 or less.
  4. **Eat** it: equip in hand, `consume`, then re-equip the previous hand item. This runs without blocking the mode loop (`busy` while eating).
- **Fallback:** `autoEat.enable()` for `fallback_ms`, then `disable()`.

### Measurements
- **Counters:** `asked`, `ate` (by food), `fallbacks` (by reason), `vetoes` (by reason).
- **Summary:** `!stats`-style one line via `summary()`, logged every 10 minutes when anything happened.
- **Step log:** one line per ask: time, state, eat probability, top food and its probability, and outcome (`ate`, `no-eat`, `fallback`, `veto`).

## Risks / Trade-offs

- **The safety rules overlap the answer key.** They're only the safety-critical part, so the model can't do anything harmful, while timing and choice among good foods stay the model's.
- **Eating changes the held item** mid-action. It's re-equipped after, as auto-eat does.
