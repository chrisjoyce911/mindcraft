# Tasks

- [ ] 1. `tools.js`: `canMine`, `choose` (cheapest or fastest); equip by choice in the mine and collect paths. Unit tests.
- [ ] 2. `ore_memory.js`: record, prune, nearest, list, cap. Unit tests, including Brisbane timestamps.
- [ ] 3. `mine_state.js` v3: V/K cells, Near, Memory and Kit lines, Upgrade question, a port of the v3 rules; golden fixtures from laya-go (`v3_sample`, `v3_grab`, `v3_upgrade`) byte for byte; agreement on 300 laya-go v3 situations.
- [ ] 4. `mine.js`: grab (walk back to the plan, skip after two failures), recall, the upgrade sequence (no loop), recording sightings. Tests with fakes.
- [ ] 5. Settings (`grab_detour`, `recall_radius`, `ore_memory_max`; `prompt` stays v2), `laya_check.js` v3 sample, `docs/laya-mine.md`.
- [ ] 6. Scenarios `mine-grab-diamond`, `mine-remember`, `mine-upgrade`, `mine-cheap-pick` in `test/game/scenarios.json`.
- [ ] 7. `npm test` passes.
- [ ] 8. With a promoted v3 model: switch to `prompt: 'v3'`, run `game-test:gate --task mine`, and keep v2 if it fails.
