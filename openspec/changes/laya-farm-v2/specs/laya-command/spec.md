# laya-command (delta)

## ADDED Requirements

### Requirement: Farm command
The `farm` command SHALL run `!layaFarm(crop, n)` for a count, and `!layaFarm(crop)` (farm until stopped) when Count is `any` or `all`; Item names the crop (none for any crop).

#### Scenario: farm a count
- **WHEN** a player says "andy farm 20 wheat"
- **THEN** the bot runs `!layaFarm("wheat", 20)`

#### Scenario: farm until stopped
- **WHEN** a player says "andy go farm"
- **THEN** the bot runs `!layaFarm("any")`

### Requirement: Open-ended mining
The `mine` command with Count `any` SHALL run `!layaMine(ore)` with no count when `!layaMine` accepts a lone ore, and `!layaMine(ore, n)` with the default `mine_count` otherwise.

#### Scenario: mine until stopped
- **WHEN** a player says "andy mine some iron" and `!layaMine`'s count is optional
- **THEN** the bot runs `!layaMine("iron")`
