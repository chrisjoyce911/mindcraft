# Farm research for andy's farm model

A design note for the next version of andy's Laya farm model (`docs/laya-farm.md`) and his farm plan. When andy has nothing else to do he improves his farms. Each farm type ends up as **4 lots of its best size, laid out 2×2 with 1-block paths, fenced, with a gate**.

**Scope:** Java Edition. The server runs **1.21.6** (`settings.js` `minecraft_version`). minecraft.wiki now documents Java 26.x, so facts that changed after 1.21 are flagged. Bedrock-only behaviour is marked **(Bedrock)** and never used for the plan.

**Sources.** Each fact links to the page it came from (link labels are listed at the end). Two of the six pages in the brief couldn't be read:
- **Unreadable:** both minecraft.fandom.com tutorials returned HTTP 402.
- **Used instead:** their maintained successors on minecraft.wiki ([crop-tut], [animal-tut]). The fandom wiki moved to minecraft.wiki, so the content should be the same, but nobody has compared them.
- **wbuilds.app:** pages give titles and partial material lists only; the rest is behind a subscription.
- **thegamer.com:** general planning tips, with no numbers and no edition named.

**Unsourced numbers:**
- *derived* means I calculated it from sourced numbers.
- *unsourced* means it is game knowledge that wasn't on a fetched page.

Both kinds are listed again in §5 to check in game.

---

## 1. Mechanics that matter to a bot

### 1.1 Farmland and water

| Fact | Value | Source |
|---|---|---|
| Hydration range | water within **4 blocks horizontally, diagonals included** (a 9×9 square centred on the water), at the **same level or 1 block above** the farmland | [farmland], [crop-tut] |
| Blocks in between | don't matter; still or flowing water both work; rain also hydrates | [farmland] |
| Moisture | levels 0–7. Dry farmland counts down. Hydrated farmland jumps straight to 7. It looks wet only at 7 (Bedrock: at 1–7) | [farmland] |
| Reverting to dirt | dry farmland reverts **only when nothing is planted on it** | [crop-tut], [farmland] |
| Other reversions | a solid block on top (**a melon or pumpkin growing onto it**, a tree growing), a piston pushing it, an enderman landing on it | [farmland] |
| Trampling chance | jumping or falling onto it: **chance = fall height − 0.5** (so any jump can trample) | [farmland] |
| Who tramples | players (also in Adventure mode); mobs only with `mobGriefing` on. Mobs smaller than **0.512 m³** never trample (chickens, rabbits, cats, **all baby mobs**) | [farmland] |
| Covering the water | an open water block is a trampling trap: falling in and climbing out lands on farmland. Cover it with a **slab (it waterlogs and still hydrates)**, carpet, lily pad or any walkable block. A solid cover also stops it freezing in cold biomes | [crop-tut] |

### 1.2 Light

| What | Light needed (Java) | Source |
|---|---|---|
| Plant seeds | **≥ 8** at the crop's block (Bedrock: any) | [seeds] |
| Crops grow | **≥ 9 at the crop's own block** (not the block above, since 19w09a) | [seeds], [crop-tut] |
| Stems / fruit grow | ≥ 9 at the stem's block | [melon-seeds], [pmf] |
| Bamboo grows | ≥ 9 at the top of the plant | [bamboo] |
| Sugar cane grows | **any light**, including darkness | [cane] |
| Sapling planted / kept | ≥ 8; at ≤ 7 without sky view it uproots | [tree], [tree-farm] |
| Sapling grows | sources disagree: [tree-farm] says "8 or better" for birch, but **9 underground** for oak (see §5) | [tree-farm] |
| Night growth | **Java: crops in the open keep growing at night** (no player sleeping) | [crop-tut] |
| Hostile spawning | only at **block light 0** (and sky light ≤ 7) in the Overworld | [mob-spawn] |

**Correction to the draft:** torches on paths don't speed outdoor growth in Java, because open-sky crops already grow at night. Torches are still needed for two things:
- **No mob spawns:** any block light > 0 stops them. A torch gives 14, falling by 1 per block, so it lights everything within 13 blocks (taxicab distance). *derived*
- **Roofed or underground farms**, where the crops get no sky light.

### 1.3 Growth rates and the row rule (crops on farmland)

The source is [crop-tut]. Every random tick, the crop grows one stage with chance **1 / (⌊25 / s⌋ + 1)**, where s is its speed points:

- **The block under the crop:** 2 points for dry farmland, **4** for hydrated.
- **Each of its 8 neighbours:** 0.25 for dry farmland, **0.75** for hydrated, 0 for anything else (water, path, fence).
- **Halving rule:** s is **halved** if the **same crop** is
  - **on a diagonal**, or
  - on **both** an east/west side **and** a north/south side.

  The wiki's sentence is ambiguous. My reading is the game code's: rows of the same crop running in one direction are fine, but a same crop in the next row (which puts it on the diagonals) halves the rate. Different crops (wheat beside carrots) don't count as "same".

**What it means for a fully hydrated 9×9 lot** (s values are *derived*):

| Position | Farmland neighbours | s in rows | Chance in rows | Not in rows (halved) |
|---|---|---|---|---|
| interior | 8 | 10 | **1/3** | 1/6 |
| next to the centre water | 7 | 9.25 | 1/3 | 1/6 |
| lot edge (path outside) | 5 | 7.75 | **1/4** | 1/7 |
| lot corner | 3 | 6.25 | **1/5** | 1/9 |

These match [crop-tut]'s table: 1/3 in rows, 1/4 edge, 1/5 corner; 1/6, 1/7, 1/9 not in rows. Dry farmland is much worse: 1/13 to 1/23.

**The draft's "alternating rows / different crops" rule is right, with one precision:** the rows must **alternate crop type** (or alternate with empty farmland). A whole lot of one crop is in the halved column everywhere. Alternating two crops keeps all 80 plants and avoids the penalty.

**Time to grow:**
- **Random ticks:** each block gets one every **68.27 s on average** in Java (204.8 s on Bedrock) [crop-tut].
- **Wheat, carrots, potatoes:** 8 stages, age 0–7 [seeds].
- **Expected time to mature (*derived*):** 7 / chance × 68.27 s, which gives **≈ 24 min** at 1/3, ≈ 32 min at 1/4 and ≈ 40 min at 1/5.
- **Conflict:** [crop-tut] says "about 31 minutes" at 1/3, which doesn't fit its own numbers. See §5.
- **When to harvest:** [crop-tut] gives about **80% of a field mature** as the best point to harvest a whole field (wheat; acceptable for carrots and potatoes).
- **Chunks:** crops only grow in ticked chunks. In Java a player must be **within 128 blocks** (horizontally) of the chunk's centre [farming], within simulation distance [crop-tut]. Andy being near his farms is what keeps them growing.

