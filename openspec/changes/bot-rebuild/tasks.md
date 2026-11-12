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
upstream there); Q4 (pin 4.39.0 + a small regenerated patch) is with the user. (2026-11-12, 3.4: Q4 done: `bot/` pins
mineflayer 4.39.0 + `patches/mineflayer+4.39.0.patch` (tool-material fix, 500 ms place timeout); damage no longer kicks.)

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
  in `models/{director,eat,defend}/situation.ts`, ported as the old callers fed them: eat danger = a hostile nearer than 8 (strict) or lava within 2
  (`Facts.lavaWithin2`, findBlock maxDistance 2);
  defend sees only attackers within 18, night = timeOfDay ≥ 13000 (mineflayer isDay), player within 8. Old tests
  ported (fix_round4 attacks, director helpers, homeState, pack homeDistance/countHostiles) plus new; adapters render
  the eat/defend/director v1.3 goldens from a fake world. Live smoke (test world): hostiles/nearest, night, Player
  line via blame (5 s), lava → fire. Found: **any damage kicks the new bot** (`invalid_player_movement`, also with
  sensors off — body/mineflayer 4.33 physics, not 3.3); 3.4's defend needs it fixed (Q4's mineflayer 4.39 pin?).
- [x] 3.4 Director loop, JobStack, priorities, activities defend/flee/eat/heal/escape; defend-only-attackers.
  mineflayer 4.39.0 first (Q4; the kick on damage is gone). `bot/src/actuators/` (equip, eat, fight, avoid, escape,
  approach; through Motion, incl. the new `moveFor`) and `bot/src/director/` (typed JobStack, JobRunner interface,
  activities, the Director loop: events + 1 s tick, the eat model asked alongside, arbitration on the BodyLease, holds
  against flapping: defend quiet, 1 s restart hold, eat-refused). Defend sees only attackers; defend-player walks to the
  player first. Lease fix: the holder is set before the runner starts. 115 unit tests incl. ports of laya_director,
  laya_defend, fix_round3/4 parts. Live (`bot-rebuild-3.4-2026-11-12.md`): eat, new defend-fight, flee-creeper and
  night-survival (tag rebuild) pass; defend's follow steps wait for 4.2. Review fix: defend's quiet spell follows only
  an `ignore` end and a hurt event breaks it (a second attacker right after a kill is fought at once); the holds are
  in design §5.2.
  **Open (before 4.x jobs, owner laya-go skills-spec):** after the eat model refuses (e.g. only rotten flesh while not
  starving), the director's `eat` answer is held for up to 30 s and nothing runs, so a paused job is not resumed
  while the director's `Food items` still counts the refused food. Fix in the spec: the director's `Food items`
  should count only the foods the eat model may choose. No "resume instead" rule in code.
- [x] 3.5 Logs: `laya-director/eat/defend.jsonl` identical in format to the fixtures (1.2).
  `bot/src/log/jsonl.ts`: typed line builders (the old fields, order and values: eat `eat` is the Eat probability,
  `food`/`p`/`ms` the model's words; defend `action/target/weapon` the model's words, written before acting, `outcome`
  the action taken, `override` kept; a fallback is `outcome:"fallback"` + `reason` (+ `veto`)) and one writer
  (`{time, ...line}`, never throws); `log_steps: false` turns eat/defend lines off. No new fields: the director's
  `acted`, eat-failed/target-gone reasons stay on the console. Not written (as the old bot): decisions the rules made
  alone (task off, model not asked) and an eat answer not acted on yet (re-asked after check_ms). Values that differ
  from the old bot's: director `event` is the new bot's word (`hurt`, `job-end`, `<activity>-done`, no `idle`), and
  the `reason`/`why` words `not-hungry`, `nothing-to-defend`, `malformed` (and director `why` low-confidence/no-answer)
  are new values in old fields. Golden `bot/test/logs.test.ts`: the three 1.2 fixture lines and one line per branch
  recorded from the old JS (`test/fixtures/laya-logs/branches/`), byte for byte. Live
  (`bot-rebuild-3.5-2026-11-12.md`): the 3.4 scenarios pass; every line's keys match an old shape.

