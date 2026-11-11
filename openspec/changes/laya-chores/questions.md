# Open questions (Mindcraft side, 2026-11-11 AEST)

1. **"stop" and chores.** "andy stop" (`!stop`) now holds chores for 5 minutes, or until the player's next command;
   otherwise he would be back at work within 5 seconds of being told to stop. The spec doesn't say. Keep 5 minutes,
   make it longer, or have "stop" mean "take a break" (chores off)?
2. **A served director model on prompt v1.** The served `director` model was trained on v1.1 data and can't see the
   Player line. Mindcraft sends it the v1 text and lets the v1.2 rules decide `defend-player` and `flee-ranged`
   (the model can't override what it can't see). Switch `decision_models.tasks.director.prompt` to `v1.2` once the
   v1.2 model is served.
3. **Defend while following.** `defend-player` interrupts a follow/come action too (follow resumes by itself after);
   the other director activities (eat, heal, unload) still don't stop a non-Laya action. Is that the right line?
4. **Chore job kind in the director state.** The shared director spec has no `chore` job kind, so a chore shows as
   the job kind of what it does (`Job gather log`, `Job mine cobblestone`, `Job stay none` for rest/sleep). A director
   v1.3 could add `chore`; until then this keeps the director's rules (continue, unload while busy, resume) working.
5. **Can place / Can smelt are `yes`.** Mindcraft now has place and smelt actuators for every masked chore
   (placeBlock, smeltItem), so the sensor reports `Can place yes smelt yes`; `decision_models.tasks.chores.can_place`
   / `can_smelt: false` mask them again. The chores-go spec text says "both no today": laya-go's training data
   should cover both (it does in the generator).
6. **Home chest contents.** Have/Food count the home chest from what andy saw the last time he opened it (kept in
   `bots/andy/laya-chores.json`); a player's changes aren't seen until he opens it again.
