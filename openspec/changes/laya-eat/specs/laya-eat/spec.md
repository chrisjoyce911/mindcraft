# Spec Delta

## Purpose

Defines deciding when and what to eat with the Laya eat model through `laya-client`'s `eat` task: the eat state (laya-go prompt `v1`), danger, the `laya_eating` reflex, its safety rules, the fallback to `mineflayer-auto-eat`, and the measurements.

## ADDED Requirements

### Requirement: Off by default
With the `eat` task off, which is its default, the bot SHALL eat exactly as before, with `mineflayer-auto-eat`.

#### Scenario: Default settings
- **WHEN** the bot runs with default settings
- **THEN** no eat request is sent and auto-eat stays enabled

### Requirement: Eat state matches laya-go v1
The eat state SHALL be laya-go eat prompt `v1`'s text, with health rounded down (at least 1), food, saturation to one decimal place, danger, and up to six carried foods with their counts, points, true saturation and tags.

#### Scenario: Golden state
- **WHEN** the state is built for a bot with health 14, food 12, saturation 0, no danger, carrying 3 apples, 1 golden apple and 2 rotten flesh in that order
- **THEN** the text and questions equal laya-go's eat golden request

#### Scenario: True saturation
- **WHEN** cooked beef is carried
- **THEN** its line gives 8 points and 12.8 saturation

### Requirement: Eating on the model's choice
When the model confidently says eat and names a carried food that the safety rules allow, the reflex SHALL eat it, and SHALL not eat when the model confidently says not to.

#### Scenario: Eats the chosen food
- **WHEN** the model answers eat with probability 0.9 and Food `bread`, and bread is carried
- **THEN** the bot eats bread and the counter for bread rises

#### Scenario: Doesn't eat
- **WHEN** the model answers eat with probability 0.1 and Food `none`
- **THEN** the bot doesn't eat and doesn't fall back

### Requirement: Safety rules
The reflex SHALL refuse, as a veto, food that isn't carried, bad food when food is above 6, rare food when health is above 6, and eating with danger near or at full hunger unless it is a golden apple at health 6 or less.

#### Scenario: Golden apple saved
- **WHEN** health is 15 and the model chooses a golden apple
- **THEN** the bot doesn't eat it, counts a veto, and falls back

#### Scenario: Emergency golden apple in danger
- **WHEN** health is 5, danger is near, and the model chooses a golden apple
- **THEN** the bot eats it

### Requirement: Falling back to auto-eat
On no answer, low confidence, disagreeing answers or a veto, the reflex SHALL enable `mineflayer-auto-eat` for `fallback_ms` and then disable it again, counting the fallback by reason.

#### Scenario: Server down
- **WHEN** the eat task's server is unreachable
- **THEN** auto-eat is enabled and a `no-answer` fallback is counted

### Requirement: Measurements and step log
The reflex SHALL count asks, eats by food, fallbacks and vetoes by reason, and with `log_steps` on, SHALL append each decision to `bots/<name>/logs/laya-eat.jsonl`.

#### Scenario: Decision logged
- **WHEN** the reflex eats with `log_steps` on
- **THEN** a line with the state, the answer and the outcome `ate` is appended
