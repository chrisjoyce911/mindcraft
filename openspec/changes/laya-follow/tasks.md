# Tasks

## 1. Settings and client

- [ ] 1.1 Add the `laya` block to `settings.js` (off by default) and a `test` script (`node --test test/`) to `package.json`; verify the "Default settings" scenario
- [ ] 1.2 Add `src/models/laya.js` (`decide` with an `AbortController` timeout, answers or null); verify the "Timeout" and "Questions match laya-go" scenarios against a fake server and the copied golden request

## 2. Follow state

- [ ] 2.1 Copy laya-go's `v1_sample_request.json` and golden sample terrain into `test/fixtures/laya-follow-v1/`, recording the laya-go commit they came from
- [ ] 2.2 Add `src/agent/laya/follow_state.js`: the alphabet, clamping, player line, and the column reader over a `blockAt` function; verify the "Golden state", "Clamping", "Fence", "Magma", "Deep drop" and "Unloaded" scenarios with fake worlds

## 3. Loop

- [ ] 3.1 Add the veto over the grid (laya-go's harm, climb, drop, diagonal and unknown rules); verify the "Lava step refused", "Harmful drop refused" and "Drop into water allowed" scenarios and laya-go's `world` move scenarios
- [ ] 3.2 Add `src/agent/laya/follow.js`: ask, check confidence and `wait`, veto, step with `GoalBlock`, detect stuck, fall back with `GoalFollow` for `fallback_ms`; verify the "Low confidence" and "Arrived waits without asking" scenarios with a fake bot and server
- [ ] 3.3 Add the session counters and the step log; verify the "Step logged" scenario
- [ ] 3.4 Route `skills.followPlayer` to the Laya loop when `laya.enabled` is on

## 4. Try it and document

- [ ] 4.1 Document setup (serve a follow model with `golaya serve`, turn on `laya.enabled`) and what the measurements mean, in `docs/laya-follow.md`
- [ ] 4.2 With an untrained model served, follow a player in the game on the Mac mini (or between training runs): confirm low-confidence fallbacks, no harm, and the step log being written; record the session counters in `docs/laya-follow.md`
