# Proposal

## Why

Roadmap item 3 (`docs/laya-roadmap.md`, agreed 2026-11-10). Andy has one home chest (`home_chest`, from `!setHomeChest`, chat or a sign with his name). Everything goes there, and every job crafts its own tools. With farms, a mine and a tree farm, he should:
- unload where the things belong;
- take a job's tools and seeds from that job's chest before crafting new ones.

The research note (`docs/research/farming.md` §4.1) names the farm shed's chests: `andy produce`, `andy seeds`, `andy farm tools`.

## What Changes

- **Purpose signs:**
  - a sign reading `<bot name> <purpose>` (any case) on or touching a chest gives that chest a purpose;
  - a sign with only the bot's name keeps making the home chest, as now.
- **Purposes and what they take:**

  | Purpose | Sign | Takes |
  |---|---|---|
  | `farm tools` | `andy farm tools` | hoes, buckets, shears, torches, fences, fence gates, slabs |
  | `seeds` | `andy seeds` | seeds, saplings, bone meal |
  | `produce` | `andy produce` | crops, melon slices, pumpkins, cane, eggs, wool, leather, raw meat |
  | `mine` | `andy mine` | ores, raw metals, coal, gems, cobblestone, deepslate, stone, gravel, flint |
  | `wood` | `andy wood` | logs, planks, sticks, apples |
  | `build` | `andy build` | blocks and parts a queued blueprint needs |

  The table lives in `purpose_chests.js` (pure) and is tested item by item. An item that no purpose takes goes to the home chest.
- **The chest registry:**
  - purpose chests are found by scanning for signs within 48 blocks, at most every 30 s, and when a job starts;
  - they are kept in memory (`purpose_chests`: purpose → list of positions), so they survive restarts when memory is saved;
  - a chest that is gone, or whose sign changed, is dropped.
- **Unload by purpose:**
  - `pack_actions.deposit` splits the deposit list by purpose;
  - it walks to the **nearest** chest of each needed purpose, in a nearest-first route, and puts the rest in the home chest;
  - a full chest spills into its touching chests, then falls back to the home chest;
  - **nothing is ever thrown away:** with every chest full, andy keeps the items and says "My chests are full: I need another chest."
- **The pack line's Home** becomes the distance to the nearest chest that takes the most valuable item andy is carrying (the item kind he carries most of when nothing is valuable). The unload rule is unchanged.
- **Take before crafting:** before a job (farm, mine, trees, build), andy takes the job's kit from the matching chest: hoe and seeds for farming, pickaxe and torches for mining, axe and saplings for trees, the parts for a build. He crafts only what is still missing. The craft model's `take` step already exists; this adds the kit lists and which chest to open.
- **Farm shed:** the farm plan's shed (built by `laya-farm-v3` / `laya-build`) places its chests and signs. This change only reads them.

## Capabilities

### New Capabilities
- `laya-purpose-chests`: purpose signs, the registry, unload by purpose, Home distance, kits taken before a job.

### Modified Capabilities
- `laya-home-chest`: a plain name sign still makes the home chest. A name sign followed by a purpose makes a purpose chest instead.

## Impact

- **New:** `src/agent/laya/purpose_chests.js` (pure: sign parse, purpose table, routing, kits), `test/laya_purpose_chests.test.js`.
- **Changed:** `src/agent/laya/{pack,pack_actions,home_chest}.js`, `farm.js`, `mine.js`, `library/skills.js` (kits before jobs), `docs/laya-farm.md`, `docs/laya-mine.md`.
- **New in-game scenarios** (`test/game/scenarios.json`):
  - `purpose-unload`: a mine chest and a home chest; andy mines and unloads coal into the mine chest and dirt into the home chest;
  - `purpose-kit`: a hoe in the `andy farm tools` chest; `!layaFarm` takes it instead of crafting one;
  - `purpose-full`: every chest full; nothing is dropped.
- **Depends on:** `laya-farm-v2` (home chest, pack helpers) and `laya-mine-plan`, both merged.
