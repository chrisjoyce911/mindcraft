# Tasks

- [x] 1. Stoppable runs (`src/agent/run_token.js`): runJob and mode execute return within 100 ms of an interrupt; given-up work cancelled; skills, mine, farm, follow check `stopped(bot)`; runChore on the shared runner; tests.
- [x] 2. A player's job kept in `laya-job.json` (save/progress per job), restored paused after a restart or reported lost; world reset removes it; tests.
- [x] 3. Attack sensor (`laya/attacks.js`); laya_defending, self_defense and cowardice act only on attackers; tests.
- [x] 4. Director v1.3 mirror (Me line, rules, older prompts held to v1.3 where they differ); golden v1.3 request and laya-go decisions fixture; tests.
- [x] 5. Craft: kit left out of the craft chest read; recipe-rules chain in craftForTask; tests.
- [x] 6. unstuck paused during rest, eat and heal.
- [x] 6a. Chores v1.1 mirror (Animals searches, Failed cooldown, need answers and their actuator); golden v1.1 request and laya-go decisions fixture; tests.
- [x] 7. light_base: one dark-spot test, fresh read; tests.
- [ ] 8. `npm test`; full game suite with `llm` false (≥ 16/16); game tests: interrupted gather (no restart), a mob attacking nobody (keeps working), a zombie hitting andy (fights), a zombie hitting tester (defends); first day from scratch through the first night; report in `bots/andy/logs/game-tests/`.
- [ ] 9. Merged into `laya-follow`.
