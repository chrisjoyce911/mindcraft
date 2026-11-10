# laya-mine (delta)

## ADDED Requirements

### Requirement: Mining follows a staircase and branch-mine plan
With prompt v2, `!layaMine` SHALL mine along a plan laid out from its start position and heading: a 1-wide, 2-high staircase straight ahead down to the first level (the ore band's top, or the bot's height inside the band); at each level a main tunnel of `main_length` blocks with branches every `branch_every` blocks, `branch_length` blocks to each side; then the staircase continues `level_gap` blocks down from the end of the main tunnel and the next main tunnel runs back the other way; below the band's bottom it starts a new staircase `next_shaft` blocks to the right, climbing level by level.

#### Scenario: staircase to the first level
- **WHEN** the bot starts mining iron (band 8–24) at Y 70 heading north
- **THEN** the plan's steps are `down N` until its feet are at Y 24, then `tunnel N` for the main tunnel

#### Scenario: branches every three blocks
- **WHEN** the bot is in a main tunnel heading north at its 3rd block
- **THEN** the plan's next segments are a 16-block branch to the west and one to the east before the main tunnel continues

#### Scenario: next level
- **WHEN** a level's grid is finished at Y 24 and the band's bottom is 8
- **THEN** the plan stairs down 4 blocks ahead to Y 20 and that main tunnel runs south

#### Scenario: below the band starts again
- **WHEN** the next level would be below the band's bottom
- **THEN** the plan starts a staircase 40 blocks to the right that climbs up through the levels

### Requirement: Ore, torches and fluids still come first
The model and the rule answer SHALL still put collecting ore in sight, blocking lava or water and placing a due torch before the plan step; after collecting ore off the plan line the bot SHALL walk back to the plan before its next plan step.

#### Scenario: ore beside a branch
- **WHEN** coal is in sight two blocks off a branch
- **THEN** the bot collects it, walks back to the branch, and continues the branch

### Requirement: Unsafe plan steps skip the segment
When the plan step is unsafe (lava, water, bedrock or no floor), the bot SHALL take the safe detour the model or rule answers and the plan SHALL abandon the rest of that branch or main-tunnel segment; for a staircase it SHALL shift the staircase one block to the right.

#### Scenario: lava in a branch
- **WHEN** lava is two blocks ahead in a branch
- **THEN** the bot does not dig towards it, the branch is abandoned, and it continues with the next branch

### Requirement: Torches mark the way out
Torches SHALL be placed on the left wall in the direction of travel away from the entrance, so they are on the right walking out.

#### Scenario: torch side
- **WHEN** a torch is due while digging a main tunnel heading north from the entrance
- **THEN** the torch is placed on the west wall

### Requirement: Prompt v2 carries the plan step and the pack
With prompt v2 the state SHALL be prompt v1 with two lines after the status line, `Plan <kind> <dir>` and `Pack <free> Home <dist|none> Health <h> Food <f> Hostiles <n> Valuables <v>`, matching laya-go's golden v2 request byte for byte, and every request SHALL ask Action, Hazard and Unload (noul, "I should go and empty my pack into the home chest now."). Home is the straight-line distance to the remembered place `home_chest`, rounded up and capped at 999, or `none`; Hostiles are hostile mobs within 16 blocks, capped at 9; Valuables count diamond, emerald, raw and smelted iron and gold, raw copper, redstone and lapis lazuli, plus half the coal, capped at 999.

#### Scenario: v2 state text
- **WHEN** the bot has 5 free slots, its home chest 12 blocks away, full health and food, no mobs and no valuables, and its plan step is `tunnel E`
- **THEN** the state's third and fourth lines are `Plan tunnel E` and `Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0`

### Requirement: Unloading into the home chest
With prompt v2 the bot SHALL go to its home chest, put in everything except tools, food, torches and `keep_blocks` throwaway blocks, and walk back to the plan when the model answers Unload confidently true, or, when the model isn't confident, when laya-go's Unload rule is true (a home chest known and no lava or water touching, and 2 or fewer free slots, or 6 or fewer with home within 24 blocks, or 4 or more valuables with health 8 or less, food 6 or less or 2 or more hostile mobs). With no free slot at all it SHALL unload whatever the model says; with no home chest known it SHALL never unload. Ore put in the chest SHALL count towards the count asked for.

#### Scenario: full pack
- **WHEN** the pack has no free slot, a home chest is remembered and the model says not to unload
- **THEN** the bot unloads into the home chest and walks back to the plan

#### Scenario: no home chest
- **WHEN** no `home_chest` place is remembered
- **THEN** the state says `Home none` and the bot never unloads
