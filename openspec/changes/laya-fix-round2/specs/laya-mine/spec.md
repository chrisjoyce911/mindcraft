# laya-mine (delta)

## ADDED Requirements

### Requirement: The staircase goes deep before branching
The mine plan SHALL staircase down to at least `surface_depth` (10) blocks below the entrance and to the ore's
best level (coal 45, copper 48, iron 16, lapis 0, gold -16, redstone -58, diamond -58), clamped to the ore's
band, before its first grid level.

#### Scenario: coal from the surface
- **WHEN** a coal mine starts at Y 70
- **THEN** the first grid level is at Y 45, not 70

### Requirement: Mining stops to heal and never steps onto a drop
With health at or below `heal_health` (8) the mine SHALL take a `heal` rule step instead of digging: eat until food
reaches `eat_to` (18), retreat to the mine entrance when hostiles are near, and wait up to `heal_wait_s` (60) to
regenerate; with no food it SHALL stop and ask for food. A move whose cell has more than `max_drop` (3) air below
it, also under a one-block floor, SHALL be vetoed (`drop`) for the model and the rules. After `floor_vetoes` (2)
floor vetoes in a row on a staircase going down, the descent SHALL stop and the level SHALL start there.

#### Scenario: hurt at Health 4 with no food
- **WHEN** andy mines at Health 4 with no food and a skeleton near
- **THEN** he walks back to the entrance, says he needs food and stops mining
