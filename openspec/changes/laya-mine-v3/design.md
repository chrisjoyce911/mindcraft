# Design

## Ore memory record

```js
{ kind: 'diamond', x, y, z, tier: 'iron', seen: '2026-11-10T14:05:00+10:00', skipped: 0 }
```

- **Kinds:** laya-go's (`coal`, `copper`, `iron`, `lapis`, `gold`, `redstone`, `diamond`, `emerald`), with deepslate forms folded in.
- **Duplicates:** one record per block position; a re-sighting updates `seen`.
- **Pruning:** records more than 256 blocks from home are pruned first when the list is full.
- **Times:** stored with the Brisbane offset, as the test reports are.

## Where V/K and Near come from

The 5×5×5 view already reads every block. Valuable non-target ore blocks become `V` or `K` by `tools.canMine(tier, block)`. `Near` comes from one `bot.findBlocks` call per step: valuable ores within 16, matching 0–24 blocks, the view excluded. These hits are also recorded in ore memory.

## Upgrade sequence

```
Upgrade true ∧ ¬danger → runCraft(next tier pickaxe, 1)
  ok      → equip by tool choice → plan.next(feet) (walks back to the plan)
  failed  → say "I couldn't make a <tier> pickaxe: <reason>." once per job → continue
```

Upgrade is not asked again within the same job after a failure (no loop).

## Tool choice

```
canMine(tier, block)  → from craft_data PICKAXES and minecraft-data harvestTools
choose(block, carried, hurry):
  ok = carried.filter(p => canMine(p, block))
  hurry ? fastest(ok) : cheapest(ok)
```

- **Order:** cheapest is wooden < stone < iron < diamond < netherite (gold counts as wooden).
- **Without `hurry`,** iron and diamond pickaxes are kept for blocks that need them, so their durability lasts.
