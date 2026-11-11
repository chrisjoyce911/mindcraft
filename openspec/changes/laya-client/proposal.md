# Proposal

## Why

The long-term aim is a Mindcraft bot whose decisions come from small local **Laya decision models**, with the large language model needed less and less. The first stages are:
- following a player (`laya-follow`, next);
- later, deciding which command a request like "follow me" means, which the LLM does for now.

Every stage needs the same thing: a standard way to ask a decision model a question. That means:
- one client;
- one place in the settings that says, for each kind of decision (a **task**), which server and model answer it;
- a quick way to check a model is there and answering.

Switching a task from an untrained model, to the open-source pretrained Laya on MLX-Serve as a trial, to a model trained in laya-go, should be a settings change, with no code change.

## What Changes

- **A `decision_models` block in `settings.js`:**
  - **servers** by name: a URL, for `golaya serve` or MLX-Serve; both speak the same decisions API;
  - **tasks** by name: the server, the model id (or none, to use the server's only decision model), whether the task is on, a timeout and a minimum confidence.

  Every task is off by default, so nothing changes until one is turned on.
- **A client** (`src/models/laya.js`):
  - `decide(task, state, questions)` returns answers in one normal form: each question's type, top choice and every option's probability, or the noul probability. It returns `null` when the task is off or unknown, or when the request fails, times out or returns something malformed. Callers fall back on `null`.
  - `models(server)` lists a server's decision models.
  - `check(task)` asks a task's model a known question and reports the model, the answer and the time taken.
- **Per-task counters** for asks, answers, failures by reason, and answer time, readable by the code that uses the task.
- **`npm run laya:check`:** checks every configured task, or one named task. It prints the server, the model, whether it's reachable, the decision models the server has, and a sample answer with its time. That way a model swap is confirmed before the bot relies on it.
- **Tests** with Node's built-in runner (`npm test`, no new dependencies), against fake servers that answer like `golaya serve` and MLX-Serve.
- **Not in this change:** any use of the client by the bot (`laya-follow` is the first), and any change to the LLM or its commands.

## Capabilities

### New Capabilities
- `laya-client`: the decision-model settings (servers and tasks), the client and its normal answer form, model discovery, failure handling, per-task counters, and the check command.

### Modified Capabilities

## Impact

- **New code:** `src/models/laya.js`, `src/models/laya_check.js`, and `test/laya_client.test.js`.
- **Changed:**
  - `settings.js` gains `decision_models` (every task off);
  - `package.json` gains `test` and `laya:check` scripts.
- **Untouched:** every behaviour of the bot.
