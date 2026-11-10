# Director: shared spec (Mindcraft decision point ↔ laya-go director model)

The director picks andy's next activity, on events (damage, mob seen, job done/failed, player command) and every
~1 s. Mindcraft builds the state text and executes the answer; the rule-based `nextActivity` in Mindcraft and the
laya-go dataset generator implement the SAME rules, so the model can replace the rules with no code change.

## State text (exact lines, in this order)
```
Director.
Job <none|follow|come|stay|mine|farm|craft|gather|give|attack|store|home> <item|none> left <n|any|0>
Paused <none|same kinds as Job>
Health <0-20> Food <0-20> Armed <none|sword|axe|other> Armor <0-20>
Hostiles <0-9> Nearest <none|zombie|skeleton|creeper|spider|other> <dist 0-16|none>
Light <0-15> Night <yes|no> Under <yes|no>
Pack <free slots 0-36> Home <dist|none> Valuables <count>
Food items <count of edible items>
Danger <none|fluid|fall|drowning|fire>
Last <none|done|failed|interrupted|blocked>
```
(`Under` = underground: no sky above. `Valuables` as in the mine Pack line. Distances capped at 16 / 99.)

## Question and answers
Question `Activity`: `continue` (keep doing the job), `defend`, `flee`, `eat`, `heal` (stop, eat to full, wait to
regenerate in a safe spot), `unload`, `resume` (pop the paused job), `idle`.

## Rules (priority order; the generator labels with these)
1. Danger fluid/fire/drowning → `flee`.
2. Hostiles, nearest ≤ 4, and (Health ≤ 6 or Armed none and Health ≤ 10) → `flee`; creeper nearest ≤ 3 → `flee`;
   Hostiles, nearest ≤ 8 and Health ≤ 6 → `flee` (v1.1).
3. Hostiles, nearest ≤ 8 (Health > 6) → `defend`.
4. Health ≤ 8, no hostiles within 8 → `heal` (eat if Food < 18 and food items > 0, then wait).
5. Food ≤ 6 and food items > 0 → `eat`. (Food < 18 and Health < 20 and nothing else to do → `eat`.)
6. Only when Job or Paused is not none (v1.1: never unload while idle): Pack ≤ 2 and Home not none → `unload`; Pack ≤ 6 and Home ≤ 24 → `unload`;
   Valuables ≥ 4 and (Health ≤ 8 or Hostiles ≥ 2 or Food ≤ 6) and Home not none → `unload`.
7. Job none and Paused not none → `resume`.
8. Job not none and Last not failed/blocked → `continue`.
9. Job failed/blocked (Last failed or blocked) and Paused not none → `resume`; else `idle`.
10. Otherwise `idle`.

Mindcraft pushes the current job onto Paused when it runs defend/flee/eat/heal/unload, and the director answers
`resume` once the safety activity ends (Job none). A player command replaces Job; "stop" clears Job and Paused.
Log each decision to `bots/<name>/logs/laya-director.jsonl` (time, state, answer, source rules|model, p).

## v1.1 (2026-11-10 19:20)
Flee within 8 at Health ≤ 6; rule 6 (unload) only with a job running or paused. The laya-go sample request
`games/director/prompt/testdata/v1_sample_request.json` is the golden format: Mindcraft has a unit test that builds the same state
and request byte for byte (Job none none left 0; Hostiles 0 Nearest none none; question "What should I do now?").
