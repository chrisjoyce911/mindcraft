# Fix round 4: bot code bugs from live play 3

## Why
Live play 3 (2026-11-11 evening AEST, `bots/andy/logs/game-tests/live-play3-2026-11-11.md`, bot log
`bot-2026-11-11_17-29-54.log` lines ~1340–1492) found code faults:

- **HIGH** "collect 4 coal" (layaGather) interrupted by `laya_defending` didn't return: "waiting for code to finish
  executing…" ×30 → ActionManager killed the process (exit 1) → restart; the job was lost.
- **HIGH** `laya_defending` stopped every job for a skeleton 12–14 blocks away in daytime shade that attacked
  nobody. The user's rule (2026-11-11): a mob attacking andy or a player is fought; a mob attacking nobody is
  ignored ("fighting it only gets him hurt").
- **HIGH** With 80 logs, 1 plank and 0 sticks, craft_sword and make_torches failed: the craft model said
  `take stick` / `done`, and the recipe fallback reached for the player kit's sword and torches in the home chest.
- **MED** `mode:unstuck` interrupted the rest chore ~25 times (standing still on purpose looks stuck).
- **MED** light_base: the sensor said `lit no`, the actuator "no dark spot open".

## What changes
Sensors, actuators and modes only; no code chooses an activity (decisions stay in the Laya models / shared rules).
- Every Laya job's work and every mode's work run stoppable (`src/agent/run_token.js`): they return within 100 ms of
  an interrupt even when a skill under them doesn't; the given-up work is cancelled (skills check `stopped(bot)`),
  so nothing goes on in the background after the interrupt clears. runChore uses the same runner.
- A player's Laya job (layaGather, layaCraft, layaMine, layaFarm, hunt) is kept in `bots/<name>/laya-job.json`
  while on the stack, with its progress (target, done, harvested). After a restart a fresh one (≤ 15 min) goes back
  on the stack paused, so the director resumes it (rule resume-paused); andy says so, or that it was lost.
- Attack sensor (`laya/attacks.js`): a mob that hurt andy or a player (entityHurt with its damage source; with no
  source, the nearest hostile within 4 of the victim) is an attacker for 15 s; a creeper fusing within 5 of andy or
  a player is one too. `laya_defending` sees only attackers (its state's Mobs), `self_defense` and `cowardice` act
  only on attackers.
- Director shared spec **v1.3** mirrored from laya-go (tab "rules2", `games/director`): the Me line
  `Me attacked yes|no by <kind> <dist>` (a mob that hurt the bot in the last 5 s, still alive), `defend` only when
  the bot is attacked, flee-low also on an attack at Health ≤ 6, heal doesn't wait for hostiles within 8. A served
  model on an older prompt (v1, v1.2) gets its own text; where v1.3's rules answer otherwise than v1.2's, the rules'
  answer stands. A `defend` with neither the bot nor a player attacked is the rules' answer (`nothing-to-defend`).
- Craft: the chest as the craft task reads it leaves out the player kit in the home chest (a kit item is "not in
  chest"); `craftForTask`, when the model path fails, runs the recipe rules alone (`runCraft` with no client), which
  craft planks and sticks from logs first.
- `unstuck` is paused while andy stands still on purpose (the rest chore, the director's eat and heal).
- light_base: one dark-spot test (`darkSpot`) for the sensor and the actuator; the actuator reads the dark spots
  fresh, says `the base is lit` when none is left, and waits for the light update after placing.

- Chores shared spec **v1.1** mirrored from laya-go (`games/chores`, `0cbe811`): Animals as searches
  (49/97/193/none, the sensor finds the smallest search per kind), hunt when food is low out to 193, Failed lists a
  chore only while its latest failure is under 5 minutes old (never rest or a need), five need answers
  (`need_wood/cobble/coal/wool/food`): andy says "I need <item>" once per item per 5 minutes, then stays like rest.

## Keep
The craft model's training data (chain planks/sticks) is laya-go's. The chores task's `prompt` setting stays `v1`
while the chores model is off (rules decide); a served chores model must be v1.1.
