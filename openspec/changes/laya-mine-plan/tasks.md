# Tasks

- [ ] 1. `mine_plan.js`: plan from start (x, y, z, heading, ore band, options): segments (staircase, main, branches, next level, next shaft), `next(pos)` → plan step or "walk to waypoint", `abandon()` for the current segment, staircase shift; unit tests for each scenario.
- [ ] 2. `mine_state.js`: v2 state (`Plan` line) and `decide` with a plan (port of laya-go's v2 rule 5); golden v2 fixture test against laya-go's `v2_sample_request.json`.
- [ ] 3. `mine.js`: plan loop: plan step into the state, walk back after collect or at a branch end, abandon on detour, torch side, entrance in chat; `prompt: 'v1'` keeps the old loop; tests with fakes.
- [ ] 4. `settings.js` mine options, `laya_check.js` v2 sample, `docs/laya-mine.md`.
- [ ] 5. `npm test` passes (with the repo's settings.js); merge into `laya-follow`.
