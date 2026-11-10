# Tasks

- [x] 1. `mine_plan.js`: plan from start (x, y, z, heading, ore band, options): segments (staircase, main, branches, next level, next shaft), `next(pos)` → plan step or "walk to waypoint", `abandon()` for the current segment, staircase shift; unit tests for each scenario.
- [x] 2. `mine_state.js`: v2 state (`Plan` and `Pack` lines, Unload question) and `decide` with a plan (port of laya-go's v2 rule 5), `unload` (laya-go `rules.Unload`), `valuables`; golden v2 fixture test against laya-go's `v2_sample_request.json`, and Decide/Hazard/Unload against 300 laya-go v2 situations.
- [x] 3. `mine.js`: plan loop: plan step into the state, walk back after collect or at a branch end, abandon on detour, torch side, entrance in chat; unloading into the home chest (`home_chest` place; model when confident, else rule; always when full); `prompt: 'v1'` keeps the old loop; tests with fakes.
- [x] 4. `settings.js` mine options, `laya_check.js` v2 sample, `docs/laya-mine.md`.
- [ ] 5. `npm test` passes (with the repo's settings.js); merge into `laya-follow`.