### 1.4 Harvest drops and replanting

| Crop | Mature drop | Immature drop | Source |
|---|---|---|---|
| Wheat | 1 wheat + **1–4 seeds** (avg ≈ 2 5/7). Fortune raises the seeds (I: 1–5, II: 1–6, III: 1–7) | 1 seed | [seeds], [crop-tut] |
| Carrot, potato | 1–4 of the crop. Potato: 2% chance of a poisonous potato | 1 item | [crop-tut] |
| Beetroot | 1 beetroot + 1–4 seeds | 1 seed | [crop-tut] |
| Melon block | 3–7 slices (at most 9 with Fortune); Silk Touch drops the block | n/a | [melon] |
| Melon stem (broken) | 0–3 seeds, more with age | n/a | [melon-seeds] |
| Seeds from grass | breaking short grass, tall grass or ferns: **12.5%** chance of 1 seed | n/a | [seeds] |
| (Bedrock) wheat | 0–3 seeds | n/a | [seeds] |

**Replanting:**
- **Replant at once** [crop-tut]. Breaking a crop never reverts the farmland; flooding a field harvests it without reverting the farmland either.
- **Pistons revert farmland.** If a piston pushes crops, the farmland must be tilled again [crop-tut].

### 1.5 Bone meal

The source is [bonemeal]. 1 bone makes 3 bone meal.

| Target (Java) | Effect |
|---|---|
| Wheat, carrot, potato | **+2–5 stages** (2–3 uses to mature from seed) |
| Beetroot | 75% chance of +1 stage |
| Melon/pumpkin stem | +2–5 stages; **never makes fruit** |
| Sugar cane | **no effect in Java** (Bedrock: grows to 3 tall) |
| Cactus, nether wart | no effect |
| Bamboo | +1–2 blocks |
| Sapling | **45%** chance of +1 stage (2 stages to a tree). Only works if light, space and soil already allow the tree; otherwise it's wasted [tree] |
| Grass block | grass and flowers in a 15×15×15 area |
| Cocoa, sweet berries | +1 stage |

**Value note (*derived*):**
- **What a bone meal costs:** about 21 surplus seeds through the composter (§1.6).
- **On a wheat crop:** 2–3 bone meal buy one early harvest, worth little.
- **Use it on saplings** (it removes a long wait) and on crops only when a target count is urgent.
- **For the model:** "bone_meal a growing crop" should be rare.

### 1.6 Composter

The source is [composter].

**How it fills:**
- Each item has a fixed chance to add a layer.
- **The first item into an empty composter always adds one.** The page's formula has a typo; its numbers fit 1 + 6/p.
- After 7 layers it reaches level 8 and gives **1 bone meal**.

| Chance per item | Farm items | Items per bone meal | Bone meal per stack of 64 |
|---|---|---|---|
| 30% | wheat, beetroot, melon and pumpkin **seeds**, saplings, leaves, short grass, kelp, sweet berries | 21 | 3.05 |
| 50% | **sugar cane, cactus, melon slice**, tall grass, vines | 13 | 4.92 |
| 65% | **carrot, potato, wheat, melon, pumpkin**, apple, flowers, fern, lily pad, mushrooms | 10.23 | 6.26 |
| 85% | **bread, baked potato, hay bale** | 8.06 | 7.94 |
| 100% | cake, pumpkin pie | 7 | 9.14 |

**Rules for andy:**
- **Not compostable:** bamboo, poisonous potatoes, meat, bones.
- **Hoppers:** a hopper above pushes items in and a hopper below pulls bone meal out (not from the sides). An automatic compost line needs no bot.
- **Keep it away from villagers:** an unclaimed composter turns a nearby unemployed villager into a farmer. Put andy's composter inside the shed, away from villagers.
- **What to compost:** surplus **seeds** first (30%, nothing else uses them), then **poisonous potatoes**. Never compost wheat or carrots that are needed for breeding.

### 1.7 Placement rules (non-farmland plants)

**Sugar cane** [cane]:
- **Soil:** grass, dirt (any kind), podzol, mycelium, moss, mud, sand or red sand.
- **Water:** the soil block must be **orthogonally next to water**, a waterlogged block or frosted ice. Diagonal or above doesn't count. **Covering the water with a block doesn't stop growth.**
- **Height:** grows to **3 tall**, at **≈ 18 min per block on average** (16 random ticks on the top block). Bedrock is ≈ 54 min.
- **Harvesting:** break the **2nd block** so the base stays. This resets that block's growth timer.
- **Layouts:** a double row along water gives 2 cane per water block; a grid gives 4 cane per water source [cane-farm].

**Melon / pumpkin** [melon-seeds], [melon], [pmf]:
- **Stems:** need farmland and 8 stages (age 0–7).
- **Fruit:** a mature stem tries to put a fruit on **one of its 4 orthogonal neighbours**. The spot must be air, on dirt, coarse or rooted dirt, grass, farmland, podzol, mycelium, moss or mud.
- **One fruit at a time:** a stem makes no more fruit while its fruit is still attached.
- **Grass or leaf litter** around a stem stops fruit spawning [pmf].
- **The same stem type beside a stem slows it**, the same row rule as crops [pmf].
- **The best layout reaches 50% stems** (one fruit spot per stem). The 9×9 plans in [pmf] reach **44.44% (36 stems)**.
- **Don't share fruit spots:** a spot next to two stems lets one fruit serve two stems, so plans keep stems in separated rows [pmf].
- **Speed:**
  - [melon] says a melon takes **10–30 min**.
  - [pmf] gives an average of **≈ 272 s per fruit per stem** (*derived:* ≈ 13 per stem per hour). These disagree; see §5.

**Cactus** [cactus-farm]:
- **Soil:** sand.
- **No neighbours:** **any block beside a cactus** breaks it. Thin blocks (fence posts, glass panes, iron bars) break new growth without the item landing back on the cactus.
- **Not covered:** growth rate and light aren't in the fetched page.

**Bamboo** [bamboo]:
- **Soil:** grass, dirt, coarse dirt, gravel, mycelium, podzol, moss, sand, red sand or mud. **No water needed.**
- **Growth:** about 1 block per 204.8 s, up to 12–16 tall. Its top needs light ≥ 9.
- **Harvesting:** cut above the base to keep it growing.
- **Uses:** not compostable; a weak fuel (0.25 items smelted per bamboo).

### 1.8 Trees (birch)

