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
  jobs/         Job types (follow, come, stay, give, store, setHome) and one skill job per skill model (§11: farm,
                mine, craft, hunt, gather, place), each a step loop: facts → skill model/rules → one typed step →
                one actuator call; typed Progress for persistence
  director/     the arbiter: JobStack, Activity decision (director model + rules), activity runners
                (defend, flee, eat, heal, unload), the tick loop
  chores/       chores v2 (§11.2): when idle with chores on, picks the skill and target (or one single step) —
                produces a SkillTask, never acts
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

## 11. Specialised skill models (user decisions 2026-11-11 18:40 and 18:50)

Each model does one explicit thing and is trained for that only. Today's chores model picks one of 25 chores, and each
chore is a hand-written routine in `chores_actions.js` (`ACTUATORS`) with its amounts fixed in code (4 or 16 logs, 6
or 14 cobble, 16 seeds). After the change:

- **Chores picks the specialised model to use, with its target.** Each answer maps 1:1 to one model (or one single
  step), so nothing decides anything in between. "Food" alone is not an answer, because it could mean hunt or farm:
  chores picks `hunt` or `farm` itself.
- **The skill model picks the steps.** Code runs **one step at a time** and decides nothing beyond the step.

```
chores answer (typed SkillTask) ──► that skill's model ──► typed Step ──► one actuator call ──► Outcome
        ▲                                                                                        │
        └──── recent result per model (done / failed: reason, age) ◄────────────── task ends ◄────┘
```

There is **no delegation between skills**. A skill that lacks something ends with `failed: missing <item>`, and
chores, seeing that result, picks the skill that gets it (for example `gather logs`).

**Consistency with laya-go.** The laya-go side (games, rules, data, training) is tab rules2's laya-go OpenSpec change
`skill-models` (`~/lnkz/laya-go-rules2/openspec/changes/skill-models`, proposal written 18:37). Its shared
`skills-spec.md` holds the authoritative state lines, answer words, caps and golden requests. Where this section and
that spec differ, **the laya-go game definitions win**; tasks.md 0.3 records the reconciliation.

- **Already aligned with rules2's proposal:**
  - Models: farm, mine, craft, hunt, gather, place.
  - Mine covers stone, cobble, coal, ores and night mining.
  - Gather covers logs, seeds, wool and sand.
  - Craft (data v2.2) owns the whole recipe chain and never takes the player kit.
  - Hunt leaves two of each kind near the base and searches out to 193.
  - Place works on a top-down grid of the base.
- **Not yet in rules2's proposal (it predates 18:50):**
  - The chores answers below replace its 10 goals plus a "goal runner" in bot code. With 1:1 answers there is no goal
    runner.
  - The chores state below (pack and chest summaries, kit apart, recent results per model) replaces "v1.1 lines with
    Blocked".

### 11.1 Models after the change

| Model | Status | Does one thing | Asked by |
|---|---|---|---|
| director | stays | Activity (continue/defend/flee/eat/heal/unload/resume/idle) | director loop |
| command | stays | player chat → command | command/ |
| defend, eat, follow | stay | fight steps, when/what to eat, follow steps | director activities, follow job |
| **chores** (v2) | changed | picks the next skill and its target (§11.2) | director, when idle with chores on |
| farm | exists | farm steps (till, plant, water, harvest, breed, pond…) | farm skill |
| mine | exists | mine steps for cobble, coal and ores (plan, tunnel, collect, torch, unload) | mine skill |
| craft | exists, data v2.2 | the whole recipe chain (log → planks → sticks → item), smelting included | craft skill |
| **hunt** | new | which animal, attack or pick up, when enough | hunt skill |
| **gather** | new | logs, seeds, wool, sand: which tree or source, when enough | gather skill |
| **place** | new | where a table, furnace, chest, torch, bed or sapling goes | place skill |

### 11.2 Chores v2: answers

Each answer is one model plus a target, or one single step:

| Answer (question `Do`, plus `Target` where shown) | Runs | Target words |
|---|---|---|
| `hunt` | hunt model | none (hunt decides the animal and when enough) |
| `farm` | farm model | none (any crop) |
| `gather` + `logs\|seeds\|wool\|sand` | gather model | the resource |
| `mine` + `cobble\|coal\|iron` | mine model | the resource (iron = raw_iron) |
| `craft` + item | craft model | a short item list: wooden/stone/iron pickaxe, axe, sword, shovel, hoe; torch; crafting_table, furnace, chest, bed; bread; player kit |
| `place` + thing | place model | crafting_table, furnace, chest, bed, torches, saplings |
| `cook` | one step: smelt raw food at the furnace (craft actuator `smelt`) | none |
| `store` | one step: put the pack in the home chest (keep list as today) | none |
| `sleep` | one step: sleep in the bed | none |
| `rest` | one step: stand at home for N s (nothing worth doing) | none |

`unload` stays the director's activity (§5.2). Whether `store` is the same as unload is open (Q15).

```ts
type ChoresAnswer =
  | { do: 'hunt' } | { do: 'farm' }
  | { do: 'gather'; target: 'logs' | 'seeds' | 'wool' | 'sand' }
  | { do: 'mine'; target: 'cobble' | 'coal' | 'iron' }
  | { do: 'craft'; target: CraftTarget }
  | { do: 'place'; target: 'crafting_table' | 'furnace' | 'chest' | 'bed' | 'torches' | 'saplings' }
  | { do: 'cook' } | { do: 'store' } | { do: 'sleep' } | { do: 'rest' };
```

### 11.3 Chores v2: state

The state is a summary, never full item lists: **counts by kind**.

- **Pack and chest separately.** Both what andy carries and what is in the home chest are shown.
- **The player kit apart.** It is its own line and never counted as available.
- **Recent results per model.** Each model's last outcome is shown.

Proposed lines (the laya-go game decides the exact words):

```
Chores.
Time day Biome forest Home chest
Pack logs 3 planks 0 sticks 2 cobble 0 coal 0 iron 0 food 2 raw 1 seeds 0 wool 0 sand 0 saplings 2 torches 0 free 24
Chest logs 12 planks 0 sticks 0 cobble 20 coal 4 iron 0 food 0 raw 0 seeds 6 wool 1 sand 0 saplings 0 torches 0
Tools axe wooden pickaxe wooden sword none hoe none shovel none     # best carried, by tier
Kit pickaxe stone axe stone shovel none sword none food 8 torches 16 # in the chest, reserved, never available
Base table yes furnace no chest yes bed no lit no
Farm yes ready no
Near trees 49 stone 49 coal 97 sand none water 49 grass 49           # the search size it was found in (49/97/193) or none
Animals cow 3 pig 0 sheep 2 chicken 1 rabbit 0                      # within the search
Results hunt done 3m gather failed no-trees 1m mine none craft failed missing-sticks 0m place done 12m farm none
```

- **Kinds are the same in Pack and Chest:** logs, planks, sticks, cobble, coal, iron, food (cooked or ready to eat),
  raw, seeds, wool, sand, saplings, torches; counts capped at 999.
- **Results:** one entry per model and per single step, as `<model> none | done <age> | failed <reason> <age>`.
  - Reasons come from a closed list per model: `no-trees`, `no-animals`, `missing-<kind>`, `no-spot`, `no-path`,
    `full`, `timeout`, `stopped`.
  - Age is a bucket: `0m 1m 3m 10m old`.
- **What the line replaces:** today's `Failed <chores>` line (and laya-go's proposed `Blocked`). Chores learns "craft
  failed missing-sticks just now → craft sticks / gather logs" from it.
- **The kit:** a separate line, and kit items are subtracted from Chest. Craft and store never take them (as today's
  `kitIn`).

### 11.4 Skill tasks and steps