Done means: golden green; suite scenarios for defend, flee, eat and night survival pass on the new bot; no mode exists.
Gate passed 2026-11-12 (02:08 AEST, HEAD b03c029, no code change): `bot` npm test 126/126, harness 38/38; eat,
defend-fight, flee-creeper, night-survival pass twice each (training held); `defend` stops at its `!followPlayer`
step as expected (4.2); no mode (grep, check:deps, live modes "none", `!setMode` not a command). Report
`bots/andy/logs/game-tests/bot-rebuild-phase3-2026-11-12.md`.

## 4. Command and simple jobs
- [x] 4.1 Command model (prompt v2.1/v2.2) → typed `Command`; canned reply; `laya-command.jsonl`.
  (2026-11-12) `bot/src/models/command/` (vocab, render, questions, resolve, answer, plan → typed `CommandPlan` of
  `Command[]`), `bot/src/command/handle.ts` (legacy `!` lines first in main, else the model on `promptFor('command')`;
  canned for chat/unsure/no answer/task off). `laya-command.jsonl` in the old format: `kind` keeps the old words (a
  canned reply is `"llm"` + `reason`); `lines` are the old `!` lines from a log-only `log/legacyLine.ts` (round-trip
  tested against `parseLegacy`). Golden requests v1/v2/v2.1/v2.2, resolve cases, the 1.2 log line and
  `test/fixtures/laya-logs/branches/command.jsonl` (recorded by `tools/laya-logs/record-command.mjs`) byte for byte.
  Home's "That's my chest now." rides on the plan (`doneSay`) for 4.2. Live: report
  `bots/andy/logs/game-tests/bot-rebuild-4.1-2026-11-12.md`.
- [x] 4.2 Jobs follow (follow model), come, stay, give, store, setHome; `home/` places in today's format.
  (2026-11-12) `bot/src/models/follow/` is the follow model: state v1/v2, questions, the veto as rules, the answer.
  `bot/src/home/` has `chest.ts` (a home_chest.js port) and `places.ts`: memory.json `places`, read-modify-write that
  keeps the other keys, atomic, saved at once; andy remembers `last_death_position` on death. `bot/src/jobs/` has
  follow (one decision per step, the old branches and fallbacks, a summary line), come, stay, give, store and home
  (the speaker's nearest chest), all with the old texts. Actuators: GoalXZ steps through `Motion.moveUntil`, chest
  deposit, give/toss. The director leases a job as `action:<old name>` (followPlayer, goToPlayer, …), says the
  job's end line (or the plan's doneSay), and has `ended(job)`, so a plan's jobs run one after another and stop at
  the first that isn't done. The golden v1/v2 requests, the ported laya_follow_state/loop and laya_home_chest tests,
  and laya-follow.jsonl (the live line plus `branches/follow.jsonl` from `tools/laya-logs/record-follow.mjs`) all
  pass byte for byte; npm test 181/181. Live: follow, defend (pause → resume of the follow job), home-chest-command
  and home-chest-chat pass, as do come/stay/give/store by hand; the phase-3 four were re-run and pass. Report
  `bots/andy/logs/game-tests/bot-rebuild-4.2-2026-11-12.md`. Eat as a job (`!consume`) still says "can't yet".
