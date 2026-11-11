# Laya roadmap for andy

What we've agreed to build next, after the current test round. Each numbered item becomes its own OpenSpec change (in Mindcraft and, for models, in laya-go) when we start it. Agreed with the user on 2026-11-10 (Brisbane).

## Standing rules

- Never throw away anything andy has gathered or mined (cobblestone may be needed for building later). Everything goes to a chest.
- Models stay small and CPU-servable (single-digit MB, `golaya serve`); training data stays on the Studio.
- Every new or changed model must beat the model it replaces on its held-out test before it is served, and is then checked in game on the test world (`docs/test-world.md`) against the strict baseline (`npm run game-test:compare`).
- Helper jobs run as Claude agents in titled Herdr tabs.

## 0. The aim: model-only control (user, 2026-11-10)

No decision logic outside the Laya models. The models say exactly what to do next, all the time; the bot code is only a framework: **sensors** (build each model's state text from the world), **actuators** (do one primitive or tool action and report done/failed) and a **job stack** (bookkeeping, no choices). No chat LLM.

Model layers:
- **command**: player chat → a job (and a templated reply). Unknown → "say that again" with examples.
- **director** (new): every event and ~1 s, health/food/mobs/light/pack/home/current job/stack top → the next activity: continue, defend, eat, heal, flee, unload, resume, idle (later chores). Replaces Mindcraft's modes (self-defence, cowardice, hunger, unstuck, item collecting, torch placing) and the hand-back to the LLM.
- **skill models** (follow, mine, farm, craft, defend, eat, later build): the next step of the activity.
- **chores** (later): what to do when idle.

Tools stay in code but the models choose when to use them: pathfinding, the mine plan's geometry, crafting recipes, blueprints. Code may compute facts and execute; it never chooses.

Phases (each gated by the strict suite and a live play):
1. **LLM off** (now): `llm: false` setting; command model only for chat; system messages never reach an LLM; job stack + one rule-based decision point (`nextActivity`, logged to `laya-director.jsonl`); command v2.1 training (phrasings, animals and drops). Gate: the suite with the LLM off scores at least as well as with it.
2. **Director model**: training data generated from the decision-point rules; served in place of the rules; Mindcraft modes switched off one by one.
3. **Rules into models**: every step logs whether the model or a rule decided it; the test report shows the **model share** per task. Retrain until rule steps are near zero; what remains are masks that only reject physically impossible actions, and their failures go back into the state.
4. **Chores, build, v3 models**: the bot code is sensors + actuators + the loop.
5. **Learning from play**: in-game outcomes (deaths, lost items, failed jobs, the user's feedback) become training data.

## Work queue (2026-11-10 evening; lead keeps working through it)

- [x] No LLM: `llm: false`, suite 16/16 without the LLM (fix round 2 + director v1.1 rules).
- [x] command v2.1 served (command2-v21-c1: 90.8% command, 72.5% unseen, 94.2% item); craft v2.1 served (733).
- [x] director-b served (99.2%), `tasks.director.enabled: true`; suite 16/16 with no LLM, director 100% model, ~97% model overall (2026-11-10 23:53). Next: live play.
- [x] mine v2.1 served (mine2-v21-c2, 56) and farm v2.1 (farm2-v21-c2, 225); c3 passes training on the mini.
- [x] command2-v21-c3 served (198: 93.5%, unseen 76.7%); craft2-v21-c3 (580); follow-mobs-n2 (1955). Lowest model share: mine-coal 20% (walk-first collect rule steps), farm 75%, follow 88%.
- [ ] Wiki phrasing bank: fix labels and count wording; full Category:Tutorials overnight when the GPU is free (Ollama shares it).
- [ ] Gap list → v3 command set (place, withdraw, harvest, smelt, build, search…) for the user to choose.
- [x] Model share: each test report shows, per task, how many steps the model decided versus rules (`tools/andy-tests/lib/share.js`; reports, .json rows and MCP results).
- [ ] Phase 2: switch off Mindcraft modes one by one as the director model covers them (inventory and order: `docs/laya-modes-to-models.md`).
- [ ] Weakest-first cycling overnight on the v2.1 confs (follow-mobs first).

## Now: the current test round

- [ ] mine v2 (`mine-p`: staircase + branch mine, Pack/Unload): served after the strict v1 baseline; in-game run and comparison.
- [ ] farm v2 (`farm-p`: crop, Pack/Unload, pond, find_water) and command v2 (`command-p`: `farm`, `home`): served when trained; in-game runs and comparison.
- [ ] Fix the stone pickaxe craft bug found by the baseline (`craft planks` reported failed although the planks were made; `act.craft` count check in `src/agent/library/skills.js`). **Change:** Mindcraft `fix-craft-planks`.
- [ ] Merge the test fixes (`baseline-fixes`) and restart weakest-first cycling (with mine, farm and command on their v2 configs).

## 1. Mine v3 (one retrain)

**Changes:** laya-go `mine-v3`, Mindcraft `laya-mine-v3`. The ore memory commands are in `laya-commands-v3`.

1. **Opportunist mining**: valuable non-target ores near the tunnel are visible to the model (a new cell kind) and collected when the pickaxe can mine them; diamonds and emeralds are worth a longer detour. Andy walks back onto the plan afterwards.
2. **Ore memory**: ores seen but not mined (wrong pickaxe, skipped) are saved with position and kind; "andy go get the diamonds you saw" goes there, crafting the needed pickaxe first. Collected ore is removed from memory.
3. **Tool choice**: the cheapest pickaxe that can mine the block by default; the fastest when hurrying or mining a lot; iron/diamond only when the ore needs it.
4. **Upgrade advice**: a model input that says an upgrade is due (e.g. 3+ iron and only a stone pickaxe, or remembered ore needing a better tier); andy upgrades before carrying on.
5. **Torch supply** (user, 2026-11-10): torch = 1 stick + 1 coal *or charcoal* → 4 torches. Before a mine job, top up to ~16 torches (take from the home/`andy mine` chest first). While mining, craft whenever torches < 4 and coal + sticks/planks are carried (not once per job, as today's `triedTorches` does), and always collect coal near the tunnel. With no coal, make charcoal: smelt logs in a furnace (8 cobblestone, which he always has), fuelled by planks/logs; about 3 logs give 8 torches. If he runs out deep down, keep mining (coal is common down to Y 0) and refill from the next coal; never leave the staircase unlit.

## 2. Farm v3 (one retrain)

**Changes:** laya-go `farm-v3`, Mindcraft `laya-farm-v3`. Lots, the shed and the composter are built through `laya-build`; auto farm upkeep is in `laya-build` (upkeep) and `laya-chores`. The open questions have defaults in both proposals, from the research: one combined crop field with alternating crop pairs per lot, and separate fields for cane, melons/pumpkins, trees and the ranch.

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

**Change:** Mindcraft `laya-purpose-chests`.

- A sign reading `andy <purpose>` on a chest gives it a purpose: `andy farm tools` (hoes, buckets, shears, torches, fence materials), `andy seeds` (seeds, saplings, bone meal), `andy produce`, `andy mine` (top of the staircase), `andy wood` (tree farm). A plain `andy` sign is the home chest.
- Unload to the nearest chest whose purpose fits, else the home chest; the model's Home distance becomes the distance to the nearest suitable chest.
- Before a job, take its tools and seeds from the job's chest before crafting new ones.
- A farm plan includes building its shed (chests + signs) by the gate.

## 4. Build (blueprint) model: new

**Changes:** laya-go `build-game`, Mindcraft `laya-build`. Build order, refined by the user on 2026-11-10 after the research: observers and comparators need nether quartz, so redstone farms wait for the Nether. The order is egg collector → cow crusher → cane and tree lots → observer farms → villager crop and iron farms (moving villagers is a later change).

- One model that builds any blueprint: follow the plan, fetch or craft the materials, place blocks in a safe order (water before hoppers, redstone last), check the result. Blueprints are data files, not models; adding a design needs no retraining. Auto farms are not a model of their own.
- Build order: fenced lots, sheds and composter → chicken egg/cooker farm, observer sugar cane farm → melon/pumpkin farm, cow breeder → iron farm (hardest: moving 3 villagers and a zombie into place) → houses → railways.
- Research: `docs/research/farming.md` section 6 (automatic and assisted farms, iron farm), sources from the user:
  - https://wbuilds.app/builds/farms/chicken-farm-java-b87
  - https://wbuilds.app/builds/farms/cow-farm-java-b88
  - https://wbuilds.app/builds/farms/style/animal-farm

## 5. Chores model and chores mode: new

**Changes:** laya-go `chores-game`, Mindcraft `laya-chores`.

- **Chores mode**: after ~30 s idle with nothing assigned, chores on and a home chest set, andy asks the chores model for the most useful job, does it, and asks again. Any instruction from a player interrupts it (like defending); it resumes when idle. At night or in danger, safe jobs near home or none.
- **Chores model** inputs: home and purpose chest stock (logs, food, seeds, cobblestone, iron…), each farm's state (ready to harvest, unlit, unfenced, below size, auto farm output stalled), time of day, health, food, danger. Output: the job (tend a farm, expand a farm, tree farm, lumber, compost, mine for a shortfall, empty auto farms, rest).

## 6. Supporting commands

**Changes:** laya-go `command-v3`, Mindcraft `laya-commands-v3`. `!layaChores` itself is in `laya-chores`.

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

**Changes:** laya-go `training-throughput` (faster training), Mindcraft `game-test-promotion` (the in-game promotion gate).

- Faster training: the Studio GPU sits at ~39% because batches are prepared on one CPU core per run. Bigger batches and multi-core batch preparation in laya-go (2–3× expected).
- In-game test results become part of promotion: a new model is served only if it also does at least as well as the current one on the strict suite.