**Birch growth:**
- **Height:** a birch from a sapling is **5–7 logs tall**, one log column with no branches. Tall birches (up to 13) never grow from saplings [birch].
- **Space it needs:** a **3×3 column 6 blocks clear above the sapling**, with the **top 3 layers clear 5×5**. **No clearance is needed at the base**, so a sapling **in a 1-block-deep hole still grows** [birch].
- **Why birch:** [tree-farm] calls it "ideal for automatic farming": fast, the most uniform height, leaves always ≥ 2 blocks above the ground. It also yields the least wood per sapling.
- **Clearance:** 9 blocks (10 better).
- **Spacing:** "two blocks apart from other birch". Mixed with spruce, leave 4 blocks between saplings.

**All saplings:**
- **Soil:** any dirt except dirt path, plus moss and mud. Grass, mycelium or moss under the sapling turns to dirt when it grows [tree].
- **Rate:** about **one growth attempt per minute**, per tree [tree]. Bone meal gives 45% per use [bonemeal].
- **Sapling drops:** **1 in 20 leaves** drops a sapling (jungle 1 in 40), whether broken or decayed. Oak and dark oak leaves also drop apples [tree], 0.5% for oak [tree-farm].
- **Others:** spruce, jungle, dark oak and pale oak need 2×2 saplings [tree]. Dark oak sapling returns are unreliable [tree-farm], so birch stays the right choice.

### 1.9 Animals: food, breeding, growth

The sources are [breeding], [animal-tut], [cow].

| Animal | Breeds with (and follows) |
|---|---|
| Cow, mooshroom, sheep, goat | **wheat** |
| Pig | **carrot, potato, beetroot** (carrot on a stick only leads) |
| Chicken | **wheat, melon, pumpkin, beetroot or torchflower seeds**, pitcher pod |
| Rabbit | dandelion, carrot, golden carrot |
| Horse, donkey (tamed) | golden apple, golden carrot |
| Llama (tamed) | hay bale |
| Bee | flowers |
| Fox | sweet or glow berries |

**Breeding and growth timings:**

| Fact | Value | Source |
|---|---|---|
| Breeding cooldown | **5 min** after breeding (6 000 ticks, *unsourced*) | [breeding], [animal-tut] |
| Love mode | ends after **30 s** without a mate | [breeding] |
| Breeding XP | 1–7 | [breeding] |
| Baby → adult | **20 min** (24 000 ticks); snifflets take 40 | [cow], [breeding] |
| Speeding it up | feeding a baby its food cuts **10% of the remaining time** per feed | [cow] |
| Baby drops | nothing | [animal-tut] |

**Following and drops:**

| Fact | Value | Source |
|---|---|---|
| Following | animals follow a player **holding their food**, including babies and parents on cooldown | [breeding] |
| Cow follow range | cows notice wheat within **6 blocks** and stop following at **≥ 10 blocks** (Java) | [cow] |
| Cow drops | **1–3 raw beef** (steak if it dies burning), **0–2 leather**, 1–3 XP if a player or wolf kills it | [cow] |
| Chicken eggs | ≈ **8 per hour** per adult (one every 5–10 min); **1 in 8** thrown eggs hatches a chick | [egg-farm] |
| Loose items | despawn after **5 min**, so eggs on the ground get lost | [egg-farm] |
| Sheep wool regrowth | a sheep must **eat a grass block**: 1/1000 per tick, so ≈ 63% within 50 s and > 90% within 2 min | [sheep-farm] |
| Grazing | turns grass into dirt, so keep some grass the sheep can't reach, to spread back | [animal-tut] |

### 1.10 Pens, caps and crowding

**Crowding and caps:**
- **Entity cramming (Java):** at most **24 living entities in one block space**. More than that take rapid damage, **adults first** [animal-tut], [cow-farm]. It's a gamerule, `maxEntityCramming`; check the server.
- **Mob caps:** creature cap **10**, monster cap **70**, scaled by chunks around players [mob-spawn]. **They limit only natural spawning:** breeding, spawn eggs and spawners aren't capped [mob-spawn]. A pen can hold more than 10 bred animals, but the server's entity count (lag) becomes the real limit.
- **Despawning:** in Java **most passive mobs never despawn**, and anything bred, led or fed is protected [farming]. Bred stock is permanent.

**Pen design:**
- **No sizes in the sources:** none gives a pen size; [animal-tut] only says "large" for sheep.
- **Walls:** fences hold animals; **light pens** against hostiles.
- **Rabbits** jump out of a 2-block gap but not a 3-block one.
- **Leaving without a crowd:** lead animals to the far end first, or use a **double gate** [animal-tut].
- **Sheep:** solid walls are better than fences or glass panes, which sheep get stuck on [animal-tut].
- **Predators:** foxes and others can hurt stock; tamed wolves or ocelots seated nearby deter them [thegamer] (no edition named).

---

## 2. Lot templates (2×2 lots, paths, fence)

### 2.1 The common footprint

Every farm type uses the same field of **four 9×9 lots**.

**The 1-block paths:**
- **Where:** a cross between the lots **and a ring just inside the fence**. Without the ring, the outer cells of each lot are 9 blocks from the nearest path, out of reach unless andy steps on farmland.
- **Reach (*derived*):** with the ring, every lot cell is at most 4 blocks from a path. That puts it within andy's 4.5-block reach, standing on the path at the cell's row: eye-to-crop distance ≈ 4.15.

```
 F F F F F F F F F F F F F F F F F F F F F F F      23 × 23 outside the fence
 F . . . . . . . . . . . . . . . . . . . . . F      F = fence (G = gate), T = torch on a fence post
 F . [ lot A 9×9 ] . [ lot B 9×9 ] . F      . = path (gravel / dirt path / slab:
 F .        ...        .        ...        . F          not dirt or grass, so no melon or
 F . . . . . . . . . . . . . . . . . . . . . F          pumpkin grows on it and no mobs graze)
 F .        ...        .        ...        . F
 F . [ lot C 9×9 ] . [ lot D 9×9 ] . F
 F . . . . . . . . . . . . . . . . . . . . . F
 F F F F F F F F F F G F F F F F F F F F F F F
```

**Field counts (*derived*):**

| Item | Count |
|---|---|
| Area inside the fence | 21×21 |
| Fence | 88 blocks: 87 posts + 1 gate (a double gate adds one) |
| Path | 117 blocks: 4 lots take 324 of the 441 inside |
| Torches | on the fence posts at the 4 corners, the 4 path ends and the centre cross (9 per field). Every cell is then within 13 blocks of a torch (taxicab), so block light stays > 0 and nothing spawns |

**Placement:**
- **Ground:** the fence and paths sit at farmland level.
- **Hydration:** water must be on the farmland level, so lots need flat ground. Check the "flat land" tip in [thegamer]; terraforming a 23×23 is the first job of a new field.

