# Design

## Context

- **Two servers** answer the decisions API, the same way:
  - `golaya serve` (laya-go: Go-trained models, default `127.0.0.1:11235`; a model's id is its folder path);
  - MLX-Serve (Apple silicon, `:11234`; for example the pretrained open-source `aac6fef/laya-mlx`).
- **`GET /v1/models`** lists models. Decision models have `"decisions"` in `capabilities`.
- **`POST /v1/decisions`** takes `{model, state, questions}` and answers per question:
  - a choice has `choice` and `probabilities`;
  - a noul has `noul`, the probability that it holds.
- **laya-go's Go client** is the reference (`laya/client.go`): model discovery, request validation, and the answer form.
- **Mindcraft:** settings live in `settings.js`, and model clients in `src/models/`. It runs on Node 20 with ES modules and has no tests yet.

## Goals / Non-Goals

**Goals:**
- One client and one settings shape for every decision task, now and later.
- A model swap is a settings edit, confirmed by `npm run laya:check`.
- Failures never throw into the bot: they return `null` and are counted.

**Non-Goals:**
- Choosing commands from chat with a decision model (a later stage; the LLM does it for now).
- Retries, batching or caching.
- Training, or serving models: laya-go does those.

## Decisions

### Settings
```js
"decision_models": {
    "servers": {
        "golaya": { "url": "http://127.0.0.1:11235" },   // laya-go: golaya serve -dir data/laya-go
        "mlx":    { "url": "http://127.0.0.1:11234" }    // MLX-Serve, for example aac6fef/laya-mlx
    },
    "tasks": {
        "follow": {
            "enabled": false,
            "server": "golaya",
            "model": "follow-a",        // or "" to use the server's only decision model
            "timeout_ms": 300,
            "min_confidence": 0.4
        }
    }
}
```
- **Tasks name the decision, not the model.** The code asks for "follow", and the settings say who answers it.
- **Example swaps, with no code changes:**
  - untrained: `model: "follow-new"`;
  - the pretrained trial: `server: "mlx", model: "aac6fef/laya-mlx"`;
  - trained: `model: "follow-a"`.
- **`min_confidence`** belongs to the task: the client reports it with the answer, and callers decide what to do below it.

### Normal answer form
```js
{
  model: "follow-a",                 // as the server reports it
  ms: 7,                             // round trip
  answers: {
    Move:   { type: "choice", top: "NE", topProbability: 0.61, probabilities: { N: 0.05, NE: 0.61, ... }, confident: true },
    Hazard: { type: "noul", probability: 0.12, top: "false", topProbability: 0.88, confident: true }
  }
}
```
- **`top`:** the highest probability, with ties broken by the order the options were sent (as laya-go's `Ranked`).
- **`confident`:** `topProbability >= min_confidence`.
- **`top` for a noul:** `"true"` above 0.5, else `"false"`.

### Discovery
- **An empty `model`:** the client asks `GET /v1/models` once per server and uses the single model with the `decisions` capability.
- **None, or several:** the task is unavailable, with a clear error saying which models the server has.
- **Caching:** discovery is cached for the session. `check` always re-reads it.

### Failures
`decide` returns `null` and counts the reason:

| Reason | When |
|---|---|
| `disabled` | the task is off or unknown |
| `timeout` | no reply within `timeout_ms` (`AbortController`) |
| `unreachable` | network error |
| `http` | a non-200 status |
| `malformed` | a reply missing a question, or of the wrong type |
| `no_model` | discovery found no single decision model |

The client never throws to the caller, and it logs a failure reason once per minute per task, to avoid flooding the console.

### Counters
`stats(task)` returns `{asked, answered, failed: {reason: n}, meanMs, maxMs}` since start. Callers (the follow loop) add their own measurements on top.

### Check command
`node src/models/laya_check.js [task]` (`npm run laya:check`). For each task, or the one named, it prints:
- the server URL and whether it's reachable;
- the decision models it lists;
- the model the task will use;
- then a sample request and its answer and time.

**Sample requests** are per task: `follow` uses laya-go's golden `v1` request. A task without one only checks reachability and the model list. The exit status is non-zero if any enabled task can't be answered.

### Tests
`node --test test/`, using fake HTTP servers on random ports that answer like `golaya serve` and like MLX-Serve, including MLX-Serve's mixed model list with chat models.

## Risks / Trade-offs

- **`settings.js` is user-edited.** Adding a block could conflict with upstream changes. It's one new top-level key, kept at the end.
- **A short timeout can drop slow first answers** while a server loads a model. `check` warms the model, and the counters show timeouts.
