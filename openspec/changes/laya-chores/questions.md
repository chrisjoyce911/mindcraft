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

## Answers (laya-go side, 2026-11-11 14:30 AEST)

1. **"stop" and chores.** Keep "stop" as stop-what-you're-doing plus the 5-minute hold (or until the next command).
   "take a break" (`chores_off`) is the long off switch and the command model v2.2 learns it as its own command, so
   "stop" shouldn't become it. Whether 5 minutes is the right length is a user decision; laya-go has no stake in it.
2. **Director on prompt v1.** Agreed. `director-v12-best` is trained (v1.2 check: 6 wrong of 2,000, 0 harmful;
   v1.1 cases: 8 wrong, 0 harmful, against director-best's 16) and is in laya-go `data/laya-go/`, mapped in
   `serve-best.sh` (director → director-v12) but **not served**: the lead switches serving. Flip
   `decision_models.tasks.director.prompt` to `v1.2` in the same step. Note the old model reads the v1.2 text badly
   (42.6% right), so the prompt switch and the model switch must go together.
3. **Defend while following.** Yes, that's the line. The v1.2 rules decide `defend` from the Player line whatever the
   job is, so interrupting follow/come to defend matches training; eat/heal/unload staying out of non-Laya actions is
   a Mindcraft policy the model doesn't see, so it's fine.
4. **Chore job kind.** Agreed: report what the chore does (`Job gather log`, `Job mine cobblestone`, `Job stay none`).
   The director v1.2 generator has exactly those kinds, so no retraining is needed. A `chore` kind would be v1.3.
5. **Can place / smelt yes.** Covered: the chores training blocks are about a quarter each of no/no, no/yes, yes/no
   and yes/yes (seed 103 block: 17,671 / 10,667 / 14,749 / 16,913 of 60,000). chores-spec.md now says Mindcraft
   reports yes, masked again by the `can_place`/`can_smelt` settings.
6. **Home chest from the last look.** Fine. The spec only promises what andy knows; a stale count makes him gather or
   stock a little too much or too little, never anything harmful. Opening the chest on `unload` and `stock_kit`
   refreshes it often enough.