### 2.2 Farmland crops (wheat, carrots, potatoes, beetroot): the draft is confirmed

```
 a a a a a a a a a      a = crop 1 (5 rows: 44 plants)
 b b b b b b b b b      b = crop 2 (4 rows: 36 plants)
 a a a a a a a a a      W = water source under a bottom slab
 b b b b b b b b b          (waterlogged, still hydrates, walkable)
 a a a a W a a a a
 b b b b b b b b b      Rows alternate crop type, so no plant
 a a a a a a a a a      has the same crop on a diagonal: no halving.
 b b b b b b b b b
 a a a a a a a a a
```

- **Plants:** **80** per lot [crop-tut]. One water source hydrates the whole 9×9 (§1.1).
- **Growth (*derived*):** interior **1/3**, edges 1/4, corners 1/5 per random tick. The edges sit against the path, and making the path farmland would only invite trampling.
- **Crop pairs:** the field's four lots could be:
  - A: wheat/carrot
  - B: wheat/potato
  - C: wheat/beetroot
  - D: carrot/potato

  That gives 3 lots of wheat rows (for cows, sheep, bread) and every food crop. Alternatively, one crop per lot alternating with **empty** farmland rows: same growth rate, but only 44 plants.
- **Yield per lot per harvest:**
  - wheat rows: ≈ 44 wheat + ≈ 120 seeds (≈ 75 left after replanting);
  - carrot or potato rows: ≈ 36 × 1–4.

  Harvested every ~30–40 min (edges are the slow part), that's **≈ 120–160 crops per lot per hour** and **≈ 500–650 per field per hour** (*derived*, to measure).

### 2.3 Sugar cane: the draft is confirmed, with covered channels

```
 c W c c W c c W c      c = cane on dirt or sand, W = water channel (9 sources each)
 c W c c W c c W c      every c touches a channel orthogonally
 ...  (9 rows)          put slabs or planks ON TOP of the channels:
 c W c c W c c W c      growth isn't affected [cane], and they make walkways
```

- **Cane:** **54** (6 columns × 9) and 27 water per lot.
- **Walkways:** cane has no collision, but the channels would make andy swim and wet his pack. Covers make walkways at every third column: andy walks along a channel cover and breaks the 2nd block of the cane on each side.
- **Denser option:** the grid layout reaches 4 cane per water [cane-farm] (≈ 64 per 9×9 *derived*) but leaves no walkway. Not for a bot.
- **Yield (*derived*):** ≈ 18 min per block. Harvesting the 2nd and 3rd blocks every ~36 min gives up to 2 per plant, so **≈ 180 cane per lot per hour**. That's a ceiling, since growth "varies widely" [cane].

### 2.4 Melon / pumpkin: the draft (~36 stems) is confirmed, with a layout correction

```
 f m m f W f m m f      m / p = melon / pumpkin stem on farmland
 f p p f W f p p f      f     = fruit spot (farmland at first; dirt after a fruit)
 f m m f W f m m f      W     = water column (9 sources, slab-covered walkway)
 f p p f W f p p f
 ...  (9 rows, alternating m / p rows)
```

- **Stems:** **36** per lot (44.44%, the 9×9 best in [pmf]).
- **Fruit spots:** each stem has exactly one free side, so no fruit spot is shared by two stems [pmf]. Columns 1 and 9 border the path, so **the path must not be fruit support** (gravel, dirt path, cobblestone or slab).
- **Row rule:** the paired stems (m m) touch east/west, so a whole lot of melons would put the same stem on both axes and halve the rate. **Alternating melon and pumpkin rows** removes the diagonals and the north/south neighbours (*derived*, same rule as §1.3).
- **Pure melon lot instead:** use `f m f` triples, 27 stems.
- **Yield:** 36 fruit spots per lot; a melon is 3–7 slices [melon]. Output per hour is uncertain: ≈ 2–13 fruit per stem per hour from the two sources (§1.7, §5). Plan for ~3 (*≈ 100 fruit per lot per hour*) until measured.
- **Re-tilling:** a fruit turns its farmland spot into dirt [farmland]. Dirt is still fruit support, so re-tilling only matters for the hydration bonus. Re-till when idle.

### 2.5 Tree farm (birch): confirmed, with planting and reach changes

```
 . . . . . . . . .      s = birch sapling, planted 1 block DOWN (in a hole):
 . s . . s . . s .          it grows fine [birch] and lowers the top logs by 1
 . . . t . . t . .      t = torch on the ground (no base clearance needed [birch])
 . . . . . . . . .      . = dirt or grass (walkable: no farmland here)
 . s . . s . . s .
 . . . t . . t . .      saplings 3 apart ("two blocks apart" [tree-farm]);
 . . . . . . . . .      across a path the next lot's sapling is also 3 away
 . s . . s . . s .
 . . . . . . . . .
```

- **Trees:** **9** per lot, ≈ 45–63 logs per harvest (5–7 each [birch]).
- **Leaves:** a birch canopy (*unsourced*: a few dozen leaves) returns about 2 saplings per tree at 1/20 [tree], so the lot replants itself.
- **Clearance:** none above the field: nothing within 10 blocks [tree-farm].
- **Spacing check (*derived*):** with spacing 3, a neighbour's 5×5 top layers overlap by 1 column. Neighbours' logs are never in another tree's 3×3 column.
- **Leaves in the way:** in Java leaves don't block growth (logs do only in Bedrock [tree]), so growing next to a grown neighbour is fine (*verify in game*).
- **Light:** torches keep the ground ≥ 8–9 at night and stop mobs spawning in the tree shade.
- **Reach:** a 7-log birch planted 1 down has its top log about 5 blocks above andy's feet. That's at the edge of reach, so andy may pillar 1 block to clear the top log (§5).
- **Bone meal:** saplings are the best use of bone meal (§1.5).

### 2.6 Animal pens

Use the same 2×2 grid; see §3.

---

## 3. Animal ranch layout

**What the sources recommend:**
- **The basics:** fence the animals, light the pens, use a double gate or move animals to the far end before leaving [animal-tut].
- **Placement:** put the **wheat farm next to the pens**, so breeding food doesn't travel far [thegamer]. Keep pens **away from busy routes** because of the noise. Use extra fencing (or tamed wolves) against predators [thegamer].
- **wbuilds.app:** builds for cows, pigs and chickens (barns, coops, pens), each with separate Java and Bedrock versions. Their dimensions and materials are behind a paywall [wbuilds].

### Proposed ranch: one 23×23 field, a pen per kind

