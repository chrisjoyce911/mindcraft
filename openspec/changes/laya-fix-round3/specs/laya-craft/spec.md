# laya-craft (delta)

## ADDED Requirements

### Requirement: The chest record follows what moved
After a take or a store, the craft loop SHALL change its record of the chest by the change in the pack (a bulk take
of 8 counts what it took). A failed take SHALL re-read the chest once and go on; a second failure of the same item
SHALL end the job with the reason.

#### Scenario: craft sward
- **WHEN** the chest has 5 planks and 14 sticks and the model asks to take 1 plank twice for a wooden sword
- **THEN** the first take is recorded as 5, the second is refused (not in the chest), andy takes a stick and
  crafts the sword

### Requirement: No more of a carried goal
A craft, gather, smelt or take of the goal item SHALL be refused (`goal-carried`) once the goal count is carried.

#### Scenario: one stone pickaxe
- **WHEN** the goal is stone_pickaxe x1, andy has just crafted one, and the model says craft stone_pickaxe again
- **THEN** the step is refused (`goal-carried`) and the job ends done with one pickaxe

### Requirement: Ingredients from the chest
A craft refused for a missing ingredient (`needs-<item>`) that the known nearby chest holds SHALL become a take of
what is missing, logged as a fallback rule step.

#### Scenario: torches with coal at home
- **WHEN** the goal is torch x4, andy has sticks and the chest has coal
- **THEN** he takes the coal from the chest and crafts the torches

### Requirement: Store everything keeps the essentials
"Store everything" (store with no item) SHALL keep coal, charcoal, torches, sticks, tools, weapons, armour and
food. Storing an item by name SHALL still store it; nothing is thrown away.

#### Scenario: put your stuff in chest
- **WHEN** andy carries coal, torches, sticks, a stone pickaxe, bread, cobblestone and bones and is told "put your
  stuff in chest"
- **THEN** he stores the cobblestone and bones and keeps the rest

### Requirement: Replies say the count
A command with count `any` SHALL say the count the job uses: "Mining 4 iron.", "Gathering 8 logs.",
"Making 1 wooden sword.". How the default count is chosen is unchanged.

#### Scenario: mine for iron
- **WHEN** the player says "mine for iron" (count any)
- **THEN** andy says "Mining 4 iron." and runs `!layaMine("iron", 4)`