- [x] 4.3 Persistence: `laya-job.json` (typed), `memory.json` places, `laya-chores.json`, `laya-mines.json` in today's formats; restore paused within 10 min.
  (2026-11-12) `bot/src/home/jobfile.ts` (a typed job_save.js port): the player's jobs on the stack (not chores) go
  to `laya-job.json` as `{savedAt, entries:[{spec, origin, by, progress, status, startedAt}]}`, atomic, on every stack
  change and at most every 2 s while a job steps (`JobStack.progressed`, called by the director per step); the file
  goes when none is left (end, stop, death). The window is the spec's 10 min (the old bot had 15). On every new
  director (restart or reconnect) the saved jobs come back paused (`JobStack.restore`, startedAt kept, so a stay
  counts the time down) once the world has loaded (≥ 1 s after spawn and the job's player in sight, ≤ 5 s; the file
  stays until then) and the director resumes them (resume-paused); andy says the old "carry on" / "lost my job"
  lines. A give that already tossed is dropped quietly (never tossed twice). An old bot's file reads as lost; the old
  bot reads ours as no job. `dispose` detaches the saver first, so a torn-down director never touches the file.
  `home/chores.ts` and `home/mines.ts` are typed stores in today's formats (byte for byte; atomic), not wired until
  5.2/5.6 (main only logs the chores state). npm test 199/199 (old fix_round4 job save, chores state and mine memory
  tests ported). Live: kill -9 mid-follow resumes, graceful restart mid-stay, stale, stop/death/come, world_reset,
  and follow/defend/home-chest ×2 pass; report `bots/andy/logs/game-tests/bot-rebuild-4.3-2026-11-12.md`. For 5.6:
  a chore must not start before the restore has run (a chore-only stack removes the file).
  Review fix: give and store checkpoint the file unthrottled right before the act that can't be undone
  (`JobDeps.checkpoint`): a give saves `tossing` before the toss, a store `heldAtDeposit` before the deposit, so a
  kill -9 mid-act never tosses twice or deposits the count again (live: kill -9 at the toss → "give dropped", one
  toss). npm test 202/202. Known: the 10 min window counts from the last save, so a bot that keeps restarting keeps
  its job.

Done means: follow/come/give/store scenarios pass; a restart test (kill mid-follow) resumes.
Gate passed 2026-11-12 (03:24 AEST, HEAD 03bddc6, no code change): `bot` npm test 202/202, harness 38/38; new
`rebuild` scenarios `come`, `give`, `store` (not in `full`); follow, come, give, store, defend, home-chest-command and
home-chest-chat pass twice each (training held); kill -9 mid-follow ×2 → "job follow restored", "I'll carry on with
it.", resume-paused, followPlayer, 3.1 from tester. Report `bots/andy/logs/game-tests/bot-rebuild-phase4-2026-11-12.md`.

## 5. Work jobs (one at a time, gate after each)
- [x] 5.0 Pin mineflayer 4.39.0 (2026-11-12): `bot/` on mineflayer 4.39.0 + minecraft-data 3.119.0 (override; one copy, also
  under mineflayer-pvp's mineflayer-utils → mineflayer 2.41.0, which we don't load). `bot/patches/mineflayer+4.39.0.patch` has two
  hunks: digTime maps `incorrect_for_wooden_tool` → `mineable/pickaxe` (stone/iron pickaxe on ore no longer timed as a hand), and
  the place blockUpdate wait 5000 → 500 ms. A clean `npm ci` in a scratch copy applies all 4 patches. `bot/test/deps.test.ts`
  guards the versions, both hunks and the dig times through mineflayer's digging plugin (fails with the patch reversed);
  npm test 206/206. No live check: no dig/place path in `bot/` yet (5.2/5.5 gates exercise it).
- [x] 5.1 craft + gather (craft model, recipes from minecraft-data).
  (2026-11-12) `bot/src/models/craft/` is the craft model (laya-go prompt v2): typed item table, state, questions,
  answer, rules (check, plan, ingredientFromChest), item names (`layaItem`, `realName`; planks from minecraft-data's
  recipes) and `decideCraftStep` in the old decision order. `bot/src/jobs/craft.ts` runs craft and gather jobs (one
  model step per job step; target fixed at the start, so a resumed job makes nothing twice; every old fix: chest read
  once, re-read once per failed take, what a take/store moved from the pack, store 64 = all, goal-carried, a failed
  extra step after the goal is done, placed chest known empty; `left()` for the Job line; a take/store checkpoints
  `moving` first and is counted on the next step after a pause or kill). Legacy `!craftRecipe` / `!collectBlocks` run
  one actuator call. New actuators: craft (one craft at a time + settle; a carried table placed and picked up again),
  collect/dig (floorDrop, liquids only as sources, an abort ends the collect), gather, smelt, place, chest
  read/withdraw; `home/kit.ts` keeps the player kit out of every chest read and take. `laya-craft.jsonl` in the old
  shape (live line + `branches/craft.jsonl` from `tools/laya-logs/record-craft.mjs`, byte for byte); `jobFailedMessage`
  ported. ITEMS checked against minecraft-data 1.21.6 recipes. npm test 246/246. Live: craft-wooden-pickaxe,
  craft-stone-pickaxe, craft-furnace and the new `gather-logs` pass twice; smelt and home-chest-kit by hand; follow,
  come, give, store, eat, defend-fight, flee-creeper pass. Report `bots/andy/logs/game-tests/bot-rebuild-5.1-2026-11-12.md`.
  `makeItem` (jobs/craft.ts) is the craft loop for 5.2/5.3 to call; a chore `purpose` ends on a gather answer (5.6 wires it).