```
 F F F F F F F F F F F F F F F F F F F F F F F
 F . . . . . . . . . . . . . . . . . . . . . F
 F . P P P P P P P P P . P P P P P P P P P . F     P = pen fence (on the lot's outer ring)
 F . P  cows  7×7  P . P  sheep 7×7  P . F     g = pen gate, onto the path
 F . P   (grass)   g . g   (grass)   P . F     all pens: grass floor, torch on each corner post
 F . P P P P P P P P P . P P P P P P P P P . F
 F . . . . . . . . . . . . . . . . . . . . . F     shared path cross = feeding lane
 F . P P P P P P P P P . P P P P P P P P P . F
 F . P  pigs  7×7  g . g chickens 7×7 P . F     chickens: or the egg collector of §6.1
 F . P P P P P P P P P . P P P P P P P P P . F
 F . . . . . . . . . . . . . . . . . . . . . F
 F F F F F F F F F F G F F F F F F F F F F F F
```

**Layout:**
- **Pens:** each 9×9 lot's outer ring is the pen fence, so the pen inside is **7×7 = 49 blocks**. That's room for a capped herd (see below), and the ranch tiles with the crop fields.
- **The draft's 8×8 interior** needs 10×10 lots and breaks the grid. 7×7 is enough at the caps below.
- **Gates** face the inner cross path, where andy stands to feed over the fence. An animal 1 block from the fence is within reach.
- **Next to the crop field:** put the ranch beside the farmland field, sharing a fence side, so wheat goes straight to cows and sheep [thegamer].

**Feeding and caps:**
- **Breeding:** feed 2 adults their food (§1.9). Repeat per pair every **5 min**.
- **Feeding babies** cuts their 20 min growth by 10% of the remainder per feed [cow]. That's worth it only with a large surplus.
- **Caps (*proposal*):**
  - **8 adults per kind:** that keeps ≥ 2 to breed, keeps 49 blocks uncrowded, and stays far below cramming (24 per block).
  - **Breed only while adults + babies < cap**, and only with **food above a reserve**.
  - **Above the cap, cull adults:** cow → 1–3 beef, 0–2 leather [cow].

**Leaving a pen:**
- **Animals follow food**, so andy should **put the breeding food away (hold something else) before opening a gate**. Then nothing follows him out. That's simpler for a bot than the double gate in [animal-tut].
- **Close every gate behind him** (a model input: "gate open").

**Per kind:**
- **Sheep:** keep grass in the pen for wool regrowth. Shearing gives wool without killing. Don't let the pen graze to bare dirt: keep a strip of grass outside the reach of the sheep [animal-tut].
- **Chickens:** an open pen loses eggs to the 5-minute despawn [egg-farm]. The egg collector (§6.1) is the better chicken pen.

**Moving animals in:**
- **Lead:** hold the food and walk ahead; cows follow within 6 blocks and give up at 10 [cow]. A lead also works (string; or from trader llamas).
- **Not for a bot:** [animal-tut]'s boats, minecarts and setting animals on fire.

---

## 4. Priorities for an idle farmer bot

### 4.1 Order (first that applies wins)

1. **Safety:** hostiles near, low health or low food → fight, flee or eat. This is the existing pack line: Health, Food, Hostiles.
2. **Protect what exists:**
   - close an open gate;
   - mend a broken fence or path gap;
   - cover the open water;
   - re-till trampled farmland, which is dirt inside a lot.
3. **Harvest and replant** a lot that is ≥ ~80% ripe [crop-tut], or any ripe crop when nothing else is due. **Replant each cell straight away.**
4. **Unload** with the existing laya-go `pack.Unload` rule, into the shed's sign-labelled chests: `andy produce`, `andy seeds`, `andy farm tools`.
5. **Plant** empty farmland, and **water** dry farmland.
6. **Animals:**
   - breed a kind when it has ≥ 2 adults off cooldown, its count is under the cap, and its food is above the reserve;
   - cull above the cap;
   - shear sheep with wool;
   - collect eggs.
7. **Trees:** fell grown birches, replant the saplings, and use bone meal on saplings when it's above the reserve.
8. **Compost** surplus above `keep_seeds`: seeds first, then poisonous potatoes (§1.6).
9. **Expand:** build the next lot of the farm type furthest below 4 lots, chosen by stock shortfall:
   - out of wheat → a crop lot;
   - out of paper or sugar → cane;
   - out of logs → trees.

   Building also covers fences, paths, torches, the shed and signs.
10. **Automate:** the next build in the §6 order whose materials andy has.
11. **Nothing due:** gather seeds from grass if seeds are low (12.5% per grass block [seeds]); otherwise wait. With crops growing, waiting is fine (`wait_limit` only counts waits with nothing growing).

### 4.2 Inputs the decision model needs

The current state is a **9×9 view around andy** plus the pack line (`docs/laya-farm.md`). Standing on a path, that view sees half a lot. The next model should reason over **lots**, not cells:

- **Farm map** (a memory place per field; lots indexed A–D). Per lot:
  - type and crop pair;
  - cells ripe / growing / empty farmland / dry / trampled (dirt);
  - % ripe;
  - minutes since the last harvest.
