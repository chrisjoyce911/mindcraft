# Tasks

- [ ] 1. Unit test reproducing the baseline state with a delayed-update fake bot; confirm it fails on the current code.
- [ ] 2. Find the root cause (late update, `realName`, or `times`) and note it in this change's proposal.
- [ ] 3. Fix `act.craft` and `act.smelt` (count on the settled inventory) or the root cause; log `before` and `after` in the step.
- [ ] 4. `npm test` passes.
- [ ] 5. On the test world (`world_reset`, `bot_start`): `run_test craft-stone-pickaxe` and `craft-wooden-pickaxe` both PASS. Record them in the next strict run.