```ts
type Skill = 'farm' | 'mine' | 'craft' | 'hunt' | 'gather' | 'place';
type Purpose = 'chores' | 'player';
interface SkillTask { skill: Skill; target: string | null; count: number | null; purpose: Purpose }  // count null: the model decides when enough
type SkillEnd = { how: 'done' } | { how: 'failed'; reason: FailReason; item?: string } | { how: 'stopped' };
type HuntStep   = { act: 'attack'; animal: Animal } | { act: 'pickup' } | { act: 'search' } | { act: 'done' } | { act: 'stop'; why: FailReason };
type GatherStep = { act: 'cut'; tree: TreeKind } | { act: 'break'; block: 'grass' | 'sand' } | { act: 'shear' } | { act: 'pickup' }
                | { act: 'replant' } | { act: 'search' } | { act: 'done' } | { act: 'stop'; why: FailReason };
type PlaceStep  = { act: 'place'; item: Placeable; cell: Cell } | { act: 'clear'; cell: Cell } | { act: 'done' } | { act: 'stop'; why: FailReason };
```

- **Player commands use the same skills:**
  - "mine 8 iron" → mine iron ×8
  - "get 16 logs" → gather logs ×16
  - "hunt cows for leather" → hunt with a target
  - "craft a stone pickaxe" → craft
- **A player's skill that fails missing something** ends with that reason, and andy says it ("I need sticks"), as
  today's `jobFailedMessage`.
- **Open (Q16):** whether a player's craft job should, like chores, pick the next skill itself.

### 11.5 Model cards (user go-ahead 2026-11-11 18:55: small, tight, single-skill)

Every model is **small and does one skill**. Each card below gives:
- **Skill:** the one thing the model does, and what is explicitly out of scope.
- **State:** a short state, a few lines with only the facts that skill needs.
- **Answers:** a small answer set.
- **Rules v1:** the baseline its training data comes from.
- **Check:** how it is checked.
- **Size and correction:** its target size, and how a mistake is corrected.

**Prefer splitting a model over growing one:** a new fact or answer that serves a different skill means a new model.
State lines and words are this side's proposal. laya-go's `skill-models` games are authoritative (§11, tasks 0.3).

**Common to every card:**
- **Size:** 2–4 layers, width 64–128, trained in under about 1 h on one slot of the controller.
- **Check, laya-go side:** the game's check (the model agrees with rules v1 on ≥ 98 % of held-out situations, ≥ 99 %
  on safety-relevant ones). The golden request is checked byte for byte.
- **Check, bot side:** the renderer's golden test, plus one game scenario for the skill.
- **Correction:**
  1. Take a wrong step from `laya-<model>.jsonl`. Each line holds the exact state text, the answer and the outcome.
  2. Write the right answer as a case in the game's corrections set.
  3. Submit a short retrain **from the current model** through the controller's `/job` (minutes, not a full run).
  4. golaya hot-reloads it, and the bot picks up the prompt version from `/v1/models`. The bot changes nothing.
  5. A correction that needs a new state fact is a new prompt version. If the fact belongs to another skill, it is a
     split instead.

#### chores (v2): which skill next
- **Skill:** pick the next skill and its target, or one single step (§11.2).
- **Out of scope:** how any skill is done, amounts, where things go, and safety (that is the director).
- **State:** §11.3 (about 10 lines: time, pack and chest summaries, tools, kit, base, farm, near, animals, results).
- **Answers:** `Do` (10 words) and `Target` (only the words valid for that `Do`; `none` otherwise).
- **Rules v1:** today's chores v1.1 priority order, rewritten to these answers.
  - A result `failed missing-X` → the skill that gets X.
  - Failed less than 3 m ago → not the same answer again.
  - At night → `sleep` (bed) / `mine coal` / `rest`.
- **Check:** the common check. A dead end (the same failing answer 3 times) counts as a check failure.

#### hunt: get meat or a drop from animals
- **Skill:** choose the animal, attack, pick up, widen the search, decide when enough.
- **Out of scope:** cooking (`cook`), fighting hostiles (defend), shearing (gather), breeding (farm).
- **State:**
  ```
  Hunt.
  Goal food                     # food | leather | feather, or xN
  Have 3 Sword stone Health 14
  Animals cow 3 6 pig 0 none sheep 2 14 chicken 1 9   # count ≤ 9, nearest distance bucket (4/8/16/32/none)
  Herd cow 3 sheep 2 Search 49 Drops 1
  ```
