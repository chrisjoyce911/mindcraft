# Tasks

## 1. Review (user)
- [ ] 1.1 The user agrees the centre, areas, interrupts and the chore priority spec v1.

## 2. Mindcraft (after fix round 3 is merged)
- [ ] 2.1 Home choice (saved home → placed chest/table nearby → player → self; first placed chest/table becomes home), persisted; `chores_centre`; base/work area helpers; widening search per resource.
- [ ] 2.2 Chores sensor: state text (spec in laya-go `games/chores/prompt`), golden test.
- [ ] 2.3 `chore` job kind on the job stack; director `idle` → chores; interrupts and resume.
- [ ] 2.4 Director v1.2: player-attacked state line and `defend` target = attacker; golden test.
- [ ] 2.4b Player kit: sensor line for kit in the home chest; reserve it when taking from the chest.
- [ ] 2.4c Sensors: chest/table placed by a player; water in the work area; saplings on the ground in the base area.
- [ ] 2.5 `chores` setting, `!layaChores(on|off)`, command intents.
- [ ] 2.6 Game tests: idle start, interrupt by command, defend the player, no-trees widening, first day from scratch.

## 3. laya-go
- [ ] 3.1 `games/chores`: prompt, answers, priority rules v1, generator, check.
- [ ] 3.2 Director v1.2 data + retrain (also: low health + skeleton in range → flee, from live play).
- [ ] 3.3 Command v2.2: `chores_on`/`chores_off` plus the wiki phrasing bank.
- [ ] 3.4 Train chores on the Studio and mini GPUs; serve when it beats the rules on its check.
