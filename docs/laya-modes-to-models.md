# Mindcraft modes → Laya models (phase 2 prep)

2026-11-10, Brisbane. Phase 2 of the roadmap: switch off the Mindcraft modes (`src/agent/modes.js`) one by one as the
director model (`src/agent/laya/director.js`, spec v1.1) and the skill models cover them. **Nothing is switched off
yet.** This lists every mode that still makes a decision by itself, which director answer or skill model covers it
and what's missing before it can go.

Modes run every 300 ms in list order; the first one that starts an action wins. "Interrupts all" means it can stop a
running Laya job. When it does, the job is paused on the director's stack and resumed afterwards. Andy's profile
(`andy.json` on the `assistant` base profile) has `cowardice`, `hunting` and `cheat` off and the rest on. The two
`laya_*` modes run when their task is enabled.

## Summary

| Mode | On | Decides | Covered by | Missing | Switch off |
|---|---|---|---|---|---|
| self_preservation | yes | escape water, fire, lava, falling sand; run at low health | director `flee` (rules 1–2), `Danger` line | a flee executor (water bucket, find water, move away), drowning ↔ swim up, falling blocks in `Danger` | after a flee executor |
| unstuck | yes | move away after 20 s without progress | no answer; pauses the job like a safety mode | a "blocked" signal: jobs report `blocked` (Last), director answers `resume`/`idle`; or a per-skill stuck rule | after Last=blocked is reported by the move skills |
| laya_defending | yes (defend task) | fight, flee, hold off mobs | the defend model | nothing for the fight itself; the trigger should become director `defend`/`flee` | keep: it *is* the model; move its trigger to the director |
| cowardice | no | run from hostiles within 16 | director `flee`; defend model's flee | — (already off, and defers to laya_defending) | now (already off) |
| self_defense | yes | attack hostiles within 8 | director `defend` + defend model | only the fallback when the defend task is off or unsure (`fallback_ms`) | when defend is always on: make it the defend model's fallback only |
| laya_eating | yes (eat task) | when and what to eat | the eat model; director `eat`/`heal` | the eat state's `Danger` should use the director's hostile count (live play 11d) | keep: it *is* the model; move its trigger to the director |
| hunting | no | attack huntable animals within 8 when idle | `!hunt` (command v2.1 gather of a drop) | — (off; hunting is now a job) | now (already off) |
| item_collecting | yes | pick up items within 8 when idle | nothing (the mine/farm loops pick up their own drops) | a director answer or rule "collect drops" (`pickup`), or fold it into `idle` with a rule | after a `pickup` answer, or keep as a non-decision chore |
| torch_placing | yes | place a torch when dark, idle, none near | the mine model's `torch` (only while mining) | lighting when idle (base, farm paths): farm v3 "light" step or a director `light` answer | after farm v3 light / director answer |
| elbow_room | yes | step away from a player closer than 0.5 | nothing | none needed as a decision: it's a collision nudge | keep (mechanical, not a decision) |
| idle_staring | yes | look at entities / around when idle | nothing | none: animation only | keep (cosmetic) |
| cheat | no | instant place / teleport | — | — | stays off |

Outside `modes.js` there are other decisions too:
- **mineflayer-auto-eat** eats at food ≤ 14 unless the Laya eat task disables it (it does while on).
- **`npc/controller.js`** sets goals with the LLM; it's off with `llm: false`.
- **The director's executor** (`agent.js _perform`) eats, heals and unloads.

## Per mode

### self_preservation (interrupts all)
- **Decides:**
  - jumps when its head is in water (with no path goal);
  - moves 2 away from falling sand or gravel above;
  - on fire or in lava, places a water bucket, goes to water within 20, or moves 5 away;
  - at health < 5 right after damage (when laya_defending isn't in control), moves 20 away.
- **Director:** `Danger fluid|fire|drowning → flee` (rule 1) and `flee-hostile` at low health (rule 2) cover the
  decision. The state's `Danger` has no falling-blocks case, and `drowning` only fires below 10 air.
- **Missing:**
  1. a `flee` executor in `agent.js _perform`: water bucket on fire, nearest water, move away from lava or the
     mob, swim up when drowning;
  2. falling blocks: add to `Danger` (spec change) or keep a tiny mechanical rule.
- **Then:** turn it off, keeping the swim-jump (mechanical) in the flee executor or as a non-decision helper.

### unstuck (interrupts all; paused by the mine, follow and coder skills)
- **Decides:** after 20 s within 2 blocks while busy (40 s on obsidian), moves 5 away. It crash-kills the agent if
  that fails within 10 s.
- **Director:** no answer for it. It pauses the job like a safety mode (`SAFETY_MODES`), and the director answers
  `resume` afterwards.
- **Missing:** the skills should end with `Last blocked` when they can't progress (pathfinder timeouts, the mine's
  walk-back failures already restart the plan). The director then answers `resume`/`idle` (rule 9). The kill timer
  should go.
