# laya-build (delta)

## ADDED Requirements

### Requirement: Blueprint files
Blueprints SHALL be JSON files in `blueprints/` in format 1 (palette, layers bottom to top, front, size, stages, chests, needs, upkeep), and loading SHALL reject a file whose rows don't match its size, whose palette names an unknown block or a block with no build class, or whose stages, chests or targets fall outside it, naming the file and the cell.

#### Scenario: Bad row
- **WHEN** a blueprint's second layer has a row of 4 characters in a size-3 blueprint
- **THEN** loading fails with the file name, layer 1 and row index

#### Scenario: Adding a design
- **WHEN** a new valid blueprint file is added
- **THEN** `!layaBuild` can build it with no model change

### Requirement: Building a blueprint
`!layaBuild(name, stage?)` SHALL rotate the blueprint so its front faces the bot's heading at the bot's position (or the blueprint's site when set), clear and level the footprint keeping everything collected, gather its material bill from the pack, purpose chests, crafting or gathering, and place blocks one step at a time from the build model's answer (the ported answer key when unsure), stepping aside first when Danger is true.

#### Scenario: Composter
- **WHEN** the bot carries 2 logs and runs `!layaBuild("composter")`
- **THEN** it crafts 7 wooden slabs, crafts and places a composter, and reports it built

#### Scenario: Water before the hopper
- **WHEN** a blueprint has a water cell and a hopper cell in the same layer
- **THEN** the water is placed before the hopper

### Requirement: Oriented placement
Blocks with a facing SHALL be placed so their `facing` matches the rotated blueprint, and a placed block whose facing is wrong SHALL be broken and placed again.

#### Scenario: Hopper into the chest
- **WHEN** the egg collector's hopper is placed
- **THEN** its facing points into the chest

### Requirement: Check after building
After the last stage the bot SHALL compare every non-`any` cell with the blueprint, fix mismatches up to 3 rounds, and report any cells it can't fix.

#### Scenario: Knocked-out fence
- **WHEN** one fence post of a built field is missing at the check
- **THEN** the bot places it and the check passes

### Requirement: Material gate and queue
A blueprint whose raw needs include nether quartz SHALL be refused, while no quartz is carried or stored, with "I need N nether quartz for this (observers/comparators); I can't get to the Nether yet."; a blueprint missing other materials SHALL be queued in `build_queue` with what it lacks.

#### Scenario: Observer cane farm locked
- **WHEN** a player asks for `cane_observer` and andy has no quartz
- **THEN** andy says it needs nether quartz and builds nothing

#### Scenario: Short of iron
- **WHEN** a player asks for the egg collector and andy has 2 iron
- **THEN** the build is queued wanting 3 more iron, and andy says so

### Requirement: Upkeep
For each built blueprint the bot SHALL be able to run its upkeep: empty its chests into purpose chests, restock to the stated minimum, feed at the stated interval, repair mismatched cells, and report it stalled when its output count hasn't grown for `stall_minutes` while the bot was within 128 blocks.

#### Scenario: Full egg chest
- **WHEN** the egg collector's chest is full and upkeep runs
- **THEN** the eggs go to the `andy produce` chest

#### Scenario: Stalled
- **WHEN** the egg count has not grown for 30 minutes with andy nearby
- **THEN** the egg collector is reported stalled

### Requirement: First blueprints
The repository SHALL ship valid blueprints `crop_field` (fence stage and four lot stages), `shed`, `composter`, `egg_collector`, `cow_crusher`, `cane_field`, `tree_farm`, `melon_field` and `ranch` with the research note's layouts, and `cane_observer` and `chicken_cooker` locked by the quartz gate.

#### Scenario: Every shipped blueprint validates
- **WHEN** the blueprint tests load every file in `blueprints/`
- **THEN** each loads without error and its bill is derived
