# Design

## Blueprint file format (`blueprints/<name>.json`, version 1)

```json
{
  "format": 1,
  "name": "egg_collector",
  "title": "Egg collector",
  "site": "ranch",
  "front": "S",
  "size": [3, 4, 3],
  "palette": {
    "#": "cobblestone",
    "g": "glass",
    "h": "hopper[facing=south]",
    "c": "chest[facing=north]",
    ".": "air",
    " ": "any"
  },
  "layers": [
    ["###", "#c#", "###"],
    ["ggg", "ghg", "ggg"],
    ["g.g", "...", "g.g"],
    ["   ", "   ", "   "]
  ],
  "stages": [{ "name": "all", "layers": [0, 3] }],
  "chests": [{ "at": [1, 0, 1], "purpose": "produce", "sign": "andy eggs" }],
  "needs": [{ "mob": "chicken", "count": 4, "into": [1, 2, 1], "lure": "wheat_seeds" }],
  "upkeep": [
    { "job": "empty", "chest": [1, 0, 1] },
    { "job": "stalled", "chest": [1, 0, 1], "item": "egg" }
  ]
}
```

**Grid:**
- Layers run bottom to top, rows north to south and characters west to east, in the blueprint's own frame with `front` as written.
- At build time the frame is rotated so `front` faces the bot's heading. Block states with `facing`, `axis` or `rotation` are rotated with it.
- `" "` (any) leaves a cell alone; `"."` must be air (it is cleared).

**Stages:** inclusive layer ranges, or explicit `parts`: a sub-blueprint at an offset, for example the crop field's lots:

```json
"stages": [
  { "name": "fence", "parts": [{ "blueprint": "field_fence", "at": [0, 0, 0] }] },
  { "name": "lot A", "parts": [{ "blueprint": "crop_lot", "at": [2, 0, 2], "planting": "wheat/carrots" }] }
]
```

The `planting` is passed to `laya-farm-v3`'s lot template.

**`upkeep` jobs:**
- `empty` (a chest into purpose chests);
- `restock` (`at`, `item`, `min`);
- `feed` (`mob`, `item`, `every_min`);
- `repair` (implicit: every built cell);
- `stalled` (a chest and item whose count must grow within `stall_minutes`).

**Validation** (`blueprints.js`) checks:
- every row has the size's width and every layer its depth;
- every palette block exists in minecraft-data 1.21.6;
- every block has a build class;
- stage ranges are inside the layers;
- chests and `needs.into` cells are inside the size.

## Block classes (shared with laya-go `build-game`)

| Class | Blocks (by pattern, then exceptions) |
|---|---|
| `fluid` | water, lava (source) |
| `gravity` | sand, red_sand, gravel, `*_concrete_powder` |
| `attached` | torch, wall_torch, `*_sign`, `*_button`, ladder, rail family, `*_carpet`, lever |
| `container` | chest, barrel, hopper, dispenser, dropper, composter, furnace |
| `redstone` | redstone_wire, repeater, comparator, piston, sticky_piston, observer, daylight_detector, redstone_torch |
| `plant` | `*_sapling`, sugar_cane, wheat, carrots, potatoes, beetroots, melon_stem, pumpkin_stem |
| `solid` | everything else |
| `air` | air (to clear) |

The table lives in `blueprints.js`. laya-go keeps a mirror for its testdata walk check, and a test there fails on any block it can't classify.

## Candidate cells for the build state

Each step:
1. Pending cells come from the lowest two unfinished layers of the current stage, plus every pending fluid and redstone cell of those layers. A cell is pending when its block doesn't match.
2. The 8 nearest are taken.
3. They are shuffled with a per-step seed.
4. For each, the bot writes its offset, class, support (a solid face to rest on, as the class needs), what is there now, the material status (`have` / `chest` / `craft` / `gather` / `none`) and `wrong`.

## Material bill and the quartz gate

- **The bill:** the palette counts times the cells, plus parts.
- **Expansion:** crafted parts are expanded through `craft_data` one level, to show raw needs: an observer is 6 cobblestone, 2 redstone and 1 quartz; a hopper is 5 iron and a chest.
- **Locked:** a blueprint is locked when its raw needs include `quartz` and no quartz is carried or stored.
- **Lacking materials:** a blueprint whose other needs are missing is queued, not refused.

## Check

After the last stage the bot walks the footprint and compares every non-`any` cell, including `facing`. Mismatches become `wrong` candidates and the loop runs again, up to 3 times. Then it reports the cells it can't fix.

## Upkeep and stalled

`builds` memory holds each built blueprint's origin, rotation, stage and, per `stalled` entry, the last count and time. The chores state reads `Full` (chest ≥ 90% full) and `Stalled` (count unchanged for `stall_minutes` while andy was within 128 blocks, so the chunks were ticking; research §1.3).
