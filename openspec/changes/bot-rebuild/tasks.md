# Tasks: bot-rebuild

Phase 1 and 2 started 2026-11-11 (branch `bot-rebuild`). Each phase's gate must pass before the next one starts. "Suite" =
`npm run game-test` (tools/andy-tests, 16 scenarios) on the test world with the LLM off; "golden" = the byte tests of
each model's state text against laya-go's samples.

## 0. Decide (blocks phase 1)
- [x] 0.1 User answers questions.md (2026-11-11: all recommendations accepted; design §10a) (TypeScript setup, test runner, andy-only vs multi-bot, UI/viewer, cut-over date).
- [x] 0.3 Reconcile §11 (done 2026-11-11 against skills-spec v1; design §11.8. Re-check whenever skills-spec
      changes) (chores v2 answers and state, model cards for hunt/gather/place, craft v2.2, mine targets) with
      laya-go's `skill-models` change (`~/lnkz/laya-go-rules2/openspec/changes/skill-models`, its `skills-spec.md`):
      same question names, answer words, state lines and golden requests. Record differences here; laya-go's game
      definitions win.
- [x] 0.2 Freeze the harness contract: record the mindserver messages and full-state shape the suite and MCP use
      (`test/andy_tests_*` as fixtures). (2026-11-11: `test/fixtures/harness-contract/` contract.json + a live
      full-state capture; `bot/test/harness.test.ts` checks the new harness against them.)

## 1. Baseline (old bot, no code changes)
- [x] 1.1 Suite run on `laya-follow` (after fix-round4 merges): save report as the baseline. (2026-11-11 22:02: 9/16,
      the 7 failures all the command model's 300 ms timeout under training load; report
      `bot-rebuild-baseline-2026-11-11_22-02-52.md`.)
- [x] 1.2 Record one line of every `laya-*.jsonl` per task as golden log fixtures. (`test/fixtures/laya-logs/`, lines
      from before the baseline run; chores has its ask line and its run line.)
- [x] 1.3 Measure: cold start → spawn, RSS at 10 min, `node_modules` size, model latency p50/p95, interrupt → idle,
      restarts per suite. Write `bots/andy/logs/game-tests/bot-rebuild-baseline-<date>.md`.

Done means: a baseline report with every metric in design §7 filled in.

## 2. Skeleton (`bot/`)
- [x] 2.1 `bot/package.json`, `tsconfig` (strict), build/test scripts, dependency rule check in CI, patches carried.
      (No CI workflow in the repo: the rule runs in `npm test` (`scripts/check-deps.mjs`).)
- [x] 2.2 `types/` (facts, decisions, jobs, commands, outcomes).
- [x] 2.3 `core/` Body, connection, `abort.ts`, `motion.ts` (pathfinder owner, abort = clear goal), BodyLease with
      the 2 s overrun rule; tests incl. a never-settling actuator.
- [x] 2.4 `harness/`: mindserver-compatible socket.io server, full state, `send-message`, legacy `!cmd` parser (the 18
      command-model commands), minimal status page (Q7).
- [x] 2.5 `ANDY_BOT=new|old` in `tools/test-world/bot.js`; `main.ts` spawns and idles. (2026-11-11 22:21: started by
      `ANDY_BOT=new node tools/test-world/bot.js --background`, the same `Bot.start` path as the MCP `bot_start`;
      `andy_status`, `andy_wait_idle`, `andy_command` and `world_reset` (start-agent + its own reconnect, no process
      exit) work; `--stop` 252 ms. The MCP server runs from the main checkout, so `bot_start` itself picks the new bot
      only once this branch is merged and the MCP is started with ANDY_BOT=new.)

Deps note (2026-11-11): minecraft-data 3.97.0 can't be pinned: today's prismarine-chunk 1.41 needs 3.119's version list
(crash at login). `bot/` runs mineflayer 4.33.0 (+ its patch) with minecraft-data 3.119.0 (the 1.21.6 checksum patch is
upstream there); Q4 (pin 4.39.0 + a small regenerated patch) is with the user.

Done means: `bot_start` with `ANDY_BOT=new` joins the test world, `andy_status` and `andy_wait_idle` work, the
lease overrun test passes.

