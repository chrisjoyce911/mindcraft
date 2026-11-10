# laya-home-chest (delta)

## ADDED Requirements

### Requirement: Setting the home chest
`!setHomeChest` SHALL save, as the remembered place `home_chest`, the exact block position of the chest (chest, trapped chest or barrel) nearest to the player who sent the last message (the bot itself when there is none) within 8 blocks, and reply "Home chest set at x y z."; with no chest there it SHALL reply "I can't see a chest near you." and save nothing.

#### Scenario: chest by the player
- **WHEN** chrisjoyce911 stands 2 blocks from a chest at 10 64 -3 and the bot runs `!setHomeChest`
- **THEN** `home_chest` is 10 64 -3 and the bot says "Home chest set at 10 64 -3."

### Requirement: Chat "home" command
The command game's `home` command SHALL run `!setHomeChest` and reply "That's my chest now." when it worked, or the command's own reply when it didn't.

#### Scenario: this is your chest
- **WHEN** a player standing by a chest says "andy this is your chest"
- **THEN** the bot runs `!setHomeChest` and says "That's my chest now."

### Requirement: Home chest from a sign
When a task needs the home chest and none is saved, the bot SHALL look within 32 blocks for a sign whose text contains its name (any case) with a chest within 1 block, save that chest as `home_chest` and say so; it SHALL look at most every 30 seconds.

#### Scenario: signed chest
- **WHEN** no home chest is saved and a sign reading "ANDY stuff" hangs on a barrel 12 blocks away
- **THEN** the barrel becomes the home chest and the bot says where it is

### Requirement: Full home chest
When the home chest is full (or won't open), unloading SHALL go on into the chests touching it (the other half of a double chest, chests beside, above or below it) before giving up.

#### Scenario: spill over
- **WHEN** the home chest has room for 10 wheat and a barrel sits on top of it
- **THEN** 30 wheat go 10 into the chest and 20 into the barrel
