# Laya roadmap for andy

What we've agreed to build next, after the current test round. Each numbered item becomes its own OpenSpec change (in Mindcraft and, for models, in laya-go) when we start it. Agreed with the user on 2026-11-10 (Brisbane).

## Standing rules

- Never throw away anything andy has gathered or mined (cobblestone may be needed for building later). Everything goes to a chest.
- Models stay small and CPU-servable (single-digit MB, `golaya serve`); training data stays on the Studio.
- Every new or changed model must beat the model it replaces on its held-out test before it is served, and is then checked in game on the test world (`docs/test-world.md`) against the strict baseline (`npm run game-test:compare`).
- Helper jobs run as Claude agents in titled Herdr tabs.

## Now: the current test round

- [ ] mine v2 (`mine-p`: staircase + branch mine, Pack/Unload): served after the strict v1 baseline; in-game run and comparison.
- [ ] farm v2 (`farm-p`: crop, Pack/Unload, pond, find_water) and command v2 (`command-p`: `farm`, `home`): served when trained; in-game runs and comparison.
- [ ] Fix the stone pickaxe craft bug found by the baseline (`craft planks` reported failed although the planks were made; `act.craft` count check in `src/agent/library/skills.js`).
- [ ] Merge the test fixes (`baseline-fixes`) and restart weakest-first cycling (with mine, farm and command on their v2 configs).

## 1. Mine v3 (one retrain)

1. **Opportunist mining**: valuable non-target ores near the tunnel are visible to the model (a new cell kind) and collected when the pickaxe can mine them; diamonds and emeralds are worth a longer detour. Andy walks back onto the plan afterwards.
2. **Ore memory**: ores seen but not mined (wrong pickaxe, skipped) are saved with position and kind; "andy go get the diamonds you saw" goes there, crafting the needed pickaxe first. Collected ore is removed from memory.
3. **Tool choice**: the cheapest pickaxe that can mine the block by default; the fastest when hurrying or mining a lot; iron/diamond only when the ore needs it.
4. **Upgrade advice**: a model input that says an upgrade is due (e.g. 3+ iron and only a stone pickaxe, or remembered ore needing a better tier); andy upgrades before carrying on.

## 2. Farm v3 (one retrain)

Design from `docs/research/farming.md` (wiki-checked mechanics and layouts).

- **Farm plans**: each farm type ends up as 4 lots of its optimal size, 2×2 with 1-block paths, fenced with a gate. Drafts (to confirm from the research):
  - wheat, carrots, potatoes, beetroot: 9×9 lot, centre water, 80 plants; 4 lots ≈ 21×21 fenced; growth bonus from alternating crops/rows;
  - sugar cane: 9×9 with 3 water channels, 54 cane per lot;
  - melons and pumpkins: 9×9, alternating stem and fruit rows, ~36 stems per lot;
  - animal pens: ~8×8 per kind with a gate, beside the farm; breed when food is spare, cap numbers.
  - Open questions: crop order (wheat/carrots/potatoes/beetroot → sugar cane → melons/pumpkins?) and one field per crop or a combined field with a crop per lot.
- **Improve instead of waiting**, in priority order: harvest/replant → unload → light (torches on paths and edges, never on farmland) → fence → expand the next lot (dig another pond when out of ground) → gather seeds from tall grass → bone meal → breed → wait.
- **Tree farm**: birch first (oak second), 9×9 lot with saplings every 3 blocks (9 trees), torches between, 4 lots (36 trees); cut the whole trunk, collect saplings and apples, replant. Before it exists: collect lumber and saplings from wild trees near home.
- **Composter** at the farm shed (7 wooden slabs): only surplus goes in (seeds beyond 16 of each, saplings beyond replanting, leaves, grass, spare crops when the produce chest is stocked); bone meal goes to the seeds chest and onto slow crops and saplings. A casual, low-priority job.
- **Auto farm upkeep** (once built, see 4): empty collection chests, feed and restock (e.g. seeds into dispensers), repair broken blocks, notice when a farm has stopped producing.

## 3. Storage: purpose chests

- A sign reading `andy <purpose>` on a chest gives it a purpose: `andy farm tools` (hoes, buckets, shears, torches, fence materials), `andy seeds` (seeds, saplings, bone meal), `andy produce`, `andy mine` (top of the staircase), `andy wood` (tree farm). A plain `andy` sign is the home chest.
- Unload to the nearest chest whose purpose fits, else the home chest; the model's Home distance becomes the distance to the nearest suitable chest.
- Before a job, take its tools and seeds from the job's chest before crafting new ones.
- A farm plan includes building its shed (chests + signs) by the gate.

## 4. Build (blueprint) model: new

- One model that builds any blueprint: follow the plan, fetch or craft the materials, place blocks in a safe order (water before hoppers, redstone last), check the result. Blueprints are data files, not models; adding a design needs no retraining. Auto farms are not a model of their own.
- Build order: fenced lots, sheds and composter → chicken egg/cooker farm, observer sugar cane farm → melon/pumpkin farm, cow breeder → iron farm (hardest: moving 3 villagers and a zombie into place) → houses → railways.
- Research: `docs/research/farming.md` section 6 (automatic and assisted farms, iron farm), sources from the user:
  - https://wbuilds.app/builds/farms/chicken-farm-java-b87
  - https://wbuilds.app/builds/farms/cow-farm-java-b88
  - https://wbuilds.app/builds/farms/style/animal-farm

## 5. Chores model and chores mode: new

- **Chores mode**: after ~30 s idle with nothing assigned, chores on and a home chest set, andy asks the chores model for the most useful job, does it, and asks again. Any instruction from a player interrupts it (like defending); it resumes when idle. At night or in danger, safe jobs near home or none.
- **Chores model** inputs: home and purpose chest stock (logs, food, seeds, cobblestone, iron…), each farm's state (ready to harvest, unlit, unfenced, below size, auto farm output stalled), time of day, health, food, danger. Output: the job (tend a farm, expand a farm, tree farm, lumber, compost, mine for a shortfall, empty auto farms, rest).

## 6. Supporting commands

New `!commands` in Mindcraft, and new intents in the next command-model retrain (with varied phrasings):

| Purpose | Command | Chat |
|---|---|---|
| Chores on/off | `!layaChores(on/off)` | "andy do your chores", "andy take a break" |
| Mark a site | `!setSite("farm")`, `!setSite("trees")` … | "andy put the farm here", "andy plant your trees here" |
| Build | `!layaBuild("wheat_farm")`, `!layaBuild("chicken_farm")` … | "andy build a wheat farm here", "andy build a chicken farm" |
| Wood | `!layaTrees(count?)` | "andy go get wood", "andy plant trees" |
| Ore memory | `!listOres`, `!goToOre("diamond")` | "andy go get the diamonds you saw" |
| Stock | `!stock` | "andy what have we got?", "andy how much iron?" |
| Mining, open-ended | `!layaMine(ore)` | "andy go mine iron" (count optional) |
| Farming | `!layaFarm(crop, count?)` | "andy farm wheat 10" |
| Home chest | `!setHomeChest` | "andy this is your chest" (done in command v2) |

Site memory works like `home_chest`: one remembered place per site name.

## 7. Training infrastructure

- Faster training: the Studio GPU sits at ~39% because batches are prepared on one CPU core per run. Bigger batches and multi-core batch preparation in laya-go (2–3× expected).
- In-game test results become part of promotion: a new model is served only if it also does at least as well as the current one on the strict suite.
