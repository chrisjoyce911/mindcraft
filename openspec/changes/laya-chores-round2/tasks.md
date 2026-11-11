# Tasks

## 1. Fixes
- [x] 1.1 Mine: never dig the block under itself over a drop > 3; mine moves never drop > 3 (`floorDrop`, `safeMovements`).
- [x] 1.2 Chores: cancel a chore given up on (no background actuator after an interrupt); truthful craft failure.
- [x] 1.3 Placing: step back, retry, more spots, placeBlock's reason in the outcome.
- [x] 1.4 Director: model `defend` with nothing to defend → rules (`nothing-to-defend`).

## 2. Build
- [x] 2.1 Sapling where a felled tree stood (stumps).
- [x] 2.2 Whole coal/copper veins during stone mining.
- [x] 2.3 Wool from string: sensor count and craft path.

## 3. Verify
- [x] 3.1 Unit tests (`test/laya_chores_round2.test.js`), `npm test` green.
- [ ] 3.2 Game check at night: mine over a cave.
- [ ] 3.3 Full suite with the LLM off ≥ 16/16.
- [ ] 3.4 First day from scratch through the first night; report compared with the first run.

## 4. laya-go (not this repo)
- [ ] 4.1 Director data: `Last done` with nothing near → idle (the served model answers defend).
