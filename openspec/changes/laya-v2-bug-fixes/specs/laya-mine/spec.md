# laya-mine (delta)

## ADDED Requirements

### Requirement: Collecting stays near the mine and away from fluids
With a mine plan, the bot SHALL collect ore only when it lies within `collect_range` blocks of the current plan cell, no water or lava touches it or the straight way to it, and the collecting since leaving the plan stays within `collect_budget` blocks. Otherwise it SHALL walk back onto the plan. The way to the ore SHALL avoid fluids.

#### Scenario: a chain of ore away from the mine
- **WHEN** ore lies 4, 14, 26 and 38 blocks from the plan's first cell in a line away from it
- **THEN** the bot collects the nearest, walks back to the plan and goes on with it

#### Scenario: ore beside water
- **WHEN** the only ore in sight has water next to it
- **THEN** the bot does not collect it

### Requirement: A full home chest is a partial unload
When the home chest and the chests touching it fill up after something went in, the unload SHALL count as partial, not as a failed step, and Unload SHALL wait `unload_retry_steps` steps.

#### Scenario: chest fills
- **WHEN** the home chest takes some items and then is full
- **THEN** the step is not a failure and the bot goes on mining

### Requirement: Torch batches
The bot SHALL craft a batch of torches whenever it carries fewer than `torch_low` torches along with coal or charcoal and sticks or wood, or when it has none left in the dark. After a failed craft it SHALL wait `torch_retry_steps` steps before trying again.

#### Scenario: low on torches
- **WHEN** the bot has 2 torches, coal and sticks
- **THEN** it crafts a batch of torches

### Requirement: A detour off the staircase never loops
When a staircase step is unsafe and the bot detours, the staircase SHALL carry on from where the detour took the bot, never walking back to the failed cell. After `max_shifts` such detours or shifts with no stair step done in between, the plan SHALL end.

#### Scenario: no floor under a stair cell
- **WHEN** the plan's `down E` has no floor and the bot detours `down S`
- **THEN** the next step is the staircase from the new cell, not a walk back
