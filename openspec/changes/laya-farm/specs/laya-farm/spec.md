# Spec Delta

## Purpose

Defines farming with laya-go's farm decision model in Mindcraft.

## ADDED Requirements

### Requirement: Farm state
The bot SHALL write laya-go's farm prompt v1 from the world, byte for byte: the 9×9 cells around it, its carried items and the adult animals within 16, with the same Target and Item options.

#### Scenario: Golden state
- **WHEN** the bot reads laya-go's golden farm with an iron hoe, bone meal, wheat seeds, carrots and stone, two cows, three pigs, a calf and a far sheep
- **THEN** the state and questions equal laya-go's golden request

### Requirement: Safe farming
An answer SHALL be carried out only when its target fits its action; movement SHALL avoid farmland and crops; water SHALL only go into a hole whose sides hold it.

#### Scenario: Veto
- **WHEN** the model says till the cell the bot stands on (a path)
- **THEN** the step is refused with reason `not-tillable`

### Requirement: Getting what farming needs
Before farming, and whenever an answer needs an item the bot doesn't carry, the bot SHALL get it through `craft(item, count)` and read again.

#### Scenario: Starter kit
- **WHEN** farming starts with nothing carried
- **THEN** the bot crafts a hoe and gets wheat seeds first, and a water bucket when the model says water

### Requirement: Off by default
The farm task SHALL be off in the default settings, and `!layaFarm` SHALL then do nothing.

#### Scenario: Default settings
- **WHEN** the settings are the defaults
- **THEN** there is no farm task