- [x] 5.2 mine (mine model v2, mine plan, floor/drop checks, veins, torches, unload at home, mine memory).
  (2026-11-12) `bot/src/models/mine/` is the mine model (laya-go prompt v1/v2, rules v2.1; no drift from laya-go
  cb1c791): typed ORES/tiers, view, `MineAction` questions, state, answer, rules (decide/followPlan/unload), the plan
  generator (`createPlan`), geometry (floorDrop/dropBelow moved here from actuators, veins, torches, deposit list) and
  `decideMineStep` in the old veto order. `bot/src/jobs/mine.ts` `MineRun`: one old loop iteration per step, setup on
  the first (pickaxe, mine memory reuse/gone, new plan); heal, unsafe-ground restarts, walk back, shift-stair, detour
  abandon, torches, fluid blocks, the pickaxe re-made; progress `{done, deposited}`, done checkpointed before each
  deposit; the mine record saved at the 3rd dug mark so a kill -9 resumes the same mine. Task off → one collectBlocks.
  New actuators: Motion `{safe}` movements (maxDropDown 3, no parkour, no flow), collectOreAt/digBlock/walkTo, placeAt,
  goHome/depositAtHome. `laya-mine.jsonl` in the old shape (live line + `branches/mine.jsonl`, 164 lines from
  `tools/laya-logs/record-mine.mjs`, byte for byte). All old mine tests ported (44 loop, 13 plan, state/v2/goldens,
  geometry). npm test 331/331. Live: mine-coal, mine-iron-staircase, unload-home-chest pass twice (unload-home-chest
  now mines 20 coal: with 2 the collect-first rule ends before any Unload); regression 6/6; kill -9 resume, defend
  interrupt, pickaxe wear-out and !stop by hand. Report `bots/andy/logs/game-tests/bot-rebuild-5.2-2026-11-12.md`.
- [x] 5.3 farm (farm model v2, water, pond, seeds, unload).
  (2026-11-12) `bot/src/models/farm/` is the farm model (laya-go prompt v1/v2, rules v2.1 nearestDry; no drift from
  laya-go cb1c791: the three requests are its testdata byte for byte): typed crops/items/actions/cells, view (readCell,
  cell names, BY_DISTANCE, pond checks), state/stateV2 and the pack line, questions, typed answer, rules (decide, veto,
  needed, farmKeep, Unload) and `decideFarmStep` in the old loop's order (model when sure, v2 rules / v1 wait, ban →
  rules, dry wait → pond or find_water, the crop's seed, missing item, veto). `jobs/farm.ts` `FarmRun`: one old loop
  iteration per step; starter kit, find water once, wait_limit, bans and max_bad, unload (v2) with a checkpoint;
  progress `{harvested}` across resumes. `farmWorld.ts` + `actuators/farm.ts`: Motion `{farm}` movements (no parkour,
  sprint or digging, farmland and crops avoided), till/plant checked with until, water/pond refused when it floods and
  poured as an item use, breed, a water bucket only from a bucket or iron and water near. Home chest by sign
  (`home/adopt.ts`, every 30 s), wired into the farm and the mine jobs. `laya-farm.jsonl` in the old shape (live line +
  `branches/farm.jsonl`, 36 lines from `tools/laya-logs/record-farm.mjs`, byte for byte). All of test/laya_farm.test.js
  ported (400 laya-go decisions too). Live fixes beyond the old bot: crop on farmland at head level read, a done step
  repeated on the same state fails, produce picked up later counts, no unload with nothing to put in, start-agent
  re-reads the places, and the harness anchors `site` steps on the site block. npm test 408/408. Live: home-chest-sign,
  farm-water, farm-no-water, farm-bucket 4/4 in runs 5–8 (7, 8 on the final code); regression 9/9; kill -9 resume (10 → 21 harvested),
  !stop, defend interrupt and unload keeping 16 seeds by hand. Report `bots/andy/logs/game-tests/bot-rebuild-5.3-2026-11-12.md`.
  The minutes goal (`!layaFarm(minutes)`, chores tend_farm) is 5.6's.
