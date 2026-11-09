# Tasks

Depends on `laya-client`.

## 1. Follow state

- [ ] 1.1 Add `src/agent/laya/follow_state.js`: the alphabet, clamping, player line, and the column reader over a `blockAt` function; verify the "Golden state" (against `test/fixtures/laya-follow-v1/`), "Clamping", "Step up", "Magma", "Fence", "Deep drop" and "Unloaded" scenarios with fake worlds

## 2. Loop

- [ ] 2.1 Add the veto over the grid (laya-go's harm, climb, drop, diagonal and unknown rules); verify the "Lava step refused", "Harmful drop refused" and "Drop into water allowed" scenarios and laya-go's `world` move scenarios
- [ ] 2.2 Add `src/agent/laya/follow.js`: ask the `follow` task, check `confident` and `wait`, veto, step with `GoalBlock`, detect stuck, fall back with `GoalFollow` for `fallback_ms`; verify the "Server down", "Low confidence" and "Arrived waits without asking" scenarios with a fake bot and server
- [ ] 2.3 Add the session counters (on top of `laya-client`'s) and the step log; verify the "Step logged" scenario
- [ ] 2.4 Add `step_ms`, `fallback_ms` and `log_steps` to the `follow` task's settings, and route `skills.followPlayer` to the Laya loop when the task is on; verify the "Default settings" scenario

## 3. Try it and document

- [ ] 3.1 Document using it (serve a follow model, turn the `follow` task on) and what the measurements mean, in `docs/laya-follow.md`
- [ ] 3.2 With an untrained model served, follow a player in the game on the Mac mini (or between training runs): confirm low-confidence fallbacks, no harm, and the step log; record the session counters in `docs/laya-follow.md`
