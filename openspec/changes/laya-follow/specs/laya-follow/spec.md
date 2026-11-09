# Spec Delta

## Purpose

Defines following a player with a Laya decision model through `laya-client`'s `follow` task: the follow state built from the world (laya-go prompt `v1`), the safety veto, the fallback rules, and the session measurements and step log.

## ADDED Requirements

### Requirement: Off by default
With the `follow` task off (its default in `laya-client`), `!followPlayer` SHALL behave exactly as before this change.

#### Scenario: Default settings
- **WHEN** the bot follows a player with default settings
- **THEN** no decision request is sent and the existing pathfinder follow runs

### Requirement: Asking through the follow task
The loop SHALL ask the `follow` task through `laya-client` with the state and laya-go `v1`'s two questions, and SHALL treat no answer as a fallback with the client's reason.

#### Scenario: Server down
- **WHEN** the follow task's server is unreachable
- **THEN** the loop falls back with reason "no answer" and the bot keeps following with the pathfinder

### Requirement: Follow state matches laya-go v1
The follow state SHALL be laya-go prompt `v1`'s text: `Follow.`, the player line, and nine rows of nine cell characters, with each cell's surface and height relative to the bot clamped to ±8 in laya-go's alphabet, and the bot's cell `0`, or `W` in water.

#### Scenario: Golden state
- **WHEN** the state is built from a fake world holding laya-go's golden sample terrain, with the bot and player where the golden request has them
- **THEN** the text equals the golden request's `state` byte for byte

#### Scenario: Clamping
- **WHEN** a column's stand block is 11 blocks above the bot's
- **THEN** its cell is `8`

### Requirement: Columns from the world
Each column SHALL be read as the first standable block (solid, water or lava) with two passable blocks above, scanning from 8 above the bot's base down to 8 below, with its height relative to the bot's base.

#### Scenario: Step up
- **WHEN** a column's first standable block with headroom is one above the bot's base
- **THEN** its cell is `1`

### Requirement: Harmful blocks
A column SHALL be harmful (`!`) when its stand block or headroom is lava, fire, magma, campfire, cactus, sweet berry bush, powder snow or wither rose.

#### Scenario: Magma
- **WHEN** a column's stand block is magma at the bot's level
- **THEN** its cell is `!`

### Requirement: Walls, drops and unknown columns
A fence, wall, fence gate or closed door blocking the scan SHALL make the column a wall. Nothing to stand on within 8 below SHALL make it ground at −8, and solid throughout SHALL make it ground at +8. A column with any needed block unloaded SHALL be unknown (`?`).

#### Scenario: Fence
- **WHEN** a column at the bot's level holds a fence
- **THEN** its cell reads as two or more above the bot

#### Scenario: Deep drop
- **WHEN** a column is air from 8 above the bot down to 8 below
- **THEN** its cell is `H`

#### Scenario: Unloaded
- **WHEN** a column's chunk isn't loaded
- **THEN** its cell is `?`

### Requirement: Safety veto
Before stepping, the loop SHALL refuse a move that laya-go's rules call harmful or illegal on the same grid: onto `!` or `?`, a climb of two or more, a drop of four or more onto anything but water, or a diagonal that climbs or passes a neighbour that is not enterable, is harmful, or is higher than the bot. A refused move SHALL count as a veto and fall back.

#### Scenario: Lava step refused
- **WHEN** the model's top move steps onto `!`
- **THEN** the bot doesn't take it, a veto is counted, and the loop falls back

#### Scenario: Harmful drop refused
- **WHEN** the top move drops four blocks onto ground
- **THEN** the move is vetoed

#### Scenario: Drop into water allowed
- **WHEN** the top move drops six blocks into water
- **THEN** the move is not vetoed

### Requirement: Falling back
The loop SHALL use the existing pathfinder follow for `fallback_ms` and then return to the model when: there is no answer; the `Move` answer isn't confident (below the task's `min_confidence`); the top move is `wait` for more than two steps in a row while the bot hasn't arrived; the move is vetoed; or a step doesn't move the bot within 1.5 seconds. Each fallback SHALL be counted by its reason.

#### Scenario: Low confidence
- **WHEN** the model's top move has probability 0.2 and `min_confidence` is 0.4
- **THEN** the loop falls back with reason "low confidence"

#### Scenario: Arrived waits without asking
- **WHEN** the bot is within the follow distance of the player
- **THEN** it doesn't ask the model and doesn't move

### Requirement: Measurements and step log
Each follow session SHALL count steps asked and taken, fallbacks by reason, vetoes, damage taken and seconds stuck, and log them when the follow ends. With `log_steps` on, each step SHALL append one JSON line to `bots/<name>/logs/laya-follow.jsonl` with the time, state, top move and its probability, hazard probability, and outcome.

#### Scenario: Step logged
- **WHEN** the loop takes a step with `log_steps` on
- **THEN** one line with the state, the top move and the outcome "stepped" is appended to the step log
