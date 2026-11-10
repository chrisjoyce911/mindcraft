# Tasks

- [ ] 1. Shared pack helpers: `pack.js` (pack line, home distance, unload rule, deposit list, hostiles) and `pack_actions.js` (home chest lookup, deposit); tests.
- [ ] 2. Optional command parameters in `commands/index.js`; `!layaFarm(crop, count)` with the lone-number minutes form; `skills.farmWithLayaModel` goal.
- [ ] 3. `farm_state.js` v2: state with `Crop` and `Pack`, questions with `Unload` and the v2 actions, port of the v2 rules; golden v2 fixture from laya-go (`games/farm/prompt/testdata/v2_sample_request.json`).
- [ ] 4. `farm.js`: count goal (harvest deltas, deposited counted), wait limit with nothing growing, find water (walk there or say so and stop), unload at the home chest and walk back; tests with fakes incl. the trial's dry plateau.
- [ ] 5. `farm_actions.js`: `pond` (dig, pour, flood check), find water, bucket only from materials.
- [ ] 6. `command.js` / `command_state.js`: `farm` command (golden from laya-go `games/command/prompt/testdata`), open-ended mine and farm.
- [ ] 7. `settings.js` farm options, `laya_check.js` v2 farm sample, `docs/laya-farm.md`, `docs/laya-command.md`.
- [ ] 8. `npm test` passes.
- [ ] 9. In the game with a v2 farm model: dry plateau with and without water near, count goal, unload; record in `docs/laya-farm.md`.
