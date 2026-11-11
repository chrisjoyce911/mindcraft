# Design

## Field geometry (research §2.1)

The field's own frame: x east, z south, the front (gate side) south, and the origin at the fence's north-west corner.

```
outside 23×23: fence ring at x,z ∈ {0, 22}; gate at (11, 22)
path ring:     x,z ∈ {1, 21} inside the fence
path cross:    x = 11 or z = 11
lots (9×9):    A x 2..10 z 2..10    B x 12..20 z 2..10
               C x 2..10 z 12..20   D x 12..20 z 12..20
torches:       on fence posts at the 4 corners, the 4 cross ends and (11, 11) on a post
```

**Placement:** rotated so the gate faces the site's chosen front. The shed (`laya-build` `shed`) sits outside the gate, centred on it.

**Reach:** every lot cell is at most 4 blocks from a path (research §2.1), so andy stays on paths. Farm actions refuse targets that would need him to stand on farmland.

## Lot templates (lot frame 0..8)

| Kind | Cells |
|---|---|
| crops a/b | rows z even → a, z odd → b; (4, 4) water under a bottom slab |
| cane | x ∈ {1, 4, 7} water, slab on top; cane on the other columns |
| melon/pumpkin | per row `f m m f W f m m f` (x 4 water, slab-covered); m rows alternate melon and pumpkin by z |
| birch | saplings at (1,1) (1,4) (1,7) (4,1) … (7,7), 1 block down; torches at (3,2) (6,2) (3,5) (6,5) … on the ground |
| pen | the lot's outer ring is fence; gate on the side facing the cross path |

`farm_plan.cropAt(field, lot, x, z)` answers the `lot` Item for plant.

## The walk-round

Every `walkround_minutes`, or after expand, andy walks the path ring once and records each lot's ripe, empty and dry counts, and the faults:
- the gate's `open` state;
- missing fence cells;
- uncovered water;
- block light 0 on paths and posts;
- dirt where the template wants farmland.

Between walk-rounds the counts are updated from his own actions. That keeps every request cheap: no scan per step.

## Stock line

The pack plus the last-read contents of the purpose chests (`laya-purpose-chests`). Chests are re-read when andy unloads or takes a kit.

## Fell

1. Break the trunk from the bottom.
2. If the top log is above reach, pillar one dirt block, break it, then remove the pillar (research §2.5).
3. Wait 20 s for leaves to decay, collecting saplings and apples within the lot.
4. Replant the sapling 1 down.

This is the research's §5.6 open point; the scenario measures it.
