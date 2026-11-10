# laya-craft (delta)

## ADDED Requirements

### Requirement: Craft success on the settled inventory
A Laya craft or smelt step SHALL count as done when the carried count of its generic item has gone up once the inventory has settled after the craft (the next slot update, at most 500 ms), and SHALL log the before and after counts with the step.

#### Scenario: Late inventory update
- **WHEN** a fake bot crafts planks from logs and its inventory update arrives 100 ms after the craft call resolves
- **THEN** the step is logged `did` with before 0 and after 4, and the loop continues

#### Scenario: Baseline stone pickaxe
- **WHEN** the bot has cobblestone x3, a crafting table and 2 logs and is asked for a stone pickaxe
- **THEN** the craft loop does not stop at `craft planks failed` and ends with a stone pickaxe

#### Scenario: Nothing crafted
- **WHEN** the craft call makes nothing
- **THEN** the step is logged `failed` with equal before and after counts
