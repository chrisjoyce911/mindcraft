# Spec Delta

## Purpose

Defines defending with the Laya defend model in Mindcraft.

## ADDED Requirements

### Requirement: Defend state
The bot SHALL write laya-go's defend prompt v1 state and questions from its health, food, worn armour, time of day, nearby players, carried weapons, arrows, shield, golden apples and up to 4 hostile mobs within 16 blocks.

#### Scenario: Golden state
- **WHEN** the state is built for the golden situation from a fake bot, with an out-of-range zombie and a cow
- **THEN** it equals laya-go's golden request byte for byte

### Requirement: Engagement
With the defend task on, the bot SHALL ask the defend model while a mob is active and carry out confident, safe answers, ending the engagement when the mobs are calm or the model says ignore.

#### Scenario: Fighting until calm
- **WHEN** the model answers fight with a zombie within reach
- **THEN** the bot strikes it each step until no mob is active

### Requirement: Defend safety and fallback
The bot SHALL flee a creeper within 4 instead of fighting it unless strong and alone, and SHALL hand defence to the ordinary modes for `fallback_ms` on no answer, low confidence or a refused answer.

#### Scenario: Creeper override
- **WHEN** the model answers fight with a creeper 2 blocks away and a stone sword
- **THEN** the bot flees from the creeper

#### Scenario: Ignoring a threat
- **WHEN** the model answers ignore with a zombie within reach
- **THEN** the answer is refused and the ordinary modes defend for `fallback_ms`