- [x] 5.4 hunt.
  (2026-11-12) `bot/src/jobs/hunt.ts`: `huntStep`, one old huntUntil iteration per job step (the drop's count reached →
  done "Hunted N cow: I have n beef."; attack (item null) after one kill → done "Successfully killed pig."; count*3+4
  tries → failed; none within 24 → pick up, then done or failed 'none near' / "Could not find any X to attack."); an
  abort mid-kill counts nothing, a failed kill counts a try. Progress `{target, kills, tries}`: target fixed on the
  first step and checkpointed, so a resumed hunt adds no more. `actuators/hunt.ts`: `nearestMob` (HUNT_RANGE 24) and
  `killEntity` (loops fight() with the signal, not pvp; 30 s ceiling; a strike gap), `jobs/huntWorld.ts` (pickup
  after each kill). No model (the hunt skill model is 5.5). Old huntUntil test ported + resume/abort/attack/wool/
  timeout/director/jobfile tests; npm test 423/423. Live: hunt-beef, hunt-none-near, attack-legacy 3/3 twice; regression
  7/7; kill -9 resume (target 6 kept, ended at 8), !stop and defend interrupt by hand. Report
  `bots/andy/logs/game-tests/bot-rebuild-5.4-2026-11-12.md`. Not ported: the water-mob self_preservation pause.
