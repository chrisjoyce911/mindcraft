# laya-chores

## ADDED Requirements

### Requirement: Home and base centre
The chores centre SHALL be the bot's home, chosen in this order and then kept, across restarts, until a player sets
another (`!setHomeChest`, "andy this is your chest"):
1. the saved home (`home_chest`, or `home_table` when the home is a crafting table);
2. a chest or crafting table a player placed (the bot sees the block appear within 5 blocks of a player and nearer
   that player than anyone else), the most recent one — saved as the home and announced;
3. when it becomes idle with no home: the nearest chest, barrel or crafting table already placed within the 49×49
   columns around it — saved as the home and announced ("I'll use the chest at x y z as home.");
4. else the position of the player who last spoke to it, when that player is within 32 blocks, in the overworld, on
   solid ground, not in water or lava and with open sky above;
5. else its own position when chores start.
For 4 and 5 the position is saved as `chores_centre`; the first crafting table or chest the bot then places SHALL
become the home. When the home is a crafting table, the first chest placed or found in the base area becomes
`home_chest` (where it unloads) while the centre stays at the table.

#### Scenario: first chest placed
- **WHEN** the bot has no home, works from its own position and places a chest
- **THEN** that chest is the home chest and the centre from then on, until a player sets another

#### Scenario: player places a chest
- **WHEN** the bot has no home and chrisjoyce911 places a chest 6 blocks from the bot
- **THEN** that chest becomes the home and the bot says "I'll use your chest at x y z as home."

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

### Requirement: Player kit in the home chest
The chores sensor SHALL report which items of the player kit are in the home chest: a pickaxe, axe, shovel and sword
of the best tier the bot can make (wood, then stone, then iron), 8 cooked food and 16 torches. The chores model SHALL
choose to make and store missing kit items once the bot has its own tools of that tier and food, and SHALL upgrade
the kit when it can make a better tier (the old kit items stay in the chest). The bot SHALL NOT take kit items for its
own use or for crafting; when it takes from the home chest it leaves one kit in place.

#### Scenario: first stone tools
- **WHEN** the bot has a stone pickaxe, stone sword and cooked food, and the home chest holds no kit
- **THEN** a later chore crafts a stone pickaxe, axe, shovel and sword and stores them with 8 cooked food in the home chest

#### Scenario: kit is reserved
- **WHEN** the bot needs planks to craft and the home chest holds the kit and 20 planks
- **THEN** it takes planks only and leaves the kit's tools and food in the chest

### Requirement: Early farm by water
When water is in the work area and the bot has no farm there, the chores priority spec SHALL put "start a farm" right
after the crafting table and a wooden hoe: break grass in the work area for seeds, then till and plant 16 blocks
(4×4, or the most that fit) within 4 blocks of the water, with whatever crop it has (wheat seeds, carrots, potatoes,
beetroot seeds). The farm then counts as a farm to tend and to grow later.

#### Scenario: river beside the base
- **WHEN** the bot has a crafting table and a wooden hoe, no farm, and a river is 15 blocks from home
- **THEN** its next chores collect seeds from grass and plant a 16-block farm by the river, before stone tools

### Requirement: Replant saplings
Any sapling item on the ground in the base area SHALL be picked up and, in the next chore, planted on dirt or grass in
the base area, at least 3 blocks from other saplings and trees, never on farmland, paths or within 1 block of a placed
block. When the bot cuts a tree anywhere in the work area it SHALL plant one of the tree's saplings where the tree stood.

#### Scenario: leaves decay
- **WHEN** an oak's leaves decay 8 blocks from home and drop 2 saplings
- **THEN** the bot picks them up and plants them in the base area

#### Scenario: tree cut
- **WHEN** the bot fells a birch 30 blocks from home and picks up a birch sapling
- **THEN** it plants that sapling where the birch stood

### Requirement: Food, light and an axe first
The chores priority spec SHALL order the first day as: logs, crafting table, wooden axe and pickaxe, the early farm
(when water is in the work area), stone axe, pickaxe and furnace, food (hunt and cook to about 32), torches and
lighting the base, then chest, bed, player kit and stock. Whenever the bot carries fewer than 8 food items, a food
chore SHALL come next once it has an axe; whenever it has fewer than 8 torches, or the base is unlit and dusk is less
than about 2 minutes away, a light chore SHALL come next. With no sword the bot SHALL fight with its best axe.

#### Scenario: food runs low mid-stock
- **WHEN** the bot is gathering cobblestone for stock with a stone axe and 5 food items
- **THEN** its next chore is hunting or harvesting food, before more stock

#### Scenario: dusk with no torches
- **WHEN** it is 1 minute before dusk, the base is unlit and the bot has 2 coal and 4 sticks
- **THEN** its next chore crafts torches and lights the base

### Requirement: A bed for the player
When the bot makes its bed it SHALL also make one for the player and place both side by side in the base area (the
player's bed goes in the home chest when there is no room). The chores sensor SHALL report whether the player's bed
exists, and the chores model SHALL replace it when it is gone.

#### Scenario: first beds
- **WHEN** the bot has 6 white wool, planks and a crafting table, and no beds are placed
- **THEN** it crafts two beds and places them side by side in the base area
