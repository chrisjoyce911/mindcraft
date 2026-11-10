# laya-farm (delta)

## ADDED Requirements

### Requirement: Farm goals
`!layaFarm(crop, count)` SHALL take an optional crop (`wheat`, `carrots`, `potatoes`, `beetroot`, `any`; default `any`) and an optional count. With a count it SHALL stop once that many of the crop's produce (wheat, carrots, potatoes, beetroot; any of them for `any`) have been harvested since it started, counting what was unloaded too. With no count or `any` it SHALL farm until stopped. A lone number SHALL be read as minutes, as before.

#### Scenario: count reached
- **WHEN** the bot is asked `!layaFarm("wheat", 10)` and harvests 6 wheat, then 5 more
- **THEN** it stops after the second harvest and says it harvested 11 wheat

#### Scenario: old form
- **WHEN** the bot is asked `!layaFarm(3)`
- **THEN** it farms any crop for 3 minutes

### Requirement: Farm prompt v2
With `prompt: 'v2'` the bot SHALL write laya-go's farm prompt v2 (the `Crop` and `Pack` lines) and ask its questions (`Unload` and the v2 actions) byte for byte as laya-go's golden request; when the model is unsure, the ported v2 rules SHALL decide.

#### Scenario: golden v2 state
- **WHEN** the bot reads laya-go's golden v2 farm
- **THEN** the state and questions equal laya-go's `v2_sample_request.json`

### Requirement: Never wait forever
The bot SHALL stop after `wait_limit` waits (or unsure answers) in a row while nothing is growing in its view.

#### Scenario: dry plateau
- **WHEN** every cell is dry ground and the model answers `wait` every step
- **THEN** the bot stops after `wait_limit` steps instead of waiting out the time

### Requirement: Water for a dry farm
With a water bucket the bot SHALL be able to `pond` a dry ground cell: dig a 1-block hole there and pour the water in, refused when the water could flow out. When there is no water to farm with, the bot SHALL look for water within `water_radius` blocks, walk there and carry on; with none, it SHALL say "No water near here — take me to water or give me a water bucket" and stop. A bucket SHALL be crafted only from carried iron, and filled only from water found.

#### Scenario: no water anywhere
- **WHEN** the view has no water and no water block is within 64 blocks
- **THEN** the bot says "No water near here — take me to water or give me a water bucket" and stops

#### Scenario: water nearby
- **WHEN** the view is dry and water is 30 blocks away
- **THEN** the bot walks to it and keeps farming there

### Requirement: Unload into the home chest
When a home chest is known (memory place `home_chest`) and Unload is confidently true, or the model is unsure and the unload rule says so, or no inventory slot is free, the bot SHALL walk to the home chest, deposit everything except tools, food, buckets and up to `keep_seeds` (16) of each seed, walk back to where it was farming and continue.

#### Scenario: full pack
- **WHEN** the pack has 0 free slots and a home chest is known
- **THEN** the bot unloads at the home chest, keeps its hoe, bucket, food and 16 seeds of each kind, and walks back

#### Scenario: no home chest
- **WHEN** the pack is full and no home chest is known
- **THEN** the bot does not try to unload
