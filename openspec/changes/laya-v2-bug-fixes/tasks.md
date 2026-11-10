# Tasks

- [x] 1. Mine: collect only safe ore near the plan, within an off-plan budget; walk back; state and position on walk steps; tests.
- [x] 2. Farm: buckets pour and fill with `lookAt` + `activateItem`, checked.
- [x] 3. Farm: ban a failed or vetoed action on its cell, stop after `max_bad` in a row, veto a pond beside a hole; tests.
- [x] 4. Mine unload through `packDeps`; a full chest after a partial deposit is not a failure; test.
- [x] 5. Craft: wait for the inventory to settle after a craft; test.
- [x] 6. Farm: `till` and `plant` check the block afterwards.
- [x] 7. Mine torches: craft a batch whenever low with materials carried, with back-off; tests.
- [x] 8. `followPlayer` without a loaded player entity.
- [x] 9. `npm test` passes.
- [x] 10. Full game-test suite on the test world, compared with the v2 and v1 baselines; report in `bots/andy/logs/game-tests/`.
- [ ] 11. Open: mine-iron-staircase phase (a) wants the surface iron about 11 blocks away (`collect_range` 8), and the staircase loops detour→walk back when collecting removed the floor of a stair cell (see `v2-bugfix-report-2026-11-10_17-24.md`).
