# Spec Delta

## Purpose

Defines how the bot turns player chat into commands with the Laya command model.

## ADDED Requirements

### Requirement: Contract with laya-go
The bot SHALL build the command state and questions byte for byte as laya-go's prompt v1, and SHALL resolve items exactly as laya-go's `Resolve`.

#### Scenario: Golden request
- **WHEN** the message "Andy, can you craft me 2 iron picks please?" from chrisjoyce911 reaches andy
- **THEN** the state and questions equal laya-go's v1 golden request

#### Scenario: Resolve cases
- **WHEN** the 400 pinned Resolve cases are run
- **THEN** every result equals laya-go's

### Requirement: Commands without the LLM
With the command task enabled, a player message the model answers with a command (not chat), addressed to the bot and at or above `min_confidence`, SHALL run as Mindcraft command lines without asking the LLM.

#### Scenario: Give from the inventory
- **WHEN** the model answers give, wood, all and the bot carries 5 oak logs and 12 birch logs
- **THEN** the bot runs `!givePlayer(speaker, "birch_log", 12)`

#### Scenario: Not carried
- **WHEN** the model answers give, diamond, 3 and the bot carries no diamonds
- **THEN** the bot replies that it has no diamond and runs nothing

### Requirement: Falling back
Chat, unsure answers and failures SHALL go to the LLM as before, or get a canned reply with `no_llm`; a message surely for someone else SHALL be ignored.

#### Scenario: Chat
- **WHEN** the model answers chat
- **THEN** the message goes to the LLM

#### Scenario: Someone else
- **WHEN** Addressed is below `ignore_below`
- **THEN** nothing is run or said
