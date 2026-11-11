# Chores round 2: fix what the first day found, finish the unbuilt parts

## Why
The first day from scratch on the test world (`bots/andy/logs/game-tests/laya-chores-2026-11-11.md`, 2026-11-11 AEST)
found three faults and left three spec'd parts of laya-chores unbuilt:

- **night_mine fall death** (high): at 04:17 UTC a collect step of the mine job dug the coal block andy stood on
  (148 56 164) over a cave; he fell from Y 57 to Y 30 and died. `collectOreAt`'s pathfinder goal (look at the block
  within reach 4) was already met standing on top of it, so it dug its own floor.
- **craft_stone_tools "failed"** (med): readChest walked out of a gather-cobble pit, `unstuck` interrupted the chore,
  and the axe craft returned false: the actuator said "couldn't make a stone axe" though it was the interrupt. The
  actuator then went on in the background (runChore had already returned) and crafted the stone pickaxe anyway.
- **place_furnace failed twice** (med): both fast (~0.6 s) failures, right after that interrupt. The furnace places
  fine in a clean scene. placeAt walked to within 3, then placeBlock's own step back (a pathfinder goal any mode can
  cancel) or the walk threw. placeAt tried once and dropped placeBlock's reason.
- Unbuilt: replant where a cut tree stood; whole coal/copper veins during stone mining; beds without sheep (string).
- Seen while testing (2026-11-11 16:05 AEST): the served director model answers `defend` (p 0.87) with no hostile and no
  player attacked when `Last done`, so chores never start.

## What changes
Actuators and sensors only; no chore is chosen in code (aim: decisions in the Laya models).
- Mine: `collectOreAt` never stands on an ore with a drop > 3 under it (goal excludes the column above it; refuses
  to dig while standing on it); the mine's moves and walks use moves that never drop more than 3 blocks
  (`safeMovements`: maxDropDown 3, no parkour, fluid avoided).
- Chores: a chore given up on by an interrupt is cancelled (AsyncLocalStorage token: its actuator stops at the next
  check even after the interrupt clears); a failed craft says `stopped` when it was the interrupt.
- Placing (table, furnace, chest, beds, torches, saplings): walk near, step out of the cell next to the spot first,
  try twice, up to 3 spots for a station; the failure reason carries placeBlock's words.
- Saplings: tree feet in the work area are noted before felling; a felled tree's sapling (its kind) is planted where
  it stood, at once if carried, else by the next gather/replant chore (kept 20 min in `laya-chores.json` `stumps`).
- Veins: during gather_cobble/stock_cobble, a coal or copper vein seen (open to air, within 6, in the work area,
  pickaxe good enough) is mined whole (18-neighbour flood fill, ≤16 blocks) with the safe collect.
- Wool: the sensor's wool counts 4 string as 1 white wool; gather_wool with no sheep and make_beds craft white wool
  from string (taking string from the home chest when needed). Spiders stay the model's choice.
- Director: a `defend` answer with nothing to defend (no hostile, no player attacked) goes to the rules, logged
  `why: nothing-to-defend` (like the mine task's nonsense answers).

## Keep
"andy stop" holds chores 5 minutes or until the next command. Shelter stays out (needs the blueprint model).