- **Answers:** `Action` [attack, pickup, search, done, stop]; `Animal` [cow, pig, sheep, chicken, rabbit, none].
- **Rules v1:**
  - Drops first.
  - Never below 2 of a kind in the herd.
  - Prefer the nearest kind that gives the goal.
  - `done` at the goal; with no count, enough = 8.
  - Widen the search 49 → 97 → 193, then `stop`.
- **Check:** the common check.
- **Split candidate:** fishing would be a new model, not part of hunt.

#### gather: collect a raw resource by hand
- **Skill:** pick the source (which tree, grass, sand, a sheep to shear), cut or break, replant stumps, widen the
  search, decide when enough.
- **Out of scope:** stone, cobble and ores (mine), killing animals (hunt), crafting (craft).
- **State:**
  ```
  Gather.
  Goal logs                     # logs | seeds | wool | sand, or xN
  Have 3 Axe wooden Shears no Sapling 2
  Trees oak 4 6 birch 1 12 spruce 0 none   # kinds near, count ≤ 9 and nearest distance bucket
  Tree 5 Stumps 2 Grass 4 Sheep 8 Sand none Search 49 Pack 12
  ```
- **Answers:** `Action` [cut, break, shear, pickup, replant, search, done, stop]; `Source` [oak, birch, spruce,
  jungle, acacia, dark_oak, grass, sand, sheep, none].
- **Rules v1:**
  - Finish the tree it started.
  - Replant a stump when holding a sapling.
  - Shear only with shears; otherwise `stop missing-shears`.
  - With no count, enough = logs 16, seeds 16, wool 3, sand 8.
  - Widen the search 49 → 97 → 193.
  - `done` when the pack is full.
- **Check:** the common check.
- **Split candidate:** if `Trees` and the shear/grass facts start to compete, split into `gather-wood` and
  `gather-plants`.

#### place: where a block goes in the base
- **Skill:** choose the cell for a station, bed, torch or sapling; clear a cell; decide when done.
- **Out of scope:** crafting the item (craft) and walking anywhere else (code walks to the cell).
- **State:** a 7×7 top-down grid around home, one row per line. The cell legend is laya-go's (§11.7).
  ```
  Place.
  Goal furnace Have 1
  Row 1 . . . . . . .
  ...                           # 7 rows
  ```
- **Answers:** `Action` [place, clear, done, stop]; `Cell` [49 cells, none].
- **Rules v1:**
  - Stations 1–3 cells from home and next to each other (table by furnace by chest).
  - Never on farmland, a path or next to water or lava.
  - A bed with a roof when possible.
  - Torches on dark cells, at least 3 apart.
  - Saplings at least 2 cells from stations.
  - `done` when placed; for torches, when no dark cell is left.
  - `stop no-spot` when no cell fits.
- **Check:** the common check, plus never a cell on farmland, a path or next to water or lava (100 %).
- **Split candidate, decide with rules2 (Q17):** the grid is the largest state here. If one model can't learn both
  "stations together" and "torches on dark, spaced" at this size, split into `place` (stations, bed, saplings) and
  `light` (torches).

#### craft (v2.2 data): make an item from what is carried and in the chest
- **Skill:** the recipe chain from logs (planks, sticks, then the item), smelting, and taking from the chest.
- **Out of scope:** getting raw materials (ends `missing-X`), placing stations (ends `missing-crafting_table` /
  `missing-furnace`), and the player kit's items, which it never takes.
- **State and answers:** today's craft prompt v2 (`Craft.` with Goal, Have, Other, Chest, Near, Inventory; Action,
  Item, Count). The prompt is unchanged; only the data is new.
- **Rules v1:** craft's rules, with `gather`/`place` answered as an end, not a walk.
- **Check:** the common check. Size as today, or smaller if it trains well.

#### mine and farm: as today (prompt v2)
- **mine:**
  - **Skill:** dig to a target (cobble, coal, iron, other ores), with the plan, torches and unload.
  - **Out of scope:** surface gathering and fights.
- **farm:**
  - **Skill:** till, plant, water, pond, harvest, breed.
  - **Out of scope:** getting seeds from grass (gather) and cooking.
