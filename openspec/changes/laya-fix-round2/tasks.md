# Tasks

- [x] 1. `settings.llm` switch: routing (`llm_gate.js`), agent/modes/self-prompter/memory/convo/npc/vision gates; tests.
- [x] 2. Resume after interrupt as a job stack + one decision point (`laya/director.js`, the shared director spec in design.md): rules, state text, `laya-director.jsonl`, `decision_models.tasks.director` (off); the interrupt's exception keeps the job; remaining count; tests.
- [x] 3. Mine plan: staircase to at least 10 below the entrance and the ore's best level; tests.
- [x] 4. Mine safety: rule `heal`; `drop` veto on model and rule moves; tests.
- [x] 5. Mine memory: save and resume mines; tests.
- [x] 6. Home chest: block `rememberHere("home_chest")` off a chest, drop a home without a chest; tests.
- [x] 7. Unload failure backs off (unload_fail_steps 200); ore in sight with room is collected first.
- [ ] 8. Torches: sticks, plank withdrawal, place back-off.
- [ ] 9. Collect filter: open ore below collect_below.
- [ ] 10. Memory summary without finished requests.
- [ ] 11. `npm test` passes; merged into `laya-follow`.
- [ ] 12. Full game suite with `llm` false; report.
