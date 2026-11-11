# Tasks

- [ ] 1. `purpose_chests.js`: sign parse (name, purpose, any case), the purpose table (tested item by item over the items andy handles), route (nearest first, home last), kits per job. Unit tests.
- [ ] 2. Registry: sign scan within 48 at most every 30 s and at job start, memory `purpose_chests`, dropping stale chests. Fake-world tests.
- [ ] 3. `pack_actions.deposit` by purpose with spill-over and the never-discard rule; `pack.js` Home by purpose. Tests, including all chests full.
- [ ] 4. `home_chest.js`: a plain name sign stays home; a purpose sign doesn't become home.
- [ ] 5. Kits before jobs in `farm.js`, `mine.js` and the trees and build entry points (the latter as hooks for `laya-farm-v3` / `laya-build`).
- [ ] 6. Docs (`docs/laya-farm.md`, `docs/laya-mine.md`: purpose chests).
- [ ] 7. Scenarios `purpose-unload`, `purpose-kit`, `purpose-full` in `test/game/scenarios.json`; the parser test passes.
- [ ] 8. `npm test` passes; the three scenarios PASS on the test world; the strict suite is no worse than the baseline.
