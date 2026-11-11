# laya-purpose-chests (delta)

## ADDED Requirements

### Requirement: Purpose signs
A sign whose text is the bot's name followed by a known purpose (`farm tools`, `seeds`, `produce`, `mine`, `wood`, `build`), on or touching a chest or barrel within 48 blocks, SHALL register that chest under that purpose in memory `purpose_chests`; a chest whose sign is gone or changed SHALL be dropped from it.

#### Scenario: Seeds chest
- **WHEN** a sign "Andy Seeds" hangs on a chest 10 blocks away
- **THEN** that chest is a `seeds` chest

#### Scenario: Unknown purpose
- **WHEN** a sign reads "andy junk"
- **THEN** no purpose is registered and the bot does not treat it as the home chest

### Requirement: Unload by purpose
Unloading SHALL put each deposited item into the nearest chest whose purpose takes it, the rest into the home chest, spilling into touching chests when one is full, and SHALL never drop or destroy an item: with every chest full the bot SHALL keep the items and say "My chests are full: I need another chest."

#### Scenario: Mine and home
- **WHEN** the bot unloads 20 coal and 64 dirt with an `andy mine` chest and a home chest known
- **THEN** the coal goes to the mine chest and the dirt to the home chest

#### Scenario: Cobblestone is kept
- **WHEN** every chest is full and the bot carries 30 stacks of cobblestone
- **THEN** it keeps them, drops nothing and says it needs another chest

### Requirement: Home distance for the pack line
The pack line's Home SHALL be the distance to the nearest chest that takes the bot's most valuable carried item (its most carried item kind when nothing is valuable), or the home chest when none does, or `none`.

#### Scenario: Mine chest nearer than home
- **WHEN** the bot carries raw iron, the mine chest is 8 blocks away and the home chest 60
- **THEN** Home is 8

### Requirement: Take a job's kit first
Before farming, mining, tree work or a build, the bot SHALL take the job's kit (tools, seeds, saplings, parts) from the matching purpose chest, then the home chest, and craft only what is still missing.

#### Scenario: Hoe in the tools chest
- **WHEN** an `andy farm tools` chest holds an iron hoe and the bot has none
- **THEN** `!layaFarm` takes the hoe and does not craft one
