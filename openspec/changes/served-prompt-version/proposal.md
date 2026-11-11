# Served prompt version

## Why
laya-go now keeps one model per skill under the name golaya serves, and replaces it when a better candidate is
trained (laya-go change `one-name-models`, 2026-11-11). A replacement can expect a newer prompt (director v1 → v1.2,
command v2.1 → v2.2). The model folder records the prompt version it expects and golaya serve exposes it; Mindcraft
must write that version so a swap needs no settings change.

## What changes
- `src/models/laya.js` keeps the prompt version each server reports per model (`prompt_version` in `GET /v1/models`,
  refreshed at most every 10 s, and the `X-Laya-Prompt-Version` header of every decision, which updates it at once).
- `taskSettings(task)` gives `prompt` as the served model's version, falling back to
  `decision_models.tasks.<task>.prompt` when the server doesn't say; the value is read when `prompt` is read, so the
  director (which keeps its task object) follows a swap.
- The client reads every configured server's versions as soon as it is loaded (2 s at most, in the background), so
  the first decisions use the served version; no agent code changes (another tab works on the actuators).
- `laya:check` loads the sample for the served prompt version and prints it.
- Every prompt version in use stays supported (follow v1/v2, command v1–v2.2, farm/mine v1/v2/v2.1, director
  v1/v1.2, chores v1).
- Settings comments: the prompt lines are fallbacks.

## Capabilities
- Modified: `laya-client`.

## Impact
`src/models/laya.js`, `src/models/laya_check.js`,
`test/laya_served_prompt.test.js`, `docs/laya-client.md`. A running job keeps the prompt it started with.
