# laya-craft (delta)

## ADDED Requirements

### Requirement: The player kit is not in the chest for the craft task
The craft task's chest read SHALL leave out the player kit reserved in the home chest, so a kit item is
"not in chest" and the recipe rules make it instead.

#### Scenario: a stone sword with the kit's sword at home
- **WHEN** andy has 80 logs, 1 plank, 0 sticks, 122 cobblestone and the home chest holds only the kit's stone sword,
  and the craft model says `take stick`
- **THEN** he crafts planks, sticks and the stone sword, and takes nothing from the kit

### Requirement: The recipe rules alone when the model path fails
When a Laya task's craft through the craft model fails, `craftForTask` SHALL run the recipe rules alone (no model),
making the ingredients first (logs → planks → sticks), before Mindcraft's single-recipe craft.

#### Scenario: torches with no sticks
- **WHEN** make_torches runs with 80 logs, 31 coal and no sticks
- **THEN** he crafts planks, sticks and torches
