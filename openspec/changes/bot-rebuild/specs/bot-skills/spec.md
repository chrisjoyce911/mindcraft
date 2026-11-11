# bot-skills

## ADDED Requirements

### Requirement: Chores names the model
The chores model (v2, laya-go skills-spec v1 §1) SHALL answer `Skill` and `Target`. Skill is one of hunt, farm, gather,
mine, craft, place, cook, store, sleep, ask or rest. Each (skill, target) SHALL map 1:1 to one model run or one rules
actuator, with no decision in code in between.

#### Scenario: hungry with a farm ready
- **WHEN** food is below 8, the farm is ready, and andy has an axe
- **THEN** chores answers `farm tend` and the farm model runs; code does not choose between hunting and farming

### Requirement: Chores state is a summary
The chores state SHALL be skills-spec v1's 13 lines, byte for byte. It SHALL include `Carry` and `Chest` (counts by
kind, with the chest less the reserved kit), `Made`, `Kit` (on its own line, never counted as available), base, farm,
tools, near, animals and `Last` (the latest results of runs in the last 10 minutes).

#### Scenario: kit is not stock
- **WHEN** the home chest holds the stone pickaxe reserved for the player kit
- **THEN** it appears on the Kit line, not in Chest, and no job takes it

#### Scenario: a failure informs the next answer
- **WHEN** `craft stone_sword` ended `failed:missing_sticks` a minute ago
- **THEN** the Last line shows `craft stone_sword failed:missing_sticks 1`

### Requirement: Single-purpose skill models
Each skill model (hunt, gather, place, craft, farm, mine) SHALL do only its one skill, with its answers parsed into that
model's typed step union. Code SHALL execute one step per answer and SHALL hold no amounts, orders or recipe chains. A
run SHALL end in `done` or `failed:<reason>`, with the reason from skills-spec's closed list. A chore's craft run that
answers `gather <x>` SHALL end `failed:missing_<x>` instead of fetching it.

#### Scenario: craft without logs
- **WHEN** a chore's craft run needs sticks and the craft model answers `gather log`
- **THEN** the run ends `failed:missing_logs`, and chores (rules v2) picks `gather logs`

#### Scenario: gather to a goal
- **WHEN** `gather logs` runs with the goal from the chores rules
- **THEN** the gather job steps until `have ≥ goal` (done) or `give_up`; no count is fixed in code

### Requirement: One client and renderer per model
Every model SHALL have its own folder: a state renderer (byte-identical to laya-go's golden request), its questions, an
answer parser into a typed union, and its rules as the fallback. The bot SHALL run each skill on its rules before its
model is served.

#### Scenario: a new model is served
- **WHEN** laya-go serves a new `hunt` model
- **THEN** enabling `decision_models.tasks.hunt` in settings is the only bot change

### Requirement: Corrections need no bot change
Every model's step log SHALL hold the exact state text, the answer and the outcome, so that a wrong step can become a
correction case. A short retrain from the current model through trainctl `POST /job`, served by golaya hot reload, SHALL
reach the bot with no code change.

#### Scenario: correcting a craft miss
- **WHEN** `laya-craft.jsonl` shows `take stick` with logs and no sticks
- **THEN** that line's state and the right answer are a generator case, and the retrained model is used after reload
