# Tasks: bot-rebuild

Spec only so far: nothing below is started. Each phase's gate must pass before the next one starts. "Suite" =
`npm run game-test` (tools/andy-tests, 16 scenarios) on the test world with the LLM off; "golden" = the byte tests of
each model's state text against laya-go's samples.

## 0. Decide (blocks phase 1)
- [ ] 0.1 User answers questions.md (TypeScript setup, test runner, andy-only vs multi-bot, UI/viewer, cut-over date).
- [ ] 0.2 Freeze the harness contract: record the mindserver messages and full-state shape the suite and MCP use
      (`test/andy_tests_*` as fixtures).

## 1. Baseline (old bot, no code changes)
- [ ] 1.1 Suite run on `laya-follow` (after fix-round4 merges): save report as the baseline.
- [ ] 1.2 Record one line of every `laya-*.jsonl` per task as golden log fixtures.
- [ ] 1.3 Measure: cold start → spawn, RSS at 10 min, `node_modules` size, model latency p50/p95, interrupt → idle,
      restarts per suite. Write `bots/andy/logs/game-tests/bot-rebuild-baseline-<date>.md`.

Done means: a baseline report with every metric in design §7 filled in.

## 2. Skeleton (`bot/`)
- [ ] 2.1 `bot/package.json`, `tsconfig` (strict), build/test scripts, dependency rule check in CI, patches carried.
- [ ] 2.2 `types/` (facts, decisions, jobs, commands, outcomes).
- [ ] 2.3 `core/` Body, connection, `abort.ts`, `motion.ts` (pathfinder owner, abort = clear goal), BodyLease with
      the 2 s overrun rule; tests incl. a never-settling actuator.
- [ ] 2.4 `harness/`: mindserver-compatible socket.io server, full state, `send-message`, legacy `!cmd` parser.
- [ ] 2.5 `ANDY_BOT=new|old` in `tools/test-world/bot.js`; `main.ts` spawns and idles.

Done means: `bot_start` with `ANDY_BOT=new` joins the test world, `andy_status` and `andy_wait_idle` work, the
lease overrun test passes.

## 3. Models, sensors, director, safety
- [ ] 3.1 `models/client.ts` (port of `src/models/laya.js`), served prompt version.
- [ ] 3.2 Renderers + questions + parsers + rules for director, eat, defend; golden tests.
- [ ] 3.3 Sensors: vitals, attacks (fix-round4's `attacks.js`), danger, light/time, player, pack, home, stuck.
- [ ] 3.4 Director loop, JobStack, priorities, activities defend/flee/eat/heal/escape; defend-only-attackers.
- [ ] 3.5 Logs: `laya-director/eat/defend.jsonl` identical in format to the fixtures (1.2).

Done means: golden green; suite scenarios for defend, flee, eat and night survival pass on the new bot; no mode exists.

## 4. Command and simple jobs
- [ ] 4.1 Command model (prompt v2.1/v2.2) → typed `Command`; canned reply; `laya-command.jsonl`.
- [ ] 4.2 Jobs follow (follow model), come, stay, give, store, setHome; `home/` places in today's format.
- [ ] 4.3 Persistence: `laya-job.json` (typed), `memory.json` places, `laya-chores.json`, `laya-mines.json` in today's formats; restore paused within 10 min.

Done means: follow/come/give/store scenarios pass; a restart test (kill mid-follow) resumes.

## 5. Work jobs (one at a time, gate after each)
- [ ] 5.1 craft + gather (craft model, recipes from minecraft-data).
- [ ] 5.2 mine (mine model v2, mine plan, floor/drop checks, veins, torches, unload at home, mine memory).
- [ ] 5.3 farm (farm model v2, water, pond, seeds, unload).
- [ ] 5.4 hunt.
- [ ] 5.5 chores planner (chores model, home, stumps/saplings, wool from string) producing jobs.

Done means for each: its scenarios pass, its unit tests (ported from `test/laya_<task>*.test.js`) pass, its log
matches the fixture. Port every fix the old bot gets meanwhile.

## 6. Cut-over
- [ ] 6.1 Full suite 16/16 on the new bot, twice in a row, zero process exits.
- [ ] 6.2 First day from scratch through the first night: alive, home chest set, chores done (as round 2's test).
- [ ] 6.3 Measure as 1.3; write the before/after report.
- [ ] 6.4 User accepts; `ANDY_BOT` default → new.

Done means: 6.1–6.3 pass and the user says go.

## 7. Delete the old bot
- [ ] 7.1 Remove `src/` LLM code, modes, commands, skills library, tasks, npc, vision, models (except what was
      ported), profiles, `bots/*Template.js`, unused dependencies; `main.js` → new entry.
- [ ] 7.2 Rewrite README / docs for the new bot.
- [ ] 7.3 Archive this change.
