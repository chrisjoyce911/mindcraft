# Tasks

- [x] 1.1 Copy laya-go's eat golden request into `test/fixtures/laya-eat-v1/` with its provenance; add `src/agent/laya/eat_state.js` (food table, state, questions); verify the "Golden state" and "True saturation" scenarios
- [x] 1.2 Add `src/agent/laya/eat.js` (one decision tick: ask, confidence, disagreement, safety rules, eat, fallback, counters, step log); verify every "Eating on the model's choice", "Safety rules", "Falling back to auto-eat" and "Measurements and step log" scenario with a fake bot and model
- [x] 1.3 Add the `eat` task to `settings.js` and the `laya_eating` mode to `src/agent/modes.js` (danger from hostile mobs within 8 and lava within 2; auto-eat off while the task is on, except during fallbacks); verify the "Default settings" scenario
- [x] 1.4 Document it in `docs/laya-eat.md`
- [ ] 1.5 In the game with a trained eat model: confirm eating decisions, fallbacks and the step log; record the counters in `docs/laya-eat.md`