- **Then:** off for Laya jobs (they already pause it). Keep it for the remaining non-Laya actions until those report
  `blocked`.

### laya_defending (interrupts all; the defend model)
- **Decides:** whether to engage (`wantsToEngage`), then fight, flee, back off or ignore, each step by the defend
  model.
- **Director:** `defend` (rule 3) and `flee` (rules 2, v1.1). Today the director only labels what the mode does.
- **Missing:** the trigger. The mode should start when the director answers `defend`/`flee`, not on its own
  `wantsToEngage`. The defend model keeps choosing the moves.
- **Then:** keep the mode as the executor; replace its trigger with the director's answer.

### cowardice (off in andy's profile; interrupts all)
- **Decides:** runs 24 away from any hostile within 16 with a clear path. It already defers to laya_defending.
- **Covered:** director `flee`, defend model `flee`. **Switch off:** already off; remove from the profile list later.

### self_defense (on; interrupts all)
- **Decides:** attacks hostiles within 8 with a clear path. It defers to laya_defending when the defend task is in
  control.
- **Covered:** director `defend` plus the defend model.
- **Missing:** it is still the fallback while the defend model falls back (`fallback_ms` 8 s) or the task is off.
- **Then:** when defend is always on, call it only as the defend model's fallback (not as a mode).

### laya_eating (on; doesn't interrupt; the eat model)
- **Decides:** when and what to eat, every `check_ms`.
- **Director:** `eat` (rules 5, 10) and `heal` (rule 4, eats to 18). Both the director's executor and this mode
  can eat.
- **Missing:**
  - one trigger: the director's `eat`/`heal` should call the eat model for *what* to eat;
  - the eat state's `Danger` should use the director's hostile count (live play 11d).
- **Then:** keep the eat model; drop the mode's own timer once the director triggers it.

### hunting (off; interrupts followPlayer)
- **Decides:** attacks huntable animals within 8 when idle.
- **Covered:** `!hunt` (command v2.1: gather beef → hunt cows until the count). **Switch off:** already off.

### item_collecting (on; interrupts followPlayer)
- **Decides:** picks up items within 8 after 2 s, when idle and with 2+ free slots.
- **Covered:** nothing in the director. The mine (`pickUpDrop`) and the hunt pick up their own drops.
- **Missing:** a director answer (e.g. `pickup`, spec v1.2: "Items near N") or a rule under `idle`. Until then it's
  useful: it picks up what players throw to andy and the drops after a fight.
- **Then:** after the director has `pickup`.

### torch_placing (on; interrupts followPlayer; paused by the mine)
- **Decides:** places a torch at its feet when it's dark and there's none near, idle, every 5 s at most.
- **Covered:** the mine model's `torch` step, while mining only.
- **Missing:** lighting outside the mine: farm v3's "light" step, or a director `light` answer with `Light`
  already in the state.
- **Then:** after farm v3 or a director answer.

### elbow_room (on; interrupts followPlayer)
- **Decides:** steps away when a player is closer than 0.5 blocks. **Keep:** a physical nudge, not a choice.

### idle_staring (on; never interrupts)
- **Decides:** where to look when idle. **Keep:** cosmetic.

### cheat (off)
- Not a decision. It stays off.

## Suggested order

1. **cowardice and hunting:** already off. Delete them from the profile when convenient.
2. **laya_defending trigger → director `defend`/`flee`.** self_defense then becomes the defend model's fallback only.
3. **A director `flee` executor.** Then self_preservation goes, keeping the swim-jump as a helper.
4. **laya_eating trigger → director `eat`/`heal`.** auto-eat stays as the fallback when the eat task is off.
5. **unstuck:** off for every Laya job once the skills report `Last blocked`.
6. **item_collecting and torch_placing:** after the director spec gets `pickup` (and `light`), or farm v3.
7. **elbow_room and idle_staring** stay: they aren't decisions.

Each step is one switch in the profile's `modes` (or the mode's code). Check it with a suite run, the director log
(`laya-director.jsonl`) and the report's model share per task.
