# Tasks

- [x] 1. Stoppable runs (`src/agent/run_token.js`): runJob and mode execute return within 100 ms of an interrupt; given-up work cancelled; skills, mine, farm, follow check `stopped(bot)`; runChore on the shared runner; tests.
- [x] 2. A player's job kept in `laya-job.json` (save/progress per job), restored paused after a restart or reported lost; world reset removes it; tests.
- [x] 3. Attack sensor (`laya/attacks.js`); laya_defending, self_defense and cowardice act only on attackers; tests.
- [x] 4. Director v1.3 mirror (Me line, rules, older prompts held to v1.3 where they differ); golden v1.3 request and laya-go decisions fixture; tests.
- [x] 5. Craft: kit left out of the craft chest read; recipe-rules chain in craftForTask; tests.
- [x] 6. unstuck paused during rest, eat and heal.
- [x] 6a. Chores v1.1 mirror (Animals searches, Failed cooldown, need answers and their actuator); golden v1.1 request and laya-go decisions fixture; tests.
- [x] 7. light_base: one dark-spot test, fresh read; tests.
- [x] 8. `npm test` (354/354); full game suite with `llm` false (≥ 16/16); game tests: interrupted gather (no restart), a mob attacking nobody (keeps working), a zombie hitting andy (fights), a zombie hitting tester (defends); first day from scratch through the first night; report in `bots/andy/logs/game-tests/fix-round4-2026-11-11.md` (suite 15/16, `defend` 16/16 after its husk hits andy; game tests A–E pass; first day: 0 rests, 2 failures, 0 restarts).
- [x] 8a. Found in test C: defend-player and laya_defending fought the same attacker → stop race → kill; the director performs defend-player only with no attacker in the mode's reach, `ActionManager.stop` waits only for its own action; tests.
- [ ] 9. Merged into `laya-follow`.
