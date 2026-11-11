# Tasks

- [ ] 1. `blueprints.js`: format 1 loader and validator, rotation of grids and block states, the class table, parts and stages, the material bill with one-level craft expansion, quartz detection. Unit tests per error and per rotation.
- [ ] 2. First blueprint files: `composter`, `shed`, `crop_field` (+ `field_fence`, `crop_lot`), `egg_collector`, `cow_crusher`, `cane_field`, `tree_farm`, `melon_field`, `ranch`; the locked `cane_observer` and `chicken_cooker`. All validate.
- [ ] 3. `build_state.js`: candidate selection, laya-go build prompt v1 byte for byte (golden fixture), a port of the answer key and Danger.
- [ ] 4. `place_oriented.js`: look, place against a face, verify `facing`, redo. Tests with a fake bot.
- [ ] 5. `build.js`:
  - the `!layaBuild` entry, clear and level (keep drops), materials (pack, purpose chests, craft loop, gather);
  - the step loop with model or rule, danger step-aside, the check-and-fix rounds;
  - the `builds` memory, the gate and queue replies.

  Tests with fakes.
- [ ] 6. `upkeep.js`: empty, restock, feed, repair, stalled (with the 128-block tick condition). Tests.
- [ ] 7. Settings `decision_models.tasks.build`, `laya_check.js` build sample, `docs/laya-build.md` (the format with an example, the class table, how to add a blueprint).
- [ ] 8. Copy the first blueprints to laya-go `games/build/testdata/blueprints/` (with laya-go `build-game`).
- [ ] 9. Scenarios `build-composter`, `build-shed`, `build-crop-field-stage0`, `build-egg-collector`, `build-locked-observer`, `upkeep-empty`.
- [ ] 10. `npm test` passes; the scenarios PASS on the test world with the rule fallback; then with `build-a` through `game-test:gate --task build`.
- [ ] 11. Research §5 checks relevant to builds: hopper, piston, observer and dispenser facing through mineflayer (§5.17); feeding over a fence (§5.13); the cow crusher with `maxEntityCramming` 24 (§5.12). Record them in `docs/laya-build.md`.
