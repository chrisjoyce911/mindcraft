# Design: rebuild andy's bot (lean, typed, no LLM leftovers)

All times Brisbane (AEST, UTC+10). Written 2026-11-11 on branch `bot-rebuild-spec` (from `laya-follow` c4b7d91).
This is a spec only; nothing here is implemented yet.

## 1. Context

andy is decided by small Laya models (laya-go, served by `golaya serve` on 127.0.0.1:11235). The chat LLM is off
(`llm: false`). The body is Mindcraft on mineflayer, with our layer in `src/agent/laya/` (6,619 lines). The failures
that hurt now are structural, not in mineflayer:

- **Actions are cooperative.** `ActionManager` runs a job as a closure (and, for the LLM, as eval'd code). An
  interrupt sets `bot.interrupt_code`; code that doesn't look at it keeps running. `stop()` then logs "waiting for code
  to finish executing…" every 300 ms and after 10 s calls `process.exit(1)`; `main.js` restarts the agent and the job
  is gone (live play 2026-11-11 18:12).
- **Many owners of the body.** Twelve modes (`self_preservation`, `unstuck`, `laya_defending`, `cowardice`,
  `self_defense`, `laya_eating`, `hunting`, `item_collecting`, `torch_placing`, `elbow_room`, `idle_staring`, `cheat`)
  each fire every tick and can call `execute()`, which interrupts whatever runs. The director then sees a "safety
  mode" on the stack it didn't decide and has to reconcile (`SAFETY_MODES` in `director.js`).
- **Strings as interfaces.** The command model's answer is turned into `!layaMine("iron", 4)` text, parsed back by the
  command system, run as an action label `action:layaMine`; jobs are identified by their command name; skills are
  found by string in `skills.js` (2,583 lines; laya reaches 16 of its skills directly, and skills.js imports laya back — a two-way tangle).

fix-round4 (in progress, `fix-round4` worktree, no change folder yet) is patching the symptoms inside the old
structure; its lessons are design inputs here:

| fix-round4 lesson | Where it goes in the rebuild |
|---|---|
| `runStoppable`: a job's work returns within 100 ms of an interrupt even when a skill under it doesn't, via an AsyncLocalStorage token checked by `stopped(bot)` | Replaced by a real `AbortSignal` passed to every actuator (§4). No ambient token, no polling the bot. |
| `interruptBot`: `pathfinder.stop()` only acts at the next node; clearing the goal (`setGoal(null)`) ends `goto()` at once; `collectBlock.cancelTask()` adds listeners per call → MaxListeners leak before the 2026-11-11 crash | `core/motion` owns the pathfinder; abort = `setGoal(null)` once + reject. We don't use `mineflayer-collectblock` at all (dig/pickup are our actuators). |
| `job_save.js`: the player's job is saved to `bots/<name>/laya-job.json` while on the stack and restored paused after a restart | Persistence (§6) generalises this: every job type has a typed, serialisable `progress`. |
| `attacks.js`: a mob is an attacker only if it hurt andy or a player recently (blame range, 5 s `Me` line, director v1.3) | The "defend only when andy or a player is attacked" rule (§5) is the director's, fed by the `attacks` sensor. |
| Eat/heal pause `unstuck` (standing still on purpose) | There is no `unstuck` mode; stuck detection is a fact the running actuator sees (§5). |

## 2. Goals / non-goals

Goals: one owner of the body at a time; every interrupt stops within a bounded time (target 250 ms, hard 2 s, never a
process exit); typed facts, decisions, jobs and commands; models stay in Go behind `golaya serve`; the
`laya-*.jsonl` logs keep their format; the andy MCP tools and the 16 game scenarios keep working unchanged; a much
smaller codebase and dependency tree.

Non-goals: rewriting protocol/physics/pathfinding (stay on mineflayer + mineflayer-pathfinder); changing any model,
prompt text or question set; multi-agent LLM features (conversations between bots, tasks/benchmarks, construction,
vision, speech); a new UI.

## 3. Package layout

A new tree `bot/` (TypeScript, strict) beside `src/` (the old bot stays runnable until cut-over). Arrows are the only
allowed imports; enforced by `dependency-cruiser` (or an eslint `import/no-restricted-paths` rule) in CI.

```
bot/src/
  types/        facts, decisions, jobs, commands, events — pure types + enums, no imports
  core/         Body: the one mineflayer bot, connection, Clock, Abort helpers, Motion (pathfinder owner)
  world/        read-only queries over the body (blocks, entities, inventory, recipes via minecraft-data)
  sensors/      Facts producers: vitals, threats/attacks, pack, home, light/time, danger, player, stuck
  actuators/    the only code that moves the body: goTo, follow, dig, place, collect, craft, smelt, eat,
                attack, equip, chest (open/put/take), pickup, sleep — each (body, args, signal) → Outcome
  models/       LayaClient (HTTP, /v1/models + /v1/decisions, backoff, served prompt version) and one
                module per model: render(state) → text (byte-identical to laya-go golden), questions, parse(answer)
                → typed Decision, rules fallback
  jobs/         Job types (follow, come, stay, mine, farm, craft, gather, hunt, give, store, setHome), each a
                step loop: facts → model/rules → actuator; typed Progress for persistence
  director/     the arbiter: JobStack, Activity decision (director model + rules), activity runners
                (defend, flee, eat, heal, unload), the tick loop
  chores/       the chores planner (what to do when idle and chores are on) — produces Jobs, never acts
  command/      chat → command model → typed Command; Command → Job/Stop/Reply; the legacy `!cmd(...)` parser
  home/         places (home chest, table, bed), mine memory, stumps — persisted JSON store
  harness/      mindserver-compatible socket.io server + process launcher contract (test tools, MCP)
  log/          JSONL writers (laya-*.jsonl, unchanged), console logger, metrics
  main.ts       wires it all; one process per bot
```

Dependency order (lower may not import higher):

```
types ← core ← world ← sensors ← models ← actuators ← jobs ← chores ← director ← command ← harness ← main
                                   log, home: imported by anyone above core; import only types/core
```

`models/` sits below `jobs/` because jobs ask models; `actuators/` never import `models/` (an actuator does one
physical thing; the decision is the job's). `director/` is the only thing that starts, pauses or cancels jobs.

### 3.1 Key types (sketch; final names in implementation)

```ts
// types/facts.ts — what sensors report; one snapshot per tick
type MobKind = 'zombie' | 'skeleton' | 'creeper' | 'spider' | 'other';
type Danger = 'none' | 'fluid' | 'fall' | 'drowning' | 'fire';
type Armed = 'none' | 'sword' | 'axe' | 'other';
interface Attack { by: MobKind; entityId: number; at: number; dist: number }
interface Facts {
  t: number; pos: Vec3; health: number; food: number; armed: Armed; armor: number;
  hostiles: number; nearest: { kind: MobKind; dist: number } | null;
  me: Attack | null;                       // a mob hurt andy in the last 5 s (director v1.3 Me line)
  player: { name: string; attacked: Attack | null; dist: number } | null;
  light: number; night: boolean; under: boolean; danger: Danger;
  free: number; valuables: number; foodItems: number; home: { dist: number } | null;
  stuck: boolean;                          // the running actuator made no progress for N s
}

// types/decisions.ts — one union per model question, exactly the model's answer words
type Activity = 'continue' | 'defend' | 'flee' | 'eat' | 'heal' | 'unload' | 'resume' | 'idle';
interface Decision<A extends string> { answer: A; source: 'model' | 'rules'; rule?: string; p?: number; why?: string }

// types/jobs.ts
type JobKind = 'follow' | 'come' | 'stay' | 'mine' | 'farm' | 'craft' | 'gather' | 'hunt' | 'give' | 'store' | 'home';
type JobSpec =
  | { kind: 'follow'; player: string; distance: number }
  | { kind: 'mine'; ore: Ore; count: number }
  | { kind: 'farm'; crop: Crop | 'any'; goal: { count: number } | { minutes: number } | 'forever' }
  | { kind: 'craft'; item: ItemName; count: number }
  | { kind: 'gather'; item: ItemName; count: number }
  | { kind: 'hunt'; mob: MobName; item: ItemName; count: number }
  | /* come, stay, give, store, home */ ...;
type JobOrigin = 'player' | 'chore';
interface JobState<P> { id: string; spec: JobSpec; origin: JobOrigin; by?: string; progress: P;
                        status: 'running' | 'paused'; startedAt: number }
type JobEnd = { how: 'done' } | { how: 'failed' | 'blocked'; reason: string } | { how: 'cancelled' };

// types/commands.ts — what a player can ask, after the command model (or the legacy parser)
type Command =
  | { kind: 'job'; job: JobSpec }
  | { kind: 'stop' } | { kind: 'chores'; on: boolean }
  | { kind: 'reply'; text: string } | { kind: 'ignore' };

// actuators: every actuator has this shape
type Outcome = { ok: true } | { ok: false; reason: FailReason };   // FailReason: a closed enum
type Actuator<A> = (body: Body, args: A, signal: AbortSignal) => Promise<Outcome>;
```

String model answers are parsed once, in `models/<task>.ts`, into these unions; anything outside the set is a
`malformed` model answer and the rules decide (as today).

## 4. Cancellation and body ownership

- **One owner.** `director` holds a `BodyLease`: at most one runner (a job step or an activity) holds it; taking it
  aborts the previous holder's `AbortController` and awaits its settle (bounded, see below). Sensors and the harness
  only read.
- **AbortSignal everywhere.** Every actuator, wait and pathfinder call takes a `signal`. `core/abort.ts` gives
  `sleep(ms, signal)`, `race(promise, signal)`, `withTimeout(ms, signal)`. `core/motion.ts` wraps
  `pathfinder.goto` so abort = `setGoal(null)` (ends `goto()` at once, fix-round4) + `stopDigging()` + `clearControlStates()`.
- **Bounded stop.** An aborted runner must settle within 250 ms (target). If it hasn't in 2 s, the lease is taken
  anyway, the body is reset (`clearControlStates`, `setGoal(null)`, `stopDigging`, `pvp.stop`), the incident is logged
  (`laya-director.jsonl` event `stop-overrun` with the runner name), and the late promise is ignored. **No
  `process.exit` on a slow stop.** A CI test injects a never-settling actuator and asserts the lease moves in ≤ 2 s.
- **Timeouts.** Each actuator has a default ceiling (goTo 60 s or path length × 1 s, dig 10 s, craft 5 s, eat 5 s…);
  each job a step budget (`max_steps`, as today) and an optional wall-clock limit. All are settings, not magic numbers.

## 5. Runtime model

### 5.1 Event loop

A single async loop in `director/loop.ts`:

1. Events (chat, entityHurt, death, spawn, respawn, job end, harness message) are queued; they never act directly.
2. Every tick (default 250 ms; the director decision ≈ 1 s as today, plus immediately on events) the sensors build one
   `Facts` snapshot (cached per tick; expensive scans — nearby blocks — rate-limited).
3. Priority arbitration (§5.2) picks who should hold the body.
4. If that differs from the holder, the lease moves (§4). Otherwise the running job's next step runs.

### 5.2 Priorities

`player command > safety > job > chore`, decided in one place:

| Level | Source | Examples | Pre-empts |
|---|---|---|---|
| 1 player command | `command/` | stop, follow, mine 8 iron, chores off | everything; `stop` clears the stack |
| 2 safety | director Activity answer | defend, flee, eat, heal (unload counts as job-level) | jobs and chores; the job is **paused** under it |
| 3 job | job stack top (origin player) | mine, farm, craft, gather, follow… | chores |
| 4 chore | chores planner, only when idle and chores on | store, smelt, plant saplings, get food | nothing |

A player command replaces the top job (today's `replaceTop`); a safety activity pauses it; when the activity ends the
director answers `resume` and the job continues from its `progress`.

### 5.3 Modes are replaced by director decisions

| Old mode | Replacement |
|---|---|
| `laya_defending`, `self_defense`, `cowardice` | director `defend` / `flee` activities, defend-only-attackers (§5.4) |
| `self_preservation` (water, lava, fire, falling) | sensor `danger` → director rule `flee-danger` (exists) → `escape` actuator |
| `laya_eating`, mineflayer-auto-eat | director `eat` / `heal` (the eat model) |
| `unstuck` | `stuck` fact from `core/motion` progress watch; the **running actuator** retries/replans; after N failures the step fails with `blocked` — never a second owner |
| `item_collecting` | jobs pick up their own drops (dig/collect/hunt actuators) |
| `torch_placing` | mine job places torches (it does today in its plan) |
| `hunting` | removed (hunting is a job: `hunt`) |
| `elbow_room`, `idle_staring`, `cheat` | removed |

### 5.4 Defend only when andy or a player is attacked

User decision 2026-11-11 (fix-round4): andy fights only a mob that hurt andy or a player within the last 5 s (the
`attacks` sensor: `entityHurt` with a source, else the nearest hostile within the blame range of the hurt player;
forgotten on `entityGone`). Hostiles merely nearby are a `flee` or `continue` question for the director, never a fight.
The defend activity targets only those attackers.

### 5.5 Persistence

Today's files under `bots/<name>/` keep their names and formats, so the old and new bot can swap on one world and the
harness (`forgetAgent` deletes `memory.json` and writes `laya-chores.json` as `{on:false}`) keeps working:

| File | Holds | Today | New bot |
|---|---|---|---|
| `memory.json` | `places` `{name:[x,y,z]}` (home_chest, home_bed, last_death_position, chores homes) | inside the LLM memory record; **loaded only when `load_memory`** | only `{places}`; always loaded (question Q6) |
| `laya-chores.json` | `{on, centreKind, chestItems, chestAt, stumps}` | `chores.js` | same |
| `laya-mines.json` | mine memory list | `skills.js` | same |
| `laya-job.json` | the job stack | fix-round4 (new) | same file, typed: `{savedAt, entries:[{spec, origin, progress, status}]}` |

All writes are atomic (temp + rename). On start, a stack saved less than 10 min ago is restored **paused** and the
director resumes it (fix-round4's behaviour, generalised to every job type via typed `progress`); older, andy says
which job was lost.

### 5.6 Logging

`log/jsonl.ts` writes `bots/<name>/logs/laya-<task>.jsonl` with **the same field names and value formats** as today
(director, command, follow, eat, defend, craft, mine, farm, chores). A golden test compares a recorded line from the
old bot and the new for each file (same state text, same keys). The console log keeps the `[laya]` prefixes that
`andy_logs` greps. Added (new files only, never new fields in the old ones): `bot-metrics.jsonl` (§7).

## 6. Models

- `models/client.ts` = today's `src/models/laya.js` client ported 1:1 (backoff 1–10 s, reasons
  `disabled|timeout|unreachable|http|malformed|no_model`, served prompt version from `GET /v1/models` with 10 s TTL).
- Per task: `render.ts` (state text), `questions.ts` (question set per prompt version), `parse.ts`
  (answer → union), `rules.ts` (fallback). Golden tests: each renderer against laya-go's sample requests byte for
  byte (`games/<task>/.../*_sample_request.json`), as `test/laya_*` do today; the rules against laya-go's situation
  sets.
- **Batching:** the director, eat and defend questions are asked in one `/v1/decisions` request per tick when more than
  one is due (the API already takes several questions; separate tasks → parallel requests with one shared deadline).
- Timeouts as settings today (300 ms most, craft 2 s).

## 7. Efficiency (measure before and after)

Measured with the same test world, same seed, LLM off, by `tools/andy-tests` plus a `bot-metrics.jsonl` writer:

| Metric | How | Old baseline | Target |
|---|---|---|---|
| Cold start → spawned | process start → `spawn` | measure (task 1.3) | ≤ 50 % of old |
| Install size | `du -sh node_modules` | 1.2 GB, 447 packages | < 150 MB |
| RSS after 10 min first day | `process.memoryUsage()` | measure | ≤ 60 % of old |
| Tick cost | p50/p95 ms per loop iteration | n/a (modes tick 300 ms) | p95 < 5 ms excl. awaits |
| Model latency | p50/p95 per task, from client | from laya-*.jsonl | unchanged or better (batching) |
| Interrupt → body free | abort → lease moved | up to 10 s + exit | p95 < 250 ms, max 2 s |
| Process exits / restarts per suite | harness log | > 0 in live play | 0 |

## 8. Build and runtime choices

- TypeScript 5, `strict`, `noUncheckedIndexedAccess`; ESM; Node 22. Build with `tsc` to `bot/dist` (no bundler);
  dev with `tsx`. Tests with `node --test` on compiled output (same runner as today) or `vitest` — see questions.
- Dependencies kept: `mineflayer` (4.33.0 + our patch), `mineflayer-pathfinder` (+patch), `minecraft-data` (+patch),
  `prismarine-item`, `vec3`, `socket.io` (harness), `mineflayer-pvp` (+patch) only if the attack actuator keeps it.
  Dropped: all LLM SDKs, `ses`, `canvas`, `node-canvas-webgl`, `three`, `prismarine-viewer`, `express` (unless the UI
  stays), `google-translate-api-x`, `cheerio`, `mineflayer-collectblock`, `mineflayer-auto-eat`,
  `mineflayer-armor-manager` (equip is an actuator), `replicate`, `yargs`.
- `patches/` move with the new package (`patch-package`).

## 9. Migration

Built alongside: `bot/` with its own `package.json` (or a workspace) and entry `bot/dist/main.js`, launched by the
same `tools/test-world/bot.js` contract (`SETTINGS_JSON`, `--profiles`, mindserver port), selected by an env var
`ANDY_BOT=new|old` (default old until cut-over). Each phase moves one capability and must pass its gate. See
tasks.md for phases and "done means".

## 10. Risks

| Risk | Mitigation |
|---|---|
| State-text drift breaks served models | golden byte tests per task, gate on every phase |
| Losing behaviour hidden in skills.js (e.g. mine floor checks, placing retries, stumps) | port by job, with the existing `test/laya_*` unit tests rewritten against the new types; game suite gate |
| Harness drift (MCP tools break) | harness contract spec + the existing `test/andy_tests_*` run against both bots |
| TypeScript slows iteration with parallel tabs | old bot keeps getting fixes until cut-over; port fixes forward per phase |
| Two codebases for a while | time-box: cut-over target after phase 5; old `src/` deleted in phase 7 |
| mineflayer upgrade temptation | pin 4.33.0 + patches for the rebuild; upgrade is a separate change |
