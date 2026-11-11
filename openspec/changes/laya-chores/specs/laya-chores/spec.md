# laya-chores

## ADDED Requirements

### Requirement: Home and base centre
The chores centre SHALL be the bot's home, chosen in this order and then kept, across restarts, until a player sets
another (`!setHomeChest`, "andy this is your chest"):
1. the saved home (`home_chest`, or `home_table` when the home is a crafting table);
2. when it becomes idle with no home: the nearest chest, barrel or crafting table already placed within the 49×49
   columns around it — saved as the home and announced ("I'll use the chest at x y z as home.");
3. else the position of the player who last spoke to it, when that player is within 32 blocks, in the overworld, on
   solid ground, not in water or lava and with open sky above;
4. else its own position when chores start.
For 3 and 4 the position is saved as `chores_centre`; the first crafting table or chest the bot then places SHALL
become the home. When the home is a crafting table, the first chest placed or found in the base area becomes
`home_chest` (where it unloads) while the centre stays at the table.

#### Scenario: first chest placed
- **WHEN** the bot has no home, works from its own position and places a chest
- **THEN** that chest is the home chest and the centre from then on, until a player sets another

#### Scenario: table already there
- **WHEN** the bot becomes idle with no home and a crafting table stands 15 blocks away
- **THEN** the table becomes the home and the base area is the 21×21 around it

#### Scenario: no home, player on the surface
- **WHEN** no home is set, no chest or table is within 49×49, and chrisjoyce911 stands on grass 10 blocks away
- **THEN** chores use chrisjoyce911's position as the centre

#### Scenario: player underground
- **WHEN** no home is set, nothing is placed nearby and the only player is in a cave
- **THEN** chores use the bot's own position

### Requirement: Areas
The base area SHALL be the 21×21 columns around the centre and the work area the 49×49 columns around it. A farm with
any of its cells in the work area SHALL be tended. When a needed resource is not in the work area, the search for that
resource SHALL grow to 97×97 and then 193×193, and return to 49×49 once it is found or the chore ends.

#### Scenario: no trees nearby
- **WHEN** the chores model asks for logs and no log is within the 49×49 work area
- **THEN** the bot searches 97×97 for logs and says it is going further for wood

### Requirement: Chores start when idle
With `chores` on and no job on the stack, when the director answers `idle` the bot SHALL ask the chores model for the
next chore, run it as a job of kind `chore`, and ask again when it ends. Each decision SHALL be logged to
`laya-chores.jsonl` with its source (model or rules).

#### Scenario: nothing to do
- **WHEN** the bot has been given no job and it is day
- **THEN** within 5 seconds it starts a chore instead of standing still

### Requirement: Interrupts
A player command SHALL stop the running chore at once and take its place; the chore SHALL NOT resume until the
player's job ends. A director safety activity or a player being attacked SHALL pause the chore, which resumes after.

#### Scenario: player gives a job
- **WHEN** the bot is gathering wood as a chore and a player says "andy come here"
- **THEN** it stops gathering within 1 second and follows

### Requirement: Chat on and off
"andy do your chores" SHALL turn chores on and "andy take a break" off (command model intents `chores_on`,
`chores_off`), saved across restarts.
