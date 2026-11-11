# Tasks

- [ ] 1. `farm_plan.js`: field geometry, rotation, lot templates and `cropAt` for every kind; site search (flattest 23×23 within the radius). Unit tests against the design's coordinates.
- [ ] 2. `farm_map.js`: the `farms` memory, the walk-round record, breed times per pen, faults; updates from actions. Unit tests.
- [ ] 3. `farm_state.js` v3: lines from the map, chests and view; the new cells; the `Lot` question; a port of the v3 rules; golden fixtures (`v3_sample`, `v3_trees`, `v3_ranch`, `v3_freeform`) byte for byte; agreement on 300 laya-go v3 situations.
- [ ] 4. `farm_actions.js`: mend, cull, shear, eggs, fell (with pillar), compost, expand (via `laya-build`), seeds; walk to the Lot; pen gate rules. Tests with fakes.
- [ ] 5. `farm.js`: the v3 loop (walk-round timer, Unload between steps via `laya-purpose-chests`); v2 kept.
- [ ] 6. Settings, `laya_check.js` v3 sample, `docs/laya-farm.md` (fields, templates, the open-question defaults).
- [ ] 7. Scenarios `farm-field-place`, `farm-mend-gate`, `farm-harvest-lot`, `farm-expand`, `farm-fell-birch`, `farm-compost`, `farm-ranch-breed`.
- [ ] 8. Research §5 measurements on the test world, recorded in `docs/research/farming.md` §5 as answered:
  - grow time;
  - the row rule;
  - sapling light and spacing;
  - the reach for a 7-log birch;
  - covered channels;
  - path blocks as fruit support;
  - growth while andy is away.
- [ ] 9. `npm test` passes; the scenarios PASS with the rule port; then with `farm-q` through `game-test:gate --task farm`.