- [x] 5.5 hunt, gather and place skill jobs (design §11, skills-spec v1 §2–4): renderer, questions, typed answer, rules v1, golden test, a
      game scenario each. They run on rules v1 until laya-go serves the models.
  (2026-11-12) `bot/src/models/{skill,hunt,gather,place}/`: laya-go games/{hunt,gather,place} v1 ported (State,
  Questions, Decide, Harmful; place's 24-nearest candidates); `decideSkill`: the model when the task is on, the answer
  well formed, sure (min_confidence 0.3) and not harmful, else rules v1 with why (rules, no-answer, malformed,
  low-confidence, veto). `sensors/skills.ts`: directions (tie N/S), ⌊horizontal distance⌋, the 49/97/193 search square
  around the run's start, adults (mooshroom = cow), drops within 16, trees (logs with leaves, clustered by column),
  wood/wool/saplings counts, the place grid (CELL_TABLE, columnCell, 9×9 step 1; torches the 7×7 step-3 LIT_OFFSETS
  chores' lit uses). Jobs `huntFood`, `gatherSkill`, `place` (`jobs/huntFood.ts`, `gatherSkill.ts`, `place.ts`,
  `skillWorld.ts`): one model step per job step, progress {origin, search, steps, kills, repeat, skip} in
  laya-job.json, typed `SkillFailReason` in JobEnd.reason (no_source, full, no_spot, missing_<item>, stuck, timeout);
  place reads its cell again before placing; `home/centre.ts` baseCentre is the stand-in for 5.6's chooseCentre.
  Logs laya-hunt/gather/place.jsonl (`skillLine`, correction tool reads them). Triggers (harness only) `!layaHunt(n)`,
  `!layaGatherSkill("logs", n)` (layaGather stays 5.1's), `!layaPlace("furnace")`. Golden + 300 laya-go situations
  per skill (state, options, rules, harmful), sensor and loop tests; npm test 455/455. Live: 4 skill scenarios ≥ 2×
  each, gate 9/9 with the regression set, !stop, defend mid-gather and kill -9 resume by hand. Report
  `bots/andy/logs/game-tests/bot-rebuild-5.5-2026-11-12.md`. The served hunt v1 model never answers done (keeps
  hunting past the goal): the tasks stay off in settings.js until laya-go fixes it.
  Review fixes (2026-11-12): the place grid's floor range is ±1 (solid at head height and a drop of 2 are `#`); the
  stuck count starts again after a cut, shear or kill that worked, and seeds get 16 steps per item (live: 8 seeds in
  111 steps); a tree, grass or animal an act failed on is left out of Source/Animals (positions kept, entity ids
  cleared on a restore); a bed re-reads its east cell, fails stuck when the walk west fails, and is taken back unless
  its head is east; place takes a missing item from the home chest (not the kit; live: a bed from the chest, facing
  east); seeds dig from within 3 (a look-at goal on grass never ends); takeBack waits for the drop's pickup delay; placeAt
  digs leaf litter, petals and flowers first (a torch on a leaf-litter cell failed). npm test 460/460; gate 8/9: the
  4 skill scenarios and the regressions pass except craft-furnace, where the served craft model now answers
  `gather log` with cobblestone and a table (p 0.84; for laya-go, not this change).
  Left for 5.6: chores calls the jobs (purpose chore, chest counts), the real base centre, the director's Job words
  for the new kinds, and the gather skill recording stumps (chores state `stumps`) for replanting.
- [x] 5.6 chores v2 (skills-spec v1 §1): Carry/Chest/Made/Kit, Last from the run lines; answers map 1:1 to skill jobs
      or rules actuators (cook, store, sleep, ask, rest). Chores v1.1 stays available as the stopgap until v2 is
      served.
  Done (2026-11-12): `bot/src/models/chores/` ports laya-go games/chores/v2 (state byte for byte, rules v2 with its
  rule names, Harmful, the typed answer, goals.ts with every amount); golden request and 300 laya-go situations
  (`test/fixtures/laya-chores-v2/`). Chores v1.1 stays in the old bot; the new bot asks the chores model only when its
  task is on **and** golaya serves `chores` at prompt v2, else rules v2 (why `rules` / `not-v2`); nothing is served yet.
  `bot/src/chores/`: sense (chooseCentre ported into home/centre.ts and used by the place skill; Chest = the home
  chest less the kit, refreshed on every chest open through `Act.chestSeen`; lit on place's torch grid), Last from
  laya-chores.jsonl run lines (tail, at start and on every ask; a `forget` line from the harness's world reset drops
  older runs), the closed reason map (craft's chore gather now ends `missing_<kind>`), answer → job for all 44 pairs,
  and the driver (director onIdle; only after the 4.3 restore; the old !stop hold and 3 s player gap). New job kinds
  cook, unload, kit, sleep (actuators/sleep.ts), rest (with ask: "I need …" once per item per 5 min), cobble; craft
  bed and craft into the kit; farm `goal: {minutes}`; mine `until: 'day'`. Chore leases are `action:chore:<skill>_<target>`;
  chores are never saved to laya-job.json; `!layaChores("off")` withdraws the running chore (no run line).
  npm test 486/486. Live (rules v2): chores-idle-start, chores-command-interrupt, chores-defend-player and the new
  chores2-no-trees 4/4 twice in a row, chores2-first-day pass (table, wooden and stone tools, furnace, cook, torches,
  two kit tools, iron at night until day), the 5.5 regression set 9/9, kill -9 (no job file; the cooldown survives)
  and chores off by hand. Report `bots/andy/logs/game-tests/bot-rebuild-5.6-2026-11-12.md`.
  **For 6.1:** the new bot's suite needs `chores2-no-trees` and `chores2-first-day` (the old two use v1.1 words).
- [x] 5.7 Correction path: `andy_logs` (or a small tool) turns a `laya-<model>.jsonl` line into a correction case in
      the format laya-go's controller `/job` takes.
      Done: `bot/src/log/correction.ts` (`node bot/dist/src/log/correction.js --task <task> --right Q=answer,...
      [--line N | --time ISO | --match text]`). `/job` (laya-go trainctl JobRequest) carries no case data, so the case
      holds the line's exact state, what was answered and by whom, the outcome and the right answer, plus `job`: the
      exact `/job` body (model, conf "", priority next, from ""). No network: submit `job` after laya-go has the case.

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
