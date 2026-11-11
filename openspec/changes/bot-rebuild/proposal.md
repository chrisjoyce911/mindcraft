# Proposal: rebuild andy's bot — lean, typed, no LLM leftovers

Asked for by the user, 2026-11-11 (Brisbane). This change is the spec only: it does not authorise implementation.

## Why

andy is driven only by small Laya decision models (laya-go behind `golaya serve`, 127.0.0.1:11235); the chat LLM is off
(`llm: false`). The bot is still Mindcraft, whose LLM-era machinery is what makes andy unstable now:

- actions run as closures or eval'd code strings that stop only if they check a flag; a slow stop gives "waiting for
  code to finish executing…" ×30 → `process.exit(1)` → restart → the job is lost (live play 2026-11-11 18:12);
- twelve modes tick on their own and interrupt whatever runs (unstuck, self_defense, laya_defending, …), fighting the
  director and the jobs;
- the command model's answers become `!command("…")` text that is parsed again; with the LLM off the Prompter, its
  example embeddings, history, translation, NPC, vision and task code are still built at startup.

The bugs are in our layer, not in mineflayer, so we keep mineflayer and rebuild the layer on top.

## What changes

- A new bot in `bot/` (TypeScript, strict), built **alongside** the old one, selected by `ANDY_BOT=new|old`, using the
  same test world, the same `andy` MCP tools and the same 16 game scenarios as its gate.
- Packages with one-way dependencies: `types`, `core` (body, motion, abort), `world`, `sensors`, `models` (client +
  one renderer per model), `actuators`, `jobs`, `chores`, `director`, `command`, `home`, `harness`, `log`.
- Typed facts, decisions, jobs and commands; no `!command` strings inside the bot (only a legacy parser at the harness
  boundary), no eval, no prompt plumbing outside each model's renderer (byte-identical to laya-go's golden samples).
- One owner of the body (the director's lease) and an `AbortSignal` through every actuator, pathfinder call and wait;
  a stop settles in ≤ 250 ms (target) and is forced at 2 s — never a process exit.
- Modes are gone: defend/flee/eat/heal/escape/unload are director activities; andy defends only when andy or a player
  was attacked; stuck handling belongs to the running actuator.
- Jobs survive a restart (typed progress in `laya-job.json`); all `laya-*.jsonl` logs and state files keep their format.
- When the new bot passes the suite and a first-day-from-scratch test, it becomes the default and the old `src/` is
  deleted.

## Inventory of today's code (src/, 21,435 lines of JS)

| Area | Lines | Fate |
|---|---:|---|
| `src/agent/laya/*` (33 files) | 6,619 | **port**: ~19 pure state/rules files (~2,700 lines) move almost as-is to TS; the loops (mine 738, chores_actions 918, farm 386, craft 229, …) are restructured into jobs/actuators |
| `src/models/laya.js` + `laya_check.js` | 400 | **port** → `models/client.ts`, `laya:check` |
| `src/agent/library/skills.js` + `world.js` + `full_state.js` + `skill_library.js` | 3,251 | **split**: the 16 skills laya calls (collectBlock, collectOreAt, craftRecipe, equip, goToPosition, placeBlock, smeltItem, tillAndSow, useToolOn, pickupNearbyItems, huntForDrop, …) → `actuators/`; ~360 lines of laya glue in skills.js → `jobs/`; ~720 lines unreachable from laya (villagers, doors, beds, LLM queries) **deleted** |
| `src/agent/agent.js` | 955 | **replace** by `main.ts` + `director/` (the laya wiring) ; LLM loop (promptConvo etc.) deleted |
| `src/agent/modes.js` | 568 | **delete** (replaced by director activities) |
| `src/agent/action_manager.js` | 179 | **delete** (replaced by the lease + AbortSignal) |
| `src/agent/commands/*` | 1,294 | **delete**; the 18 commands the command model emits become typed `Command`s, plus the legacy parser |
| `src/agent/mindserver_proxy.js`, `src/mindcraft/*`, `src/process/*` | 820 | **replace** by `harness/` (same socket.io protocol, one process per bot) |
| `src/utils/mcdata.js` | 572 | **trim** → `world/` (recipes, items, hostiles) |
| LLM providers `src/models/*` except laya | 2,200 | **delete** (prompter, gpt, claude, gemini, ollama, groq, … 25 files) |
| conversation, self_prompter, coder, speak, history, examples, translator | 1,204 | **delete** (`history.js`'s only remaining job, saving `places`, moves to `home/`) |
| `src/agent/npc/*` | 871 | **delete** |
| `src/agent/tasks/*` (construction, cooking, benchmarks) | 2,053 | **delete** |
| `src/agent/vision/*` | 168 | **delete** |
| `profiles/*` (19 files), `bots/*Template.js`, `src/mindcraft-py`, `tasks/` | — | **delete** (andy's profile shrinks to name + skin) |

Kept unchanged: `tools/andy-tests` (3,453 lines with test-world) and `test/andy_tests_*`, which become the contract
tests for both bots.

**Rough size after:** ~9–10k lines of TypeScript (≈ 6.5k ported laya logic + ~1.5k actuators + ~1.5k core, director,
harness, log) versus 21.4k lines of JS today; dependencies from 447 packages / 1.2 GB `node_modules` to roughly
mineflayer, pathfinder, minecraft-data, prismarine-item, vec3, socket.io (target < 150 MB).

## Capabilities

- `bot-body`: one owner, cancellation, bounded stop, typed actuator outcomes, timeouts.
- `bot-runtime`: priorities, modes replaced, defend-only-attackers, persistence, decision loop.
- `bot-commands`: typed commands, legacy parser at the boundary, no LLM.
- `bot-models`: golaya client, byte-identical state text, typed answers, log format kept.
- `bot-harness`: mindserver-compatible API, launch contract, observable idle.

## Impact

- New `bot/` tree and its `package.json`; `tools/test-world/bot.js` learns `ANDY_BOT`.
- No change to laya-go, the models or their prompts. The parallel tabs (fix4 on `fix-round4`, rules2/trainctl3 on
  laya-go) are unaffected; fixes they land in the old bot are ported forward phase by phase.
- Out of scope: a Go rewrite of the body (go-mc, rejected for now: months of work, bugs aren't there), a mineflayer
  upgrade, new behaviour or models.

See design.md for the runtime model, types, efficiency targets and risks; tasks.md for the phases; questions.md for
what the user needs to decide.
