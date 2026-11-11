# Laya decision models

Mindcraft can ask small local **Laya decision models** for some decisions instead of the language model. A Laya model reads a short state and answers typed questions (pick one option, or say whether a statement holds) with probabilities, in milliseconds, on a CPU. Models are trained in [laya-go](https://gitlab.com/lnkz/laya-go).

The language model still chooses commands from chat. Each kind of decision handed to Laya is a **task**. The first is `follow`: each step while following a player (see `laya-follow`).

## Servers and tasks

Settings live in `settings.js`, under `decision_models`:

```js
"decision_models": {
    "servers": {
        "golaya": { "url": "http://127.0.0.1:11235" },   // laya-go: golaya serve -dir data/laya-go
        "mlx":    { "url": "http://127.0.0.1:11234" }    // MLX-Serve
    },
    "tasks": {
        "follow": {
            "enabled": false,       // off: nothing changes
            "server": "golaya",
            "model": "follow-a",    // "" uses the server's only decision model
            "timeout_ms": 300,      // slower answers count as none
            "min_confidence": 0.4   // below this, answers are marked not confident
        }
    }
}
```

- **Servers:** any server speaking the decisions API works: `golaya serve` from laya-go, or MLX-Serve. Both answer `GET /v1/models` (decision models have the `decisions` capability) and `POST /v1/decisions`.
- **Tasks** name the decision, not the model. Code asks for `follow`, and the settings say who answers.
- **Swapping models is a settings change:**

| Model | Settings |
|---|---|
| untrained (answers about evenly) | `"model": "follow-new"` |
| open-source pretrained Laya, as a trial | `"server": "mlx", "model": "aac6fef/laya-mlx"` |
| trained in laya-go | `"model": "follow-a"` |

**MLX-Serve on another Mac:** it only answers decisions from other machines for models marked as shared on the LAN in the app. Mark the model shared there, then set the server's URL, for example `http://192.168.20.30:11234`.

## Checking a task

After changing a task, check it:

```sh
npm run laya:check            # every task
npm run laya:check follow     # one task
```

```
follow (enabled)
  server   http://127.0.0.1:11235  reachable
  models   follow-a, follow-new
  uses     follow-a
  sample   Hazard 0.04, Move NE 0.61 in 7 ms
```

- **Sample request:** `follow`'s sample is laya-go's golden prompt `v1` request (`test/fixtures/laya-follow-v1/`).
- **Exit status:** 1 if an enabled task can't be answered. A task that's off is only reported.

## In code

```js
import { laya } from './src/models/laya.js';

const r = await laya.decide('follow', state, questions);
if (!r) { /* no answer: fall back */ }
else if (!r.answers.Move.confident) { /* unsure: fall back */ }
else { /* act on r.answers.Move.top */ }

laya.stats('follow');  // { asked, answered, failed: { disabled, timeout, ... }, meanMs, maxMs }
```

- **Answers** come in one form: `type`, `top`, `topProbability`, `confident`, and for a choice `probabilities`, for a noul `probability`.
- **`decide` never throws.** On any failure it returns `null` and counts the reason: `disabled`, `timeout`, `unreachable`, `http`, `malformed` or `no_model`. It logs a reason at most once a minute per task.

## Tests

```sh
npm test      # node:test, no extra packages; fake servers answer like golaya serve and MLX-Serve
```

## The served prompt version

laya-go keeps one model per skill under the name golaya serves and replaces it when a better one is trained. Each
model folder records the prompt version it expects (`model-info.json`); golaya serve lists it as `prompt_version` in
`GET /v1/models` and names it in each decision (`X-Laya-Prompt-Version`). `taskSettings(task).prompt` is that version
(read every 10 s at most, and at once from a decision's header), and the task's `prompt` setting only when the server
names none. So when laya-go replaces director (v1) with a v1.2 model, the director writes the v1.2 text from the next
decision on, with no settings change. A job already running (a follow, a mine run) keeps the prompt it started with
until it ends; laya-go's "hold swaps" tick box keeps models from changing during a live test.
`npm run laya:check` prints the prompt each task's sample used and whether the server named it.