- **Infrastructure faults:** gate open, fence gaps, water uncovered, unlit spots (block light 0), lots missing from the 4-lot target.
- **Animals per pen:**
  - adults, babies;
  - adults off cooldown (andy must remember breed times; there's no visible cooldown);
  - sheep with wool;
  - cap.
- **Stocks** (pack + shed chests) against **targets**:
  - seeds per kind;
  - wheat reserve for breeding;
  - carrots or potatoes for pigs;
  - bone meal;
  - saplings;
  - fence, torches, slabs;
  - building blocks;
  - hoe / axe / shears durability.
- **Clock:** time of day (night = hostiles and the planting-light rule) and whether andy is near enough to keep the chunks ticking (§1.3).
- **Pack line as now:** free slots, distance to the shed, health, food, hostiles, valuables.
- **Build queue:** the next lot or auto farm, and the materials it still lacks (to drive `craft`/gather).

**Rule of thumb (*derived*):** the most-valued action per minute is harvesting a ripe lot (≈ 80–160 items per pass). Next comes breeding, which costs food but lasts. Building is last, but it raises every later hour.

---

## 5. Open questions / things to test in game

Test in the reset-able test world (`tools/test-world`, MCP `world_reset`, `site_tp`):

**Crops:**
1. **Crop grow time:** is it ≈ 24 min (my *derivation*) or ≈ 31 min ([crop-tut]) at 1/3? Time 80 hydrated wheat from seed with andy idle nearby.
2. **Row rule reading:** compare an alternating wheat/carrot lot with an all-wheat lot (which should be ~2× slower).
3. **Melon/pumpkin rate:** 272 s per fruit ([pmf]) or 10–30 min ([melon])? Count fruit from one 36-stem lot over an hour.

**Saplings:**

4. **Light for growth:** 8 or 9? Test a sapling at light 8 without sky.
5. **Birch at spacing 3:** does it grow beside a grown birch (leaves in its 5×5 top)? And how many saplings come back per tree?
6. **Reach:** can andy break a 7th-log birch from the ground (sapling planted 1 down), or must he pillar? This depends on the server's block interaction range in 1.21.6.

**Farm basics:**

7. **Covered channels:** confirm cane grows beside a slab-covered channel, and that a waterlogged slab in the centre water still hydrates 9×9.
8. **Paths:** do gravel or dirt path stop fruit (they aren't support blocks) and keep andy off farmland?
9. **Carrot and potato drops:** the average count (the source says 1–4).
10. **Beetroot growth:** speed and stage count. They're not in the fetched sources; beetroot has fewer stages and grows slower (*unsourced*).
11. **Chunks:** do the farms keep growing while andy works elsewhere? (128 blocks and simulation distance, §1.3.)

**Animals:**

12. **Server gamerules:** check `maxEntityCramming` (24) and `mobGriefing` (affects trampling by mobs and grass eating by sheep).
13. **Feeding over a fence:** can andy feed animals over the pen fence from the path (entity reach), and do animals follow him through a gate he opens while not holding food?
14. **Cow breeder:** wbuilds says "a button breeds the cows" [wb-cow]. [dispenser] lists no feeding or breeding behaviour for dispensers. Find out how it actually breeds them before copying it.

**Iron farm and automation:**

15. **Zombie panic:** do villagers panic at a zombie behind glass or a wall within 6 blocks, or must they see it? Does glass count as a solid top for golem spawns?
16. **Golem rate:** measure golems per hour from a 3-villager pod in the test world (villagers and zombie spawned with `server_command`).
17. **Facing:** check the facing andy gets when placing hoppers, pistons, observers and dispensers through mineflayer, before any redstone build.
18. **Moving villagers:** can andy move a villager by boat or minecart at all?

---

## 6. Automatic and assisted farms

**A material gate that matters for andy:**
- **Observers** (6 cobblestone, 2 redstone, **1 nether quartz** [observer]) need nether quartz.
- **Comparators and daylight sensors** do too (*unsourced*).
- So **observer farms wait until andy can get to the Nether** (or a player gives him quartz).
- **Hoppers** cost 5 iron + a chest each (*unsourced*). Iron is the other limiter, which is why the iron farm unlocks the others.
- **Dispensers** (cobblestone, bow, redstone [dispenser]) are cheap. They throw eggs, shear sheep, use bone meal and place or collect water and lava [dispenser]. They **don't** feed animals.

**What placing redstone parts means for a bot:**
- **Facing:** hoppers point into the block they're placed against. Pistons, observers and dispensers face by the bot's look direction (*unsourced*). Andy needs an "oriented place" skill: look in direction D, then place against face F.
- **Verify:** check the placed block's `facing` property and redo it if wrong.

### 6.1 Egg collector (chickens over a hopper)

- **How it works:** chickens stand on a hopper; eggs drop into it and pass into a chest [egg-farm].
- **Materials:** the minimal **3×3×4** design is 8 blocks + 1 hopper + 1 chest [egg-farm]. Add glass or fence so andy can see in.
- **Footprint:** 3×3.
- **Output:** **≈ 8 eggs per chicken per hour** [egg-farm]. With 10 chickens, ≈ 80 per hour (*derived*).
- **Crowding:** keep the chickens below 24 per block space (cramming), or add a vine block [egg-farm].
- **Andy builds:**
  1. dig, then place the chest;
  2. place the hopper against the chest (it points into it);
  3. build the walls.
- **Stocking it:** throw eggs into the cell (1/8 hatch [egg-farm]) or lure chickens with seeds through a gate, then close it.
- **Ongoing job:** empty the chest. Eggs go to the cooker (§6.2), to throwing for more chickens, or to cake.
- **Rating:** **very realistic: the first build** (1 hopper = 5 iron).

### 6.2 Chicken cooker (wbuilds "Chicken Farm Java")

- **How it works:** a dispenser fires eggs into a chamber, and chicks hatch [egg-farm].
  - **Filtering:** a slab over the hopper keeps chicks (and the lava) off until they grow.
  - **Killing:** grown chickens are cooked by lava (or a lava cauldron).
  - **Collection:** the drops go into a hopper and a chest [egg-farm].
  - **wbuilds** describes a glass pen on a stone and glass box, with lava cooking grown chickens into a chest: "keeps your food chest full with no work" [wb-chicken].
- **Materials (wbuilds, 8 of 12 kinds visible; 60 items):** 1 cauldron, 2 chests, 1 dispenser, 10 glass, **4 hoppers**, 1 lava bucket, 1 oak fence, **1 comparator** (quartz) [wb-chicken].
- **Version warning:** the lava-cauldron design needed a **piston workaround on 1.21.6–1.21.8**, which is exactly andy's server [egg-farm].
- **Footprint:** not given (paywalled). Roughly a 3×3 tower (*unsourced*).
- **Output (*derived*):** cooked chicken and feathers at about eggs ÷ 8 per hour. Fed from a 10-chicken collector, that's ≈ 10 chickens per hour, 20 minutes after each hatch.
- **Andy builds:** lava handling, slab placement, comparator wiring.
- **Ongoing job:** empty the chest and keep the dispenser stocked with eggs (or chain the collector into it).
- **Rating:** **medium-hard**: quartz, lava, and the 1.21.6 quirk. Later.

### 6.3 Cow crusher (entity cramming) and the wbuilds cow farm

- **How it works (wiki):** cows live in a **2-deep hole** with a water source, a hopper and a chest, with a fence on top.
  - **Andy feeds them wheat** until there are more than 24.
  - **Cramming** then kills adults first; babies survive and grow up [cow-farm].
  - **No XP or Looting** [cow-farm].
  - **Java only;** it needs the `maxEntityCramming` gamerule at 24.
- **The wbuilds "Cow Farm Java" (43 steps, start with 24 cows):**
  - **How it runs:** a button "breeds the cows". After ~20 min a second press sends the adults into lava, and steak and leather fall into a chest [wb-cow].
  - **Materials (8 of 14 kinds; 85 items):** 2 chests, 3 dispensers, 6 glass, 2 hoppers, 6 ladders, 2 lava buckets, 2 oak fences, 2 oak signs [wb-cow].
  - **Unverified:** how a button breeds cows (§5.14).
  - **Similar wiki design:** the "Steakatron 2000" works the same way: the player breeds, then a button picks raw or cooked [cow-farm].
- **Materials (crusher):** 1 hopper, 1 chest, 1 water bucket, a few fences, 1 stair, ~10 blocks.
- **Footprint:** a 1×1 crush cell, about 3×3 to build.
- **Output (*derived*):** each 2 wheat makes 1 calf, which becomes 1 kill later: ≈ 2 beef + 1 leather [cow]. 12 pairs every 5 min caps it at ~144 calves per hour, so it's **limited by wheat**. 3 crop lots with wheat rows (≈ 44 wheat each per harvest, ≈ 2 harvests per hour) feed ≈ 130 calves per hour.
- **Andy builds:**
  1. dig the hole;
  2. place the chest and the hopper (pointing into it);
  3. pour the water;
  4. fence over the top;
  5. lead 2 cows in (they follow wheat within 6 blocks [cow]; they fall in).
- **Ongoing job:** **feed wheat every 5 min** (right-click cows in the cell through the fence) and empty the chest.
- **Rating:** **realistic second build.** It needs no quartz and no lava, and it uses andy's main surplus, wheat. The lava (steak) version comes later.

### 6.4 Sheep (shearing)

- **Automatic version:** an observer watches a grass block. When a sheep eats it, the observer powers a dispenser of shears, and hopper minecarts under the grass collect the wool [sheep-farm]. It needs quartz.
- **Assisted version:** andy shears by hand in the pen (§3). That's easy now.
- **Rating:** the automatic one comes late, and the assisted one now.

### 6.5 Observer sugar cane

- **How it works:** a pillar of cane, then a **piston** at the 2nd block, then an **observer** above. Growth fires the observer, which fires the piston and breaks the cane. Items go to hoppers, hopper minecarts or a water stream into one hopper [cane-farm].
- **Without observers:** a clock (a daylight sensor or a repeater clock) can fire all pistons together [cane-farm]. A daylight sensor also needs quartz (*unsourced*); a redstone-torch-and-repeater clock doesn't.
- **Materials per cane column:** 1 piston, 1 observer, redstone, plus a shared collection line.
- **Output:** the same as the manual plant (≈ 18 min per block [cane]), but with no labour.
- **Andy builds:** oriented pistons and observers, plus a water-stream collection channel. It's many precise placements, so it needs the oriented-place skill and a verify pass.
- **Ongoing job:** empty the chest.
- **Rating:** **medium**, once quartz and iron are there. The clock version is possible earlier.

### 6.6 Observer melon / pumpkin

- **How it works:** an observer above the fruit spot (or watching the stem) fires a piston that breaks the fruit, collected by a hopper minecart into a chest. "Design 10" reports **12–13 melons per minute** for a large build [pmf].
- **Materials:** a piston + an observer per fruit spot, a hopper minecart, rails, a chest.
- **Rating:** **medium-hard** (quartz, many parts). The manual lots of §2.4 are cheap and good enough first.

### 6.7 Villager crop farm

- **How it works:** a **farmer villager** (claimed by a composter) harvests and replants farmland. It throws surplus food to other villagers.
  - **Collection:** a **second villager with a fixed other profession** stands over a hopper (in [crop-tut]: a hopper under two stacked hopper minecarts, under a trapdoor) and catches the thrown crops.
  - **Roof:** stops lightning from turning villagers into witches.
  - **Position:** inside a village, or more than 32 blocks from one (*verify*) [crop-tut].
- **Materials:** a composter, a 9×9 lot of farmland and water, 1–2 hoppers + 2 hopper minecarts + a chest, a job block for the collector, a glass enclosure, a roof. Beds keep villagers linked and breeding [villager-farming].
- **Output:** not in the sources.
- **Ongoing job:** empty the chest; nothing else.
- **Rating:** **hard** for the villagers (see §6.8). The rest is easy. Do it together with the iron farm: one villager transport effort serves both.

### 6.8 Iron farm (Java 1.21)

**How golems get summoned:** the sources are [iron-farm], [golem], [iron-tut].
- **Panic:** **3 villagers panicking** (from a zombie within ~6 blocks) can summon a golem, each villager every 5 s. Gossiping needs 5 and is less reliable.
- **Conditions:**
  - each villager **slept within the last 20 min** (so each needs a **bed**);
  - the villagers are within 10 blocks of each other;
  - **no golem seen within 16 blocks in the last 30 s** (checked every 10 s);
  - no summon within 10 blocks in the last 30 s.
- **No workstations needed:** professions aren't required [iron-farm].
- **Spawn spot:**
  - up to 10 tries in a **17×17×13 box** centred on the villager (±8 x/z, ±6 y);
  - the target block needs a **solid top**;
  - it and the 2 blocks above mustn't be full blocks, powered, rails or water (for the two above);
  - **slabs, fences and carpet don't stop spawning**;
  - the golem mustn't collide with entities [golem].
  - **Buttons and pressure plates** can block summoning [iron-farm].
- **The zombie:**
  - zombies despawn, so keep the zombie in a **boat or minecart**, **name it**, or give it items or armour [iron-farm];
  - it must stay out of daylight (*unsourced*: zombies burn; [curing] uses an opaque roof for zombie villagers);
  - whether the villagers must *see* the zombie isn't in the sources (§5.15).
- **Drops:** each golem drops **3–5 iron** (avg 4) and 0–2 poppies [golem].
- **Kill method:** lava on a sign (a "lava blade"), with drops into a hopper and a chest [iron-farm].
- **Bedrock (not usable):** Bedrock needs 20 beds and 10 villagers [iron-farm].

**Rate (*derived*):** the 30 s "golem seen" rule caps one 3-villager pod at ≈ 1 golem per 30–40 s. That's ≈ **90–120 golems per hour, so ≈ 360–480 iron per hour as a ceiling**, but only if each golem leaves 16-block sight or dies quickly. Real simple farms will be lower. Bedrock farms report 240–400 per hour [iron-farm], but that's another edition's rule set. Measure it.

**A simple bot-friendly design (*my proposal* from the rules above, not a copied build):**

```
 side view (not to scale)
   [ villager pod: 3 cells, 3 beds, roof ]   ← 2–3 blocks above the platform
   [ zombie cell (boat or name tag), roofed, ≤ 6 blocks from the villagers ]
   ─── spawn platform: 8×8 solid floor, open above (golems land here) ───
   water on the platform pushes golems to one edge →  lava on a sign  →  hopper → chest
```

**Design rules:**
- **The platform is the only valid spawn surface** in the ±8/±6 box. Slabs, fences and carpet still count as valid [golem], so everything else in the box must be air, water, or blocks without a solid top.
- **Clear quickly:** the golems must die or move out of 16 blocks fast, to keep the 30 s cooldown from stalling the farm.

**Materials (estimate):**

| Item | Amount |
|---|---|
| Villagers | 3 |
| Beds | 3 (9 wool + 9 planks) |
| Zombie | 1 + a name tag (or a boat) |
| Building blocks | ~150 |
| Glass | ~16 |
| Water buckets | 2–4 |
| Lava bucket | 1 |
| Sign | 1 |
| Hoppers | 1–2 |
| Chest | 1 |
| Torches | for the surroundings, so nothing else spawns or wanders in |

**Footprint:** ≈ 11×11 and ~10 tall.

**The hard parts for a bot:**

1. **Getting 3 villagers in.** Villagers don't follow food.
   - **Transport (untested for mineflayer):** in a **boat** (they walk into one; a boat on land is slow but works) or a **minecart on rails** (needs rails, so iron).
   - **Breeding in place:** 2 villagers + beds + **12 food points each** (bread 4, carrot, potato and beetroot 1 each), and no other village within 80 blocks [villager-farming]. That gives a second-generation pod from 2 villagers.
   - **Curing zombie villagers:**
     - trap one under a roof;
     - splash **Weakness** (the brewing needs a fermented spider eye and **blaze powder, so the Nether**);
     - feed a **golden apple** (8 gold + an apple);
     - wait **3–5 min** [curing].

     It's the hardest route.
   - **Build where they are (best for a bot):** in an existing village, wall in 3 villagers where they stand, place their beds inside, then build the pod and platform around them. No transport needed.
2. **The zombie.**
   - **Name tags:** monster-room chests (25.3%), mineshaft chests (42.3%), fishing (0.8%) or a **librarian for 20 emeralds** (in 1.21; removed in 26.1). Naming costs 1 level at an anvil [nametag].
   - **A boat instead** keeps a zombie without a name tag [iron-farm].
   - **Luring it:** a zombie that chases andy into a boat or cell at night means andy fighting near the pod.
3. **Precision:** lava placement next to a sign, water flow on the platform, and checking that no other spawn spot exists. All of it is verifiable with a test-world scenario.

**Ongoing job:**
- empty the chest;
- check the zombie is still there;
- keep the villagers' beds reachable and night sleep possible (**no light changes inside the pod**);
- stay within range so the chunks tick.

**Rating:** **hard. The last build,** after andy can fight at night, travel and craft beds in bulk. It pays off in hoppers and rails for every other auto farm. A good test-world scenario: "andy builds an iron farm around 3 placed villagers + a spawned zombie" (spawned with `server_command`) first, then add transport later.

### 6.9 Recommended build order

| # | Build | Why now | Blocks on |
|---|---|---|---|
| 1 | Crop field (4 lots, alternating rows) + shed + composter | food, seeds, wheat for everything else | flat ground, a hoe, water |
| 2 | Egg collector (§6.1) | 1 hopper, no redstone, no lava | 5 iron |
| 3 | Ranch pens (§3) + cow crusher (§6.3) | turns wheat into beef and leather with no killing | 5 iron, 2 cows |
| 4 | Sugar cane and birch fields (manual) | paper and books, logs and saplings | sand or dirt, water |
| 5 | Melon/pumpkin field (manual) | food, and melon seeds feed chickens | seeds from a village or the world |
| 6 | Observer cane → chicken cooker → wool → observer melon | labour-free output | **nether quartz**, iron |
| 7 | Villager crop farm + iron farm | iron for every later hopper and rail | 3+ villagers, a zombie, name tag or boat |

---

## Sources

The brief's sources:

[crop-fandom]: https://minecraft.fandom.com/wiki/Tutorials/Crop_farming "HTTP 402, not read; minecraft.wiki successor used: crop-tut"
[farming]: https://minecraft.wiki/w/Farming
[thegamer]: https://www.thegamer.com/minecraft-build-farms-ranch-tips/
[animal-tut]: https://minecraft.wiki/w/Tutorial:Animal_farming
[animal-fandom]: https://minecraft.fandom.com/wiki/Tutorials/Animal_farming "HTTP 402, not read; minecraft.wiki successor used: animal-tut"
[wbuilds]: https://wbuilds.app/builds/farms/style/animal-farm
[wb-chicken]: https://wbuilds.app/builds/farms/chicken-farm-java-b87
[wb-cow]: https://wbuilds.app/builds/farms/cow-farm-java-b88

Mechanics (minecraft.wiki):

[crop-tut]: https://minecraft.wiki/w/Tutorial:Crop_farming
[farmland]: https://minecraft.wiki/w/Farmland
[seeds]: https://minecraft.wiki/w/Wheat_Seeds
[composter]: https://minecraft.wiki/w/Composter
[bonemeal]: https://minecraft.wiki/w/Bone_Meal
[cane]: https://minecraft.wiki/w/Sugar_Cane
[cane-farm]: https://minecraft.wiki/w/Tutorial:Sugar_cane_farming
[melon-seeds]: https://minecraft.wiki/w/Melon_Seeds
[melon]: https://minecraft.wiki/w/Melon
[pmf]: https://minecraft.wiki/w/Tutorial:Pumpkin_and_melon_farming
[cactus-farm]: https://minecraft.wiki/w/Tutorial:Cactus_farming
[bamboo]: https://minecraft.wiki/w/Tutorial:Bamboo_farming
[tree]: https://minecraft.wiki/w/Tree
[tree-farm]: https://minecraft.wiki/w/Tutorial:Tree_farming
[birch]: https://minecraft.wiki/w/Birch
[breeding]: https://minecraft.wiki/w/Breeding
[cow]: https://minecraft.wiki/w/Cow
[mob-spawn]: https://minecraft.wiki/w/Mob_spawning

Automatic farms (minecraft.wiki):

[egg-farm]: https://minecraft.wiki/w/Chicken_farm
[cow-farm]: https://minecraft.wiki/w/Cow_farm
[sheep-farm]: https://minecraft.wiki/w/Sheep_farm
[observer]: https://minecraft.wiki/w/Observer
[dispenser]: https://minecraft.wiki/w/Dispenser
[iron-farm]: https://minecraft.wiki/w/Iron_golem_farm
[iron-tut]: https://minecraft.wiki/w/Tutorial:Iron_golem_farming
[golem]: https://minecraft.wiki/w/Iron_Golem
[villager-farming]: https://minecraft.wiki/w/Tutorial:Villager_farming
[curing]: https://minecraft.wiki/w/Villager_curing
[nametag]: https://minecraft.wiki/w/Name_Tag

Notes on the sources:
- The minecraft.wiki **Pig farm** page (https://minecraft.wiki/w/Pig_farm) was also read; it adds nothing beyond [cow-farm].
- The fandom pages were blocked (HTTP 402). Their minecraft.wiki successors were used, but the two weren't compared, so any disagreement between them is unknown.
