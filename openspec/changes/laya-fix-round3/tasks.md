# Tasks

- [x] 1. Director activities (eat, heal, unload) in `laya/activities.js` with an interruptible pause; the director stops a running activity on a different answer; tests.
- [x] 2. `interrupt.js`: clear the path goal, one collect cancel per stuck task; collectBlock/pickupNearbyItems stop on interrupt; places in memory.json, saved on change, loaded on restart; tests.
- [x] 3. Craft take/store bookkeeping by the pack's change; a failed take re-reads the chest once; failed jobs say why; tests.
- [x] 4. Store-everything keep-list (coal, charcoal, torch, stick, tools, weapons, armour, food); tests.
- [x] 5. `goal-carried` refusal; ingredients from the chest before `needs-*`; tests.
- [x] 6. The hand after jobs and pickups (`laya/hand.js`); tests.
- [x] 7. Count replies; tests.
- [x] 8. Laya client retry and back-off; tests.
- [x] 9. `npm test` passes; full game suite with `llm` false (≥ 16/16) and scripted checks for 1, 2 and 4 on the test world; report in `bots/andy/logs/game-tests/fix-round3-2026-11-11.md` (15/16, the mine-iron-staircase miss passed on rerun; checks 1, 2, 2a, 4 pass).
- [x] 9a. Stopping an activity on a different answer interrupts only that director action, never a mode that took over (found in check 1); test.
- [x] 10. Merged into `laya-follow`.
