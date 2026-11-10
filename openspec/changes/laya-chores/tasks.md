# Tasks

- [ ] 1. `chores_state.js`: state from the sources (each optional), laya-go golden fixture byte for byte, a port of the rules and Safe; agreement on 300 laya-go situations.
- [ ] 2. `chores.js`: idle detection, the loop, the job-to-command table, `job_minutes` bound, Safe fallback, log. Tests with fakes: interrupt, night, no home chest.
- [ ] 3. Chores mode in `modes.js` (lowest priority; interrupted by any player instruction); `!layaChores`; memory `chores_on`.
- [ ] 4. Settings, `laya_check.js` chores sample, `docs/laya-chores.md`.
- [ ] 5. Scenarios `chores-idle-start`, `chores-interrupt`, `chores-night`, `chores-logs-short`, `chores-off`.
- [ ] 6. `npm test` passes; the scenarios PASS with the rules; then with `chores-a` through `game-test:gate --task chores` (the gate includes the whole quick suite, so chores can't break follow or defend).