## 3. Models, sensors, director, safety
- [x] 3.1 `models/client.ts` (port of `src/models/laya.js`), served prompt version.
  Latency note (2026-11-12, golaya serve, training idle, p50/max): eat 49/115 ms, director 100/136, defend 120/186,
  craft 185/224, command 300/346, mine 346/417 ms; 2–4 s while the Studio trains. Timeouts: 5 s default, a task's
  `timeout_ms` below 2.5 s (settings.js's 300) is raised to 2.5 s and logged once.
- [x] 3.2 Renderers + questions + parsers + rules for director, eat, defend; golden tests.
  `bot/src/models/{director,eat,defend}/` (render, questions, answer, rules, index), pure (client passed in). Golden
  requests byte for byte (director v1/v1.2/v1.3, eat v1, defend v1); director rules on its three 1000-situation sets;
  eat and defend rules are ports of laya-go `games/{eat,defend}/rules.Decide` (the fallback instead of auto-eat and
  the modes), checked on new 1000-row `test/fixtures/laya-{eat,defend}-v1/decisions.jsonl` (laya-go `3a8fe4c`, seed 7,
  all 9 and 13 rules). Every fallback carries `why` (no-answer, low-confidence, disagree, veto + `veto`,
  nothing-to-defend, not-hungry, malformed). laya-go HEAD's eat/defend prompts equal the old JS (no drift). The
  bot readers (`situation(bot, …)`, `armedOf`, `armorPoints`, `dangerOf`, defend's armour slots) move to 3.3.
- [x] 3.3 Sensors: vitals, attacks (fix-round4's `attacks.js`), danger, light/time, player, pack, home, stuck.
  `bot/src/sensors/` (bot, attacks, hurt, mobs, vitals, danger, light, player, pack, home, index) give one typed
  `Facts` per tick (`Sensors.read()`, cached 250 ms); `core/stuck.ts` counts only while `Motion.moving` (a goTo in
  flight), 20 s / obsidian 40 s, never acts. Attacks is an exact port (15 s attacker, 5 s Me/Player, blame 4, fusing
  creeper within 5). `mobKind` moved to sensors (render re-exports it; goldens unchanged). Facts → situation adapters
  in `models/{director,eat,defend}/situation.ts`, ported as the old callers fed them: eat danger = a hostile within 8;
  defend sees only attackers within 18, night = timeOfDay ≥ 13000 (mineflayer isDay), player within 8. Old tests
  ported (fix_round4 attacks, director helpers, homeState, pack homeDistance/countHostiles) plus new; adapters render
  the eat/defend/director v1.3 goldens from a fake world. Live smoke (test world): hostiles/nearest, night, Player
  line via blame (5 s), lava → fire. Found: **any damage kicks the new bot** (`invalid_player_movement`, also with
  sensors off — body/mineflayer 4.33 physics, not 3.3); 3.4's defend needs it fixed (Q4's mineflayer 4.39 pin?).
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
- [ ] 5.5 hunt, gather and place skill jobs (design §11, skills-spec v1 §2–4): renderer, questions, typed answer, rules v1, golden test, a
      game scenario each. They run on rules v1 until laya-go serves the models.
- [ ] 5.6 chores v2 (skills-spec v1 §1): Carry/Chest/Made/Kit, Last from the run lines; answers map 1:1 to skill jobs
      or rules actuators (cook, store, sleep, ask, rest). Chores v1.1 stays available as the stopgap until v2 is
      served.
- [ ] 5.7 Correction path: `andy_logs` (or a small tool) turns a `laya-<model>.jsonl` line into a correction case in
      the format laya-go's controller `/job` takes.

Done means for each: its scenarios pass, its unit tests (ported from `test/laya_<task>*.test.js`) pass, its log
matches the fixture. Port every fix the old bot gets meanwhile.

## 6. Cut-over
- [ ] 6.1 Full suite 16/16 on the new bot, twice in a row, zero process exits.
- [ ] 6.2 First day from scratch through the first night with chores v2 and the skill models (or their rules): alive,
      home chest set, base placed, no dead end (the same failed answer three times in a row).
- [ ] 6.3 Measure as 1.3; write the before/after report.
- [ ] 6.4 User accepts; `ANDY_BOT` default → new.

Done means: 6.1–6.3 pass and the user says go.

## 7. Delete the old bot
- [ ] 7.1 Remove `src/` LLM code, modes, commands, skills library, tasks, npc, vision, models (except what was
      ported), profiles, `bots/*Template.js`, unused dependencies; `main.js` → new entry.
- [ ] 7.2 Rewrite README / docs for the new bot.
- [ ] 7.3 Archive this change.
