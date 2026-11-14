# Tasks

- [x] 1. Unit test `test/laya_gather_reach.test.js` with a fake bot and world: a floating log (air under it, 6 up) nearest, a standing tree further off. Confirm it fails on the current code (the same position is chosen again after a failure).
- [x] 2. `collectBlock`: per-call failed-position set, skipped in the filter; only successes count toward `num`; stop after `MAX_COLLECT_FAILURES` (5) in a row or no candidates; interrupts and `NoChests` behave as before.
- [x] 3. `reachableLog` column check (`LOG_REACH_ABOVE_GROUND` = 6; walk down through the trunk; leaves and liquids aren't ground) applied to `*_log` candidates only.
- [x] 4. `collectBlock('log')` expands to all overworld log types; `layaGatherBlocks('log')` calls it with `'log'` instead of the first found name.
- [x] 5. Reason: a short log gather reports "no more logs I can reach here (got N)" through the failed-job message.
- [x] 6. Unit tests for every scenario in `specs/laya-jobs/spec.md`; `npm test` passes (366 tests).
- [ ] 7. Game scenario `gather-logs-unreachable` in `test/game/scenarios.json`: on the test world, fill an oak log 6 above grass next to andy (air under it) and place a birch tree 12 blocks away; chat "andy gather 4 logs"; checks: +4 logs within 120 s, no more than 1 "Failed to collect" for the floating log's position. `run_test gather-logs-unreachable` PASSes, and `craft-wooden-pickaxe` still PASSes.
- [ ] 8. Note in `openspec/changes/bot-rebuild` tasks that `actuators/collectBlock` must carry the failure memory and log reach filter.
