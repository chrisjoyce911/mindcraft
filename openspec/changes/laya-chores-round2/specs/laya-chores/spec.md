# laya-chores (delta)

## ADDED Requirements

### Requirement: A stopped chore stops
A chore runChore has given up on (an interrupt) SHALL do nothing more, even when a skill under it returns after the
interrupt has cleared. A craft that failed because of the interrupt SHALL be reported `stopped`.

#### Scenario: unstuck during craft_stone_tools
- **WHEN** unstuck interrupts the chore while the stone axe is being crafted
- **THEN** the chore ends `stopped` and no stone pickaxe is crafted after it

### Requirement: Placing tries again
The place actuators SHALL step out of the cell next to the spot before placing, try each spot twice and a station up
to 3 spots; a failure SHALL carry placeBlock's reason.

#### Scenario: furnace after a pit
- **WHEN** andy is in a pit 6 blocks from the base and place_furnace runs
- **THEN** he walks up, places the furnace, or fails with the reason (e.g. "couldn't get near 156 70 161")

### Requirement: A sapling where a tree stood
When andy fells a tree whose foot is in the work area, a sapling of its kind SHALL be planted where it stood, at
once if carried, else by the next gather_logs or replant_saplings within 20 minutes.

#### Scenario: oak felled
- **WHEN** gather_logs cuts an oak on grass 10 blocks from the centre and an oak sapling drops
- **THEN** that sapling is planted on the oak's foot

### Requirement: Whole veins
During gather_cobble and stock_cobble, a coal or copper vein seen (open to the air, within 6, in the work area) SHALL
be mined whole (≤16 blocks) when the pickaxe can, with the mine's safe collect.

#### Scenario: coal in the stone face
- **WHEN** andy digs cobblestone and a 5-block coal vein shows in the face
- **THEN** he mines all 5 coal ore before going on with the stone

### Requirement: Wool from string
The sensor SHALL count 4 string as 1 white wool. With no sheep near, gather_wool SHALL craft white wool from carried
(or home chest) string; make_beds SHALL do the same when it lacks 3 wool of one colour.

#### Scenario: beds with no sheep
- **WHEN** no sheep are near and andy carries 24 string
- **THEN** the sensor says wool 6, and make_beds crafts white wool and two beds
