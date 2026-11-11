# Following with a Laya model

When the `follow` decision task is on, `!followPlayer` steps with a small Laya model trained in [laya-go](https://gitlab.com/lnkz/laya-go) (`docs/follow.md` there). The model decides each step about four times a second. Mindcraft's pathfinder takes over whenever the model can't help. The language model still decides *to* follow; Laya decides *how*, step by step.

## Turning it on

1. **Serve a follow model** with laya-go, for example on the Mac Studio:
   ```sh
   cd ~/lnkz/laya-go && go run ./cmd/golaya serve -dir data/laya-go     # http://127.0.0.1:11235, models by folder name
   ```
2. **Point the task at it and turn it on** in `settings.js`:
   ```js
   "follow": { "enabled": true, "server": "golaya", "model": "follow-a", ... }
   ```
3. **Check:** `npm run laya:check follow` should show the model answering laya-go's golden request.
4. **Ask a bot to follow you.** The bot log says it's stepping with the Laya follow model.

## Each step

1. **Read the window.** The bot reads the 9×9 columns around it from the world and writes laya-go's prompt `v1` (`src/agent/laya/follow_state.js`). Each column is the place to stand nearest the bot's level, so floors win over roofs and canopies:
   - fences, walls and closed doors read as walls;
   - lava, fire, magma, cactus, berry bushes, powder snow and wither roses read as harmful (`!`);
   - an open column with nothing to stand on within 8 below reads as a deep drop;
   - an unloaded column reads as unknown (`?`).
2. **Ask** the `follow` task for `Move` and `Hazard` (`laya-client`).
3. **Veto** (`src/agent/laya/veto.js`): laya-go's rules refuse any step onto `!` or `?`, any climb of two or more, any drop of four or more onto anything but water, and any corner cut. The model proposes; the rules dispose.
4. **Step** one block with the pathfinder (`GoalBlock`).

**Fallback:** the pathfinder follows for `fallback_ms` (4 s by default) when:
- there is **no answer** (server down, timeout or bad reply);
- the answer has **low confidence** (below the task's `min_confidence`);
- the model says **wait** three times in a row while the bot hasn't arrived;
- the **veto** refuses the move;
- a step doesn't move the bot within 1.5 s (**stuck**).

## Prompt versions and mobs

The `prompt` setting must match the model:

| Model | `prompt` | State |
|---|---|---|
| `follow-a` (or later v1 cycles, `follow-best`) | `v1` | terrain only |
| `follow-m` (or later v2 cycles, `follow-mobs-best`) | `v2` | terrain plus a `Mobs` line |

With `v2`, the bot lists up to 4 hostile mobs from `bot.entities` within 16 blocks, nearest first, as kind and offset (`Mobs zombie E4 N2 skeleton E8 S6`). The model has learned to route around them.

**Mob kinds:** zombie, husk, spider, cave spider, creeper, skeleton, stray, witch. Others, such as cows, are left out.

**The veto also refuses mobs,** with either version: any step a listed mob could hit is refused (reason `mob`). The harm radius is 1.5, or 2.5 for a creeper.

## Settings (the `follow` task)

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | off: `!followPlayer` is exactly as before |
| `server`, `model` | `golaya`, `follow-a` | who answers (see `docs/laya-client.md`) |
| `prompt` | `v1` | the prompt version the model was trained on (`v2` adds mobs) |
| `timeout_ms` | 300 | slower answers count as none |
| `min_confidence` | 0.4 | below this, fall back |
| `step_ms` | 250 | time between decisions while arrived or waiting |
| `fallback_ms` | 4000 | how long the pathfinder follows after a fallback |
| `log_steps` | `true` | write `bots/<name>/logs/laya-follow.jsonl` |

## Measurements

When a follow ends, the bot logs one line:

```
Laya follow: asked 120, stepped 112, fallbacks: low-confidence 3, veto 1; vetoes: drop 1; damage 0, stuck 0.0 s
```

**What to look for:**
- **Stepped ÷ asked** is how often the model was used. With an untrained model it's near 0, because every answer is low confidence. That's correct behaviour.
- **Fallbacks by reason** show what the model can't handle yet.
- **Vetoes** count moves the model wanted but the rules refused. Each is a mistake the model would have made.
- **Damage** should be 0.

The step log has one JSON line per decision: the state, the top move and its probability, the hazard probability, the outcome, and any fallback reason or veto. These are laya-go's future self-play training data, and the place to look when the bot does something odd.

## Tests

`npm test` runs, with no packages needed:
- `test/laya_follow_state.test.js`: the golden contract with laya-go, the alphabet, the block mapping, and the veto;
- `test/laya_follow_loop.test.js`: the loop's steps and fallbacks, with a fake bot, world and model.
