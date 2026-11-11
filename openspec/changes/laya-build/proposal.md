# Proposal

## Why

Roadmap item 4 (`docs/laya-roadmap.md`, agreed 2026-11-10): andy should build from blueprints:
- the farm's fenced lots, shed and composter;
- then automatic farms, houses and railways.

Every blueprint goes through one build model (laya-go `build-game`). Blueprints are data files, so a new design needs no retraining. The research note (`docs/research/farming.md` §6) fixes what the first auto farms are, and what blocks them.

**The quartz gate:** observers and comparators need nether quartz. So the redstone farms wait until andy can reach the Nether, or a player gives him quartz.

**The build order** (the user's, 2026-11-10, refining the roadmap's):
1. egg collector;
2. cow crusher;
3. cane and tree lots;
4. observer farms;
5. villager crop and iron farms.

## What Changes

- **Blueprint files:** `blueprints/<name>.json` (format in design.md):
  - **The layout:** a palette, layers bottom to top, a front direction, chest and sign placements, and stages (so a field is built a lot at a time).
  - **Requirements:** what the build needs (materials, items, mobs to bring in).
  - **Upkeep:** jobs such as emptying chests, restocking dispensers, feeding through the fence, and how to tell the farm has stalled.

  `blueprints.js` loads and validates them. Errors name the file and the cell. It also maps every block to the build model's classes, and derives the material bill.
- **`!layaBuild(name, stage?)`:**
  - **Placement:** builds at the bot's position, or at the site set by `!setSite` for the blueprint's `site` (`laya-commands-v3`), with the front facing the way the bot faces.
  - **Before building:**
    1. the bot clears and levels the footprint (never destroying what it collects);
    2. it checks the material bill against the pack and the purpose chests (`laya-purpose-chests`);
    3. it says what is missing, then fetches, crafts (craft loop) or gathers it.
- **The build loop** (`build.js`), at each step:
  1. choose the candidate cells (design.md) and write the build state;
  2. ask the build model;
  3. when the model is unsure, use the ported answer key;
  4. place, clear, fetch, craft, gather or fix;
  5. at the end, check every cell against the blueprint and fix mismatches.

  Danger (lava beside the bot, water above, sand overhead) makes the bot step aside first.
- **Oriented placement** (`place_oriented.js`): hoppers, pistons, observers, dispensers and stairs face the blueprint's direction. The bot looks the right way and places against the right face, then reads the placed block's `facing` and redoes it if wrong (research §6).
- **Material gate:** a blueprint whose bill includes nether quartz (observer, comparator, daylight detector) is **locked** while no quartz is carried or stored. `!layaBuild` then replies "I need N nether quartz for this (observers/comparators); I can't get to the Nether yet." Iron-heavy bills are allowed, but say how much iron is missing.
- **Build queue** (memory `build_queue`): `!layaBuild` with materials missing queues the build. The chores model (`laya-chores`) picks queued builds when their materials are ready (the chores state's `Want` line).
- **Upkeep routine** (`upkeep.js`): for a built blueprint (memory `builds`: name, origin, front, stage, built time):
  - empty its output chests by purpose;
  - restock its dispensers or hoppers to the stated minimum;
  - feed through the fence at the stated interval;
  - repair cells that no longer match;
  - flag it **stalled** when the output chest's count hasn't grown for `stall_minutes`.

  This is the roadmap's "auto farm upkeep". The chores model decides when.
- **First blueprints**, in the agreed order:
  1. `crop_field`: the fenced 2×2 field of 9×9 lots with path cross and ring, gate, 9 torches on posts, covered centre water. Stage 0 is fence, paths and torches; stages 1–4 are lots A–D (research §2.1–2.2).
  2. `shed`: 3 chests with signs `andy farm tools`, `andy seeds`, `andy produce`, and the composter, roofed, by the gate.
  3. `composter`: 7 wooden slabs, crafted, placed in the shed.
  4. `egg_collector` (§6.1): chickens over a hopper into a chest; 5 iron, no redstone.
  5. `cow_crusher` (§6.3): a 2-deep hole with water, hopper, chest and fence; needs 2 cows led in with wheat; feeding upkeep every 5 min.
  6. `cane_field`, `tree_farm` and `melon_field`: lot templates (§2.3–2.5). `ranch` (§3): 7×7 pens.
- **Later blueprints** (data only, locked by the quartz gate): `cane_observer`, `chicken_cooker`. The villager crop farm and iron farm (§6.7–6.8) need villagers and a zombie moved into place. That is a separate later change; this one leaves their names reserved.

## Capabilities

### New Capabilities
- `laya-build`:
  - blueprint files and validation;
  - `!layaBuild`, the build loop and its check;
  - oriented placement;
  - the quartz/material gate and the build queue;
  - upkeep;
  - the first blueprints.

## Impact

- **New:**
  - `blueprints/*.json`;
  - `src/agent/laya/{blueprints,build_state,build,place_oriented,upkeep}.js`;
  - `test/laya_blueprints.test.js`, `test/laya_build*.test.js`;
  - `test/fixtures/laya-build/` (laya-go golden);
  - `docs/laya-build.md`.
- **Changed:**
  - `commands/actions.js` (`!layaBuild`);
  - `library/skills.js` (oriented place, level footprint);
  - `settings.js` (`decision_models.tasks.build`: model `build-a`, `min_confidence`, `stall_minutes` 30, `log_steps`);
  - `src/models/laya_check.js`.
- **New in-game scenarios:**
  - `build-composter`;
  - `build-shed` (signs register as purpose chests);
  - `build-crop-field-stage0` (fence, gate, paths, torches; check passes);
  - `build-egg-collector` (hopper facing the chest; an egg from a summoned chicken reaches the chest);
  - `build-locked-observer` (the quartz reply);
  - `upkeep-empty` (a full egg collector chest is emptied into `andy produce`).
- **Depends on:**
  - laya-go `build-game` (the model; the answer key port works without it);
  - `laya-purpose-chests`.

  The laya-go side copies the first blueprints into its testdata for the walk check.
