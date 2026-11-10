# Tasks

- [ ] 1. Merge `baseline-fixes` (strict runner, summaries, `compare.js`) first.
- [ ] 2. `test/game/scenarios.json`: the `gates` map (follow, craft, farm, mine, defend, eat, command, build, chores) and `flaky` flags. A parser test covers both.
- [ ] 3. `gate.js`:
  - start a candidate golaya on a spare port;
  - pass a `SETTINGS_JSON` override for that one task;
  - `world_reset`, `bot_start`, the suite, the verdict rule, the report, the exit codes.

  Unit tests with fake world, bot and runner (pass, regression, flaky retry, world down).
- [ ] 4. Summaries carry the model id per task; MCP `run_gate`; `package.json` script.
- [ ] 5. `docs/game-tests.md`: promotion.
- [ ] 6. `npm test` passes.
- [ ] 7. On the test world: gate the served models against themselves (expect pass), then a deliberately weak model (e.g. a 1-epoch farm model; expect fail).
- [ ] 8. On the Studio (manual, outside git): call the gate from `data/cycle3.sh` `promote()` after the held-out check improves.
