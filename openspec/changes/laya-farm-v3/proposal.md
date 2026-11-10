# Proposal

## Why

Roadmap item 2 (`docs/laya-roadmap.md`, agreed 2026-11-10). Andy should farm planned fields and keep improving them instead of waiting:
- lots, a tree farm, pens;
- a composter for surplus;
- a shed of purpose chests.

The research note (`docs/research/farming.md`) gives the layouts, the idle-farmer priorities (§4.1) and the lot-level inputs (§4.2). laya-go's `farm-v3` adds farm prompt v3 with Field, Lot, Pen and Stock lines, a `Lot` question and new actions.

## What Changes

- **The farm map** (`farm_map.js`, pure; memory `farms`): per field its kind, origin, front, lots built, and per lot its planting, last harvest time, and the breed times per pen (cooldowns aren't visible, research §4.2). It keeps the faults found on the last walk-round.
- **Field geometry** (`farm_plan.js`, pure) from research §2.1: four 9×9 lots, 2×2, with a 1-block path cross and a ring inside the fence. That is 21×21 inside and 23×23 outside, with the gate in the middle of the front side and 9 torches on fence posts.
- **Lot templates** for each field kind:
  - **`crops`:** alternating crop rows, 80 plants, centre water under a slab.
  - **`cane`:** three slab-covered channels, 54 cane.
  - **`melons`:** alternating melon and pumpkin stem rows, `f m m f W f m m f`, 36 stems; paths not fruit support.
  - **`trees`:** birch saplings 1 block down at 1/4/7, 9 per lot, ground torches between.
  - **`ranch`:** a 7×7 pen per lot, gate on the inner path.

  The lots themselves are built through `laya-build`, as stages of the field blueprints (`crop_field`, `cane_field`, `melon_field`, `tree_farm`, `ranch`).
- **The field site** is the remembered site for the kind (`site_farm`, `site_trees`, `site_ranch`, …, set by `!setSite`, see `laya-commands-v3`). Without one, a new field is placed next to the home chest on the flattest 23×23 ground within 32 blocks. If there is none, andy says so and farms freeform, as v2.
- **Farm prompt v3** (`farm_state.js`):
  - Time, Field, Lot, Pen and Stock lines from the farm map, a walk-round scan and the purpose chests' contents;
  - the new cells;
  - questions with `Lot` and the `lot` item;
  - a port of laya-go's v3 rules for unsure answers;
  - golden fixtures byte for byte.
- **New actions** (`farm_actions.js`):
  - `mend`: close a gate, place a missing fence, cover water with a slab, re-till trampled dirt, torch a dark path or post (never farmland);
  - `cull`, `shear`, `eggs`;
  - `fell`: cut the whole birch trunk (pillaring 1 block if the top log is out of reach), collect saplings and apples, replant 1 down;
  - `compost`: surplus only, never breeding food (wheat or carrots needed for breeding);
  - `expand`: `!layaBuild(<field>, <next lot stage>)`;
  - `seeds`: break grass for seeds.
  - When the Lot isn't the one andy stands in, he walks there first. Before opening a pen gate he puts the breeding food away, and he closes every gate behind him (research §3).
- **Composter use:** the shed's composter (`laya-build` `composter`/`shed`). Bone meal goes to the `andy seeds` chest and is used mostly on saplings (research §1.5).
- **Tree farm before it exists:** `!layaTrees` (`laya-commands-v3`) cuts wild birch, then oak, near home and keeps the saplings for the tree farm's lots.
- **Settings** (`decision_models.tasks.farm`): `prompt: 'v3'`, `field_search_radius` (32), `walkround_minutes` (5), `reserves` (copied from laya-go's rule constants). `prompt: 'v2'` keeps the v2 loop.

## Open questions (with the defaults this change implements)

1. **Crop order.**
   - **Default:**
     1. the crop field (food, seeds and wheat for everything else);
     2. then (via the build queue) the egg collector and the cow crusher;
     3. then the cane and birch fields;
     4. then the melon/pumpkin field.
   - **Why:** this is research §6.9 combined with the user's build order.
   - **Changing it:** the chores model picks what to expand from stock shortfalls, so the order is a default, not a rule.
2. **One field per crop, or combined?**
   - **Default:** one combined crop field. Each lot has a pair: A wheat/carrots, B wheat/potatoes, C wheat/beetroot, D carrots/potatoes. Rows alternate, so all 80 plants keep the full growth rate.
   - **Separate fields** for cane, melons/pumpkins, trees and the ranch.
   - **Alternative:** one crop per lot with empty rows between, giving 44 plants. The lot's `planting` in the blueprint stage makes switching a data change.

## Capabilities

### Modified Capabilities
- `laya-farm`: farm map, field geometry and lot templates, prompt v3, the new actions, tree felling, the composter, field placement.

## Impact

- **New:** `src/agent/laya/{farm_map,farm_plan}.js`, `test/laya_farm_plan.test.js`, `test/laya_farm_map.test.js`, `test/fixtures/laya-farm-v3/`.
- **Changed:** `farm_state.js`, `farm.js`, `farm_actions.js`, `library/skills.js` (fell, pillar), `settings.js`, `src/models/laya_check.js`, `docs/laya-farm.md`.
- **New in-game scenarios:**
  - `farm-field-place`: on the farm site, andy lays out stage 0 and lot A;
  - `farm-mend-gate`: an open gate is closed before harvesting;
  - `farm-harvest-lot`: a lot set 90% ripe with `/fill`; andy harvests and replants with alternating rows;
  - `farm-expand`: idle with 2 lots; andy builds lot C;
  - `farm-fell-birch`: a grown birch in a tree lot; logs and saplings are collected and replanted;
  - `farm-compost`: 40 wheat seeds carried; the surplus goes in, bone meal goes to the seeds chest;
  - `farm-ranch-breed`: 2 cows in a pen and wheat above the reserve; andy breeds them and closes the gate.
- **Depends on:**
  - laya-go `farm-v3` (prompt v3 and a model);
  - `laya-build` (lot stages, shed, composter);
  - `laya-purpose-chests` (Stock line, shed chests).

  It reads `site_*` places when `laya-commands-v3` has set them.
- **Shipping:** until a v3 model is promoted, `prompt: 'v2'` keeps today's behaviour, and the v3 loop runs on the rule port for testing.
