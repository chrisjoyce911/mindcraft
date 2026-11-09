# Spec Delta

## Purpose

Defines the bot's mine task: the state it sends, how it runs and checks steps, and what it crafts.

## ADDED Requirements

### Requirement: Mine state
The mine state SHALL equal laya-go's mine prompt v1 for the same blocks, byte for byte, and the rules port SHALL give laya-go's answers.

#### Scenario: Golden state
- **WHEN** the state is built for laya-go's golden scene
- **THEN** it equals laya-go's golden request's state and questions

#### Scenario: Rules agree
- **WHEN** the rules port decides 300 laya-go generated situations
- **THEN** every action and hazard matches laya-go's

### Requirement: Safe steps
The loop SHALL never run a step the veto calls unsafe, SHALL never dig straight down, and SHALL take the rule answer when the model's step is vetoed, unconfident, missing or makes no sense.

#### Scenario: Lava ahead
- **WHEN** the model says `tunnel E` and lava is two blocks east
- **THEN** the step is vetoed and the bot tunnels south

#### Scenario: Staircase
- **WHEN** the bot goes down three steps
- **THEN** each step digs only the column ahead

### Requirement: Crafting what it needs
The loop SHALL craft the pickaxe the ore needs before starting (and stop without asking the model if it can't), and SHALL craft torches when it runs out of them in the dark.

#### Scenario: Iron with a wooden pickaxe
- **WHEN** the bot mines iron with only a wooden pickaxe
- **THEN** it crafts a stone pickaxe first

#### Scenario: Out of torches
- **WHEN** eight blocks are dark and it has no torches
- **THEN** it crafts torches and places one
