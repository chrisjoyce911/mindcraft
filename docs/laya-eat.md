# Eating with a Laya model

When the `eat` decision task is on, a reflex (the `laya_eating` mode) decides **when** to eat and **what**, with a small Laya model trained in [laya-go](https://gitlab.com/lnkz/laya-go) (`docs/eat.md` there). Today's `mineflayer-auto-eat` plugin (eats at hunger 14 or below, most food points first, five foods banned) is the fallback.

## What the model is taught

laya-go's rules:
- **Golden apples** are emergency heals: eaten at health 6 or below (enchanted at 4 or below), even in danger.
- **Danger:** never stop to eat beside danger (eating takes 1.6 s), or when full.
- **When to eat:** when starving (6 or below), to get back to 18 so health regenerates, or for a top-up that wastes nothing.
- **What to eat:** the food that fills the gap best.
- **Bad food** (rotten flesh, spider eye and others) only when starving with nothing else.

## Turning it on

1. **Serve the eat model** with `golaya serve` (laya-go), alongside the follow model.
2. **In `settings.js`,** set `"eat": { "enabled": true, "server": "golaya", "model": "eat-a", ... }`.
3. **Check:** `npm run laya:check eat` shows whether the server and model are there.

With the task on, auto-eat is switched off except during fallbacks. Turning the task off switches auto-eat back on.

## Each decision (every `check_ms`, 2 s by default)

1. **Build the state** (`src/agent/laya/eat_state.js`), exactly laya-go's eat prompt `v1`:
   - health rounded down;
   - food and saturation;
   - danger: a hostile mob within 8 blocks or lava within 2;
   - up to six carried foods, with count, points, **true saturation** and tag.

   minecraft-data's `saturation` field is wrong; the table here uses `saturationRatio ÷ 2`, as laya-go does.
2. **Ask** the `eat` task for `Eat` and `Food`.
3. **Eat** the chosen food when both answers are confident, they agree, and the **safety rules** allow it. The rules refuse:
   - food not carried;
   - golden apples above health 6;
   - bad food above hunger 6;
   - anything in danger or at full hunger, except an emergency golden apple.
4. **Otherwise fall back:** auto-eat runs for `fallback_ms` (10 s by default). The reasons are `no-answer`, `low-confidence`, `disagree` (says eat but picks none, or the reverse) and `veto`.

## Measurements

Every 10 minutes, if anything happened, the console shows:

```
Laya eat: asked 300, ate bread 4, cooked_beef 2; fallbacks: low-confidence 3; vetoes: none
```

- **Step log:** `bots/<name>/logs/laya-eat.jsonl` has one line per decision: the state, the eat probability, the chosen food and its probability, and the outcome (`ate`, `no-eat`, `fallback`, `veto`).
- **Vetoes:** each is a choice the safety rules caught.
- **Fallbacks:** each is a situation the model wasn't sure of. Both are good training material later.

## Tests

`npm test` runs `test/laya_eat.test.js`:
- the golden contract with laya-go;
- true saturation and the six-kind limit;
- the safety rules;
- the reflex's eat, don't-eat, veto, fallback and timing decisions, with a fake bot and model.
