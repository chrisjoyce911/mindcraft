# Tasks

- [x] 1. `settings.llm` switch: routing (`llm_gate.js`), agent/modes/self-prompter/memory/convo/npc/vision gates; tests.
- [x] 2. Resume after interrupt as a job stack + one decision point (`laya/director.js`, the shared director spec in design.md): rules, state text, `laya-director.jsonl`, `decision_models.tasks.director` (off); the interrupt's exception keeps the job; remaining count; tests.
- [x] 3. Mine plan: staircase to at least 10 below the entrance and the ore's best level; tests.
- [x] 4. Mine safety: rule `heal`; `drop` veto on model and rule moves; tests.
- [x] 5. Mine memory: save and resume mines; tests.
- [x] 6. Home chest: block `rememberHere("home_chest")` off a chest, drop a home without a chest; tests.
- [x] 7. Unload failure backs off (unload_fail_steps 200); ore in sight with room is collected first.
- [x] 8. Torches: a craft step waits for a late inventory before failing; materials taken 8 at a time; a failed torch place retries 3 moves on.
- [x] 9. Collect filter: ore open to the air is collected down to collect_below_open (8) below; collect_below stays 4.
- [x] 10. Memory summary without requests or jobs (prompt + scrubMemory).
- [x] 11a. Command: gather/attack with item none read the animal or drop from the message (feedback 9, 10).
- [ ] 11. `npm test` passes; merged into `laya-follow`.
- [ ] 12. Full game suite with `llm` false; report.
