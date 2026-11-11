# laya-command (delta)

## ADDED Requirements

### Requirement: Sites
`!setSite(name)` SHALL save the speaker's position (the bot's when there is no speaker) as the remembered place `site_<name>` for `farm`, `trees`, `mine`, `ranch`, `cane`, `melons` or `base`, replacing any earlier one, and reply "The <name> site is at x y z."; the command model's `site` answer SHALL run it.

#### Scenario: Put the farm here
- **WHEN** chrisjoyce911 stands at 200 64 150 and says "andy put the farm here"
- **THEN** `site_farm` is 200 64 150 and andy says "The farm site is at 200 64 150."

### Requirement: Wood
`!layaTrees(count?)` SHALL fell the tree farm's grown trees when one exists, otherwise wild birch then oak within 48 blocks of home or the trees site, collecting saplings and apples, replanting saplings where trees stood, until `count` logs or no tree is in range, and unload into the wood chest or the home chest.

#### Scenario: Go get wood
- **WHEN** a player says "andy go get wood" near a birch wood and there is no tree farm
- **THEN** andy cuts birch, collects saplings, replants and his log count goes up

### Requirement: Ore memory commands
`!listOres(kind?)` SHALL report remembered ores by kind with the nearest distance and needed tier, and `!goToOre(kind, count?)` SHALL walk to and mine remembered ores of that kind, upgrading the pickaxe first when needed or saying what it lacks.

#### Scenario: The diamonds you saw
- **WHEN** a diamond ore is in ore memory, andy carries an iron pickaxe and a player says "andy go get the diamonds you saw"
- **THEN** andy runs `!goToOre("diamond")` and comes back with a diamond

#### Scenario: Nothing remembered
- **WHEN** ore memory is empty and `!listOres` runs
- **THEN** andy says "I haven't seen any ores to come back for."

### Requirement: Stock
`!stock(item?)` SHALL count an item across the pack, the home chest and purpose chests and reply with the total and where it is, or list the top 8 kinds without an item.

#### Scenario: How much iron
- **WHEN** andy carries 3 iron ingots and the mine chest holds 20
- **THEN** "andy how much iron have we got" gets "We have 23 iron: 3 on me, 20 in the mine chest."

### Requirement: Command v3 mapping
With command `prompt: 'v3'` the bot SHALL ask laya-go's command prompt v3 byte for byte and map chores, site, build, wood, ores, goto_ore and stock to `!layaChores`, `!setSite`, `!layaBuild`, `!layaTrees`, `!listOres`, `!goToOre` and `!stock`; a build answer with item none SHALL fuzzy-match the message against blueprint names, else reply "I don't know how to build that yet."

#### Scenario: Build by chat
- **WHEN** a player says "andy build a composter"
- **THEN** andy runs `!layaBuild("composter")`

#### Scenario: Unknown build
- **WHEN** a player says "andy build a lighthouse" and no blueprint matches
- **THEN** andy says "I don't know how to build that yet."

#### Scenario: Hurry
- **WHEN** a player says "andy mine iron quickly"
- **THEN** andy runs `!layaMine("iron", "fast")` with the fastest pickaxe
