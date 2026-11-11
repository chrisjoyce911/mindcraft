# laya-mine (delta)

## ADDED Requirements

### Requirement: Never dig its own floor over a drop
The mine's collect step SHALL NOT dig the block the bot stands on when the air under that block (or under a one-block
floor below it) is deeper than 3; it SHALL dig it from a neighbouring cell, or fail the step. The mine's moves and
walks SHALL never step off a drop of more than 3 blocks.

#### Scenario: coal over a cave
- **WHEN** andy stands on coal ore with a 10-block shaft under it and the mine says collect
- **THEN** he steps to a side cell, digs the ore from there and stays at its height (the drop may be lost down the shaft)
