# laya-farm (delta)

## ADDED Requirements

### Requirement: Buckets are used as items
The bot SHALL pour a water bucket and fill an empty bucket by looking at the block and using the item. It SHALL report the step done only when the water or the water bucket is there.

#### Scenario: pond
- **WHEN** the bot makes a pond with a water bucket
- **THEN** the hole holds water afterwards, and the bucket is empty

### Requirement: Failed steps don't repeat forever
A vetoed or failed action SHALL be banned on its cell for `ban_steps` steps, and the rules' answer SHALL be used instead. The bot SHALL stop after `max_bad` vetoed or failed steps in a row. A pond SHALL be vetoed next to a hole or lower ground.

#### Scenario: pond beside its own hole
- **WHEN** the model picks a pond cell beside a hole again and again
- **THEN** the step is vetoed, another cell or a wait is chosen, and the bot never loops on that cell

### Requirement: Till and plant are checked
`till` SHALL report done only when the cell is farmland afterwards, and `plant` only when a crop stands on it.

#### Scenario: till didn't take
- **WHEN** the cell is still grass after tilling
- **THEN** the step is reported failed
