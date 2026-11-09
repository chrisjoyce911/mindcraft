# Spec Delta

## Purpose

Defines following a player with a Laya decision model: settings, the decisions client, the follow state built from the world (laya-go prompt `v1`), the safety veto, the fallback rules, and the session measurements and step log.

## ADDED Requirements

### Requirement: Off by default
The `laya` settings block SHALL default to `enabled: false`, and with it off `!followPlayer` SHALL behave exactly as before this change.

#### Scenario: Default settings
- **WHEN** the bot follows a player with default settings
- **THEN** no request is sent to a Laya server and the existing pathfinder follow runs

### Requirement: Decisions client
The client SHALL post the state, both follow questions and the configured model to the configured URL, and SHALL return the answers, or nothing when the request fails, times out after `timeout_ms`, or returns a malformed reply.

#### Scenario: Timeout
- **WHEN** the server takes longer than `timeout_ms` to answer
- **THEN** the client returns nothing and the follow loop falls back

#### Scenario: Questions match laya-go
- **WHEN** the client sends a request
- **THEN** its questions deep-equal those in laya-go's `v1` golden request

### Requirement: Follow state matches laya-go v1
The follow state SHALL be laya-go prompt `v1`'s text: `Follow.`, the player line, and nine rows of nine cell characters, with each cell's surface and height relative to the bot clamped to ±8 in laya-go's alphabet, and the bot's cell `0`, or `W` in water.

#### Scenario: Golden state
- **WHEN** the state is built from a fake world holding laya-go's golden sample terrain, with the bot and player where the golden request has them
- **THEN** the text equals the golden request's `state` byte for byte

#### Scenario: Clamping
- **WHEN** a column's stand block is 11 blocks above the bot's
- **THEN** its cell is `8`

### Requirement: Columns from the world
Each column SHALL be read as follows:
- the first standable block (solid, water or lava) with two passable blocks above, scanning from 8 above the bot's base down to 8 below;
- harmful (`!`) when that block or its headroom is lava, fire, magma, campfire, cactus, sweet berry bush, powder snow or wither rose;
- a wall when a fence, wall, fence gate or closed door blocks the scan;
- ground at −8 when there is nothing to stand on within 8 below;
- ground at +8 when it is solid throughout;
- unknown (`?`) when any block needed is unloaded.

#### Scenario: Fence
- **WHEN** a column at the bot's level holds a fence
- **THEN** its cell reads as two or more above the bot

#### Scenario: Magma
- **WHEN** a column's stand block is magma at the bot's level
- **THEN** its cell is `!`

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
The loop SHALL use the existing pathfinder follow for `fallback_ms` and then return to the model when: there is no answer; the top `Move` probability is below `min_confidence`; the top move is `wait` for more than two steps in a row while the bot hasn't arrived; the move is vetoed; or a step doesn't move the bot within 1.5 seconds. Each fallback SHALL be counted by its reason.

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
