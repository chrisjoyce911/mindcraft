# bot-skills

## ADDED Requirements

### Requirement: Chores picks the model, not a goal
The chores model (v2) SHALL answer with one specialised model and its target (`hunt`, `farm`, `gather
logs|seeds|wool|sand`, `mine cobble|coal|iron`, `craft <item>`, `place <thing>`) or one single step (`cook`, `store`,
`sleep`, `rest`). Each answer SHALL map 1:1 to that model or step, with no decision in code in between.

#### Scenario: hungry with a farm ready
- **WHEN** food is low, the farm is ready, and no animals are near
- **THEN** chores answers `farm` and the farm model runs; code does not choose between hunting and farming

### Requirement: Chores state is a summary
The chores state SHALL show counts by kind (not item lists) of what andy carries and of the home chest. It SHALL show
the player kit on its own line and SHALL NOT count it as available. It SHALL also show the base, the farm (exists,
ready), nearby resources and animals with the search size they were found in, the time, and the latest result of each
model (`none`, `done <age>`, `failed <reason> <age>`).

#### Scenario: kit is not stock
- **WHEN** the home chest holds a stone pickaxe that belongs to the player kit
- **THEN** it appears on the Kit line, not in the Chest counts or Tools, and craft never takes it

#### Scenario: a failure informs the next answer
- **WHEN** `craft stone pickaxe` ended `failed missing-sticks` a moment ago
- **THEN** the Results line shows `craft failed missing-sticks 0m`

### Requirement: Single-purpose skill models
Each skill model (farm, mine, craft, hunt, gather, place) SHALL do only its one skill. Its answers SHALL be parsed into
that model's typed step union. Code SHALL execute exactly one step per answer and SHALL hold no amounts, orders or recipe
chains. A skill that lacks something SHALL end `failed missing-<kind>` instead of fetching it.

#### Scenario: craft without sticks
- **WHEN** the craft model needs sticks and there are no logs or planks
- **THEN** the craft task ends `failed missing-logs`, and chores picks `gather logs`

#### Scenario: when enough
- **WHEN** `gather logs` runs with no count
- **THEN** the gather model (or its rules) decides when enough, not a number in code

### Requirement: One client and renderer per model
Every model SHALL have its own folder with a state renderer (byte-identical to laya-go's golden request), its questions,
an answer parser into a typed union, and its rules v1 as the fallback. The bot SHALL run each skill on its rules before
its model is served.

#### Scenario: a new model is added
- **WHEN** laya-go serves a new `hunt` model
- **THEN** enabling `decision_models.tasks.hunt` in settings is the only bot change

### Requirement: Corrections need no bot change
Every model's step log SHALL hold the exact state text, the answer and the outcome, so that a wrong step can become a
correction case. A short retrain from the current model through the controller `/job`, served by golaya hot reload,
SHALL then reach the bot with no code change (the prompt version is read from `/v1/models`).

#### Scenario: correcting a gather mistake
- **WHEN** `laya-gather.jsonl` shows a cut of a far tree while a near one was half cut
- **THEN** that line's state and the right answer are the correction case, and the retrained model is used after reload