- **Both:** the prompt, state and answers are unchanged. Corrections go through the same `/job` loop.

#### director, command, defend, eat, follow
Unchanged. They are already single-skill.

### 11.6 Bot side of every model

One shared client (`models/client.ts`) and **one folder per model** with the same four files:

```
models/<name>/render.ts     facts → state text (byte-identical to laya-go's golden request; the only prompt text)
models/<name>/questions.ts  question set per prompt version
models/<name>/answer.ts     answer words → that model's typed union (anything else: malformed → rules)
models/<name>/rules.ts      rules v1 (the fallback, and what the laya-go data came from)
```

- **Settings:** `decision_models.tasks` gains `hunt`, `gather` and `place`; `chores` moves to `prompt: v2`. Each has
  server, model, prompt, timeout, min_confidence and log_steps, as the others do.
- **Before a model is served,** its rules decide. That way the skill jobs can be built and tested in the game before
  laya-go has trained anything.
- **Adding a model is adding a folder.** Nothing else in the bot changes shape.

### 11.7 Place grid (bot side)

The bot sends the 7×7 grid around home, north up, home in the middle. The cell words are laya-go's to fix; this side
proposes `.` open floor, `#` blocked, `~` water/lava near, `f` farmland, `p` path, `T` table, `F` furnace, `C` chest,
`B` bed, `t` torch, `s` sapling, `d` dark open floor (light < 8), `H` home.

Code turns the chosen cell into a block position (floor plus 1). It refuses a cell that has changed since the state was
read, ending with `failed no-spot`.

### 11.8 Craft and mine

- **Craft, data v2.2 (prompt unchanged per rules2):**
  - The model owns the chain from logs.
  - Its `gather` action is answered by ending the craft with `failed missing-<kind>` (chores then picks the gathering
    skill).
  - Its `place` action is answered by ending with `failed missing-crafting_table` or `missing-furnace` (chores then
    picks place).
  - The player kit is never taken.
- **Mine:** takes the targets cobble, coal and iron (and night mining, as rules2 says), each with an optional count.
  With no count, the mine model decides when enough.

### 11.9 What code keeps, and where today's 25 chores go

Code executes single steps only:
- `cut oak` = path to the nearest reachable oak log and dig it.
- `place furnace 2-3` = place it on that cell.
- `attack cow` = attack the nearest cow outside the herd reserve the state named.

Sensors build the facts above. No amounts, orders or recipe chains stay in code.

| Today's chore(s) | Chores v2 answer |
|---|---|
| gather_logs, stock_logs | `gather logs` (amount: the gather model) |
| get_seeds | `gather seeds` |
| gather_wool | `gather wool` (shears) or `hunt` (sheep) |
| gather_cobble, stock_cobble | `mine cobble` |
| night_mine | `mine coal` / `mine iron` |
| place_table, place_furnace, place_chest | `place crafting_table/furnace/chest` (crafting it first is `craft …`) |
| craft_wood_tools, craft_stone_tools, craft_sword | `craft <tool>` |
| make_torches, light_base | `craft torch`, `place torches` |
| make_beds | `craft bed`, `place bed` |
| start_farm, tend_farm | `farm` |
| hunt_food | `hunt` |
| cook_food | `cook` |
| replant_saplings | `place saplings` (or gather's own `replant` after cutting) |
| stock_kit | `craft player kit` (craft fills the kit and stores it) |
| unload | director activity (stays); `store` (Q15) |
| sleep, rest | `sleep`, `rest` |

### 11.10 Logs

- **Existing files keep their format.** `laya-*.jsonl` lines stay as they are. `laya-chores.jsonl` keeps its fields:
  `chore` holds the answer as `do[ target]` (e.g. `gather logs`), and a new `prompt` field gives the version (`v2`).
- **New files:** `laya-hunt.jsonl`, `laya-gather.jsonl` and `laya-place.jsonl`.
  - They follow the craft log's shape: goal, state, answer fields, p, ms, source, rule, outcome, reason.
  - They add `purpose` (`chores` or `player`).
