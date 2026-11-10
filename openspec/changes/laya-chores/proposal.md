# Proposal

## Why

Roadmap item 5 (`docs/laya-roadmap.md`, agreed 2026-11-10): when andy is idle with nothing assigned, he should do useful chores on his own. He picks the job with the chores model (laya-go `chores-game`), does it and asks again. Any player instruction interrupts him, and he resumes when idle again. At night or in danger he only takes safe jobs near home, or rests.

## What Changes

- **Chores mode** (`src/agent/laya/chores.js`, a mode in `modes.js`):
  - **When it starts:** chores are on (`!layaChores("on")`, or settings `chores.enabled`), a home chest is known, and andy has been idle for `idle_seconds` (30). Idle means no action running, no player message for that long, and not following anyone.
  - **The loop:**
    1. build the chores state;
    2. ask the model;
    3. when the model is unsure, or Safe is false for a job away from home, use the ported rules;
    4. run the job's command;
    5. ask again.
  - **Interruption:** a player message or command interrupts like the defend mode does. It stops the current job cleanly: the job's own stop, any unload in progress finished first. The mode resumes after the next idle period.
- **The chores state** (`chores_state.js`), laya-go's prompt v1 byte for byte:
  - time of day, health, food, hostiles, at home (within 16 of the home chest);
  - **Stock:** the home chest, the purpose chests' last-read contents and the pack;
  - **Farm lines** from `farms` memory (`laya-farm-v3`);
  - **Auto lines** from `builds` memory with Full and Stalled (`laya-build` upkeep);
  - **Compost** surplus;
  - **Want:** the first missing material of the build queue's head.
- **Jobs and commands:**

  | Job | Runs |
  |---|---|
  | tend | `!layaFarm` on that field (prompt v3 picks the work), bounded by `job_minutes` |
  | expand | `!layaBuild(<field>, <next lot stage>)` |
  | trees | `!layaTrees` on the tree farm |
  | lumber | `!layaTrees` on wild trees |
  | compost | the composter routine |
  | mine | `!layaMine(ore, n)` with n the shortfall |
  | empty | the build's upkeep |
  | build | `!layaBuild` of the queue head |
  | rest | wait `rest_seconds` near home (sleep in a bed if one is near at night) |

  Every job is bounded by `job_minutes` (10), so chores never run away.
- **`!layaChores("on"|"off")`.** Off stops the mode and the current chore. The setting is kept in memory (`chores_on`).
- **Never discard** (the standing rule): jobs unload into chests through `laya-purpose-chests`. Chores never drop items, even with a full pack.
- **Log:** `bots/<name>/logs/laya-chores.jsonl` records each decision: state, answer, rule used, job outcome, Brisbane time.
- **Settings** (`decision_models.tasks.chores`): `enabled` (false), model `chores-a`, `min_confidence`, `idle_seconds`, `job_minutes`, `rest_seconds`, `log_steps`.

## Capabilities

### New Capabilities
- `laya-chores`: chores mode, the chores state, the job-to-command mapping, interruption and resume, `!layaChores`.

## Impact

- **New:** `src/agent/laya/{chores,chores_state}.js`, `test/laya_chores*.test.js`, `test/fixtures/laya-chores/`, `docs/laya-chores.md`.
- **Changed:** `src/agent/modes.js` (chores mode, lowest priority, after idle), `commands/actions.js` (`!layaChores`), `settings.js`, `src/models/laya_check.js`.
- **New in-game scenarios:**
  - `chores-idle-start`: chores on, idle 30 s; andy starts a job (logged);
  - `chores-interrupt`: a player says "andy come here" mid-chore; andy stops and comes, and resumes after idle;
  - `chores-night`: `/time set night`; andy rests or tends at home, never mines;
  - `chores-logs-short`: logs at 0 with no tree farm; the job is lumber;
  - `chores-off`: "andy take a break" or `!layaChores("off")` stops it.
- **Depends on:**
  - laya-go `chores-game`;
  - `laya-farm-v3` (the farms map);
  - `laya-build` (builds, queue, upkeep);
  - `laya-purpose-chests`.

  The chat phrasings come with `laya-commands-v3`. It works without them through `!layaChores`.
- **Without the farm or build changes,** their lines are simply empty. Chores then reduce to lumber, mine, compost and rest.
