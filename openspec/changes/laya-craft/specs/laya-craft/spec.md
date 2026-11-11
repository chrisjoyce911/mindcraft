# Spec Delta

## Purpose

Defines crafting, gathering and storage with a Laya craft model (laya-go craft prompt `v2`).

## ADDED Requirements

### Requirement: Craft state
The craft state SHALL match laya-go's craft prompt `v2` byte for byte for the same situation, with logs and planks of every wood as `log` and `planks`.

#### Scenario: Golden request and generated situations
- **WHEN** the state and questions are built for laya-go's golden situation and 300 of its generated situations
- **THEN** they equal laya-go's

### Requirement: Step loop
`runCraft` SHALL ask for the next step and do it until the model says done with the goal carried. It SHALL stop with a reason, without acting, on no answer, a low-confidence answer, an impossible step, done without the goal, or too many steps.

#### Scenario: Impossible step
- **WHEN** the model says to gather iron without a stone pickaxe
- **THEN** the run stops with `needs-pickaxe` and nothing is done

#### Scenario: Storage
- **WHEN** the model says to store dirt and a chest is near
- **THEN** all of the dirt is put in the chest

### Requirement: Off by default
With the craft task off, `!layaCraft` and `!layaGather` SHALL report that the task is off and do nothing.

#### Scenario: Task off
- **WHEN** `!layaCraft("iron_pickaxe", 1)` runs with the task off
- **THEN** the bot says the craft task is off
