# laya-farm (delta)

## ADDED Requirements

### Requirement: Planned fields
With prompt v3 a field SHALL be 23×23 outside its fence with a gate in the middle of its front side, a path ring inside the fence, a path cross, four 9×9 lots and 9 torches on fence posts, built through `laya-build` stages, at the remembered site for its kind or, without one, the flattest 23×23 ground within `field_search_radius` of the home chest.

#### Scenario: First crop field
- **WHEN** andy starts v3 farming with no field, a home chest and flat ground beside it
- **THEN** he builds the fence stage and lot A there and records the field in `farms`

#### Scenario: No room
- **WHEN** no 23×23 flat ground is within 32 blocks
- **THEN** andy says he can't fit a field here and farms freeform as in v2

### Requirement: Lot templates
Lots SHALL be planted from their templates: alternating crop rows with centre water under a slab (80 plants), cane beside three slab-covered channels (54), alternating melon and pumpkin stem rows with water in the middle column (36 stems), birch saplings 1 block down every 3 blocks (9 trees), or a 7×7 pen; the `lot` Item SHALL resolve to the template's crop for that cell.

#### Scenario: Alternating rows
- **WHEN** andy replants an empty cell in an odd row of a wheat/carrots lot
- **THEN** he plants a carrot

### Requirement: Farm prompt v3 in the bot
With `prompt: 'v3'` the bot SHALL write laya-go's farm prompt v3 (Time, Field, Lot, Pen and Stock lines from the farm map, the walk-round and purpose chests) and ask its questions byte for byte as laya-go's golden requests; the ported v3 rules SHALL decide when the model is unsure; `prompt: 'v2'` SHALL keep the v2 loop.

#### Scenario: Golden v3 state
- **WHEN** the bot writes laya-go's golden v3 situation
- **THEN** state and questions equal `v3_sample_request.json`

### Requirement: Improvement actions
The bot SHALL carry out `mend` (gate, fence, slab over water, re-till, torch on a path or post, never on farmland), `cull`, `shear`, `eggs`, `fell` (whole trunk, saplings and apples collected, replanted 1 down), `compost` (surplus only, never breeding food), `expand` (build the next lot stage) and `seeds`, walking to the answer's Lot first when it is elsewhere.

#### Scenario: Open gate
- **WHEN** the field's gate is open and lot A is ripe
- **THEN** andy closes the gate before harvesting

#### Scenario: Fell a birch
- **WHEN** a grown birch stands in a tree lot
- **THEN** andy cuts every log, collects the saplings and replants one where the tree stood

#### Scenario: Compost keeps breeding wheat
- **WHEN** andy carries 40 wheat seeds and 10 wheat with cows in the ranch
- **THEN** he composts 24 seeds and no wheat

### Requirement: Pen gates
Before opening a pen gate the bot SHALL put the animals' food away, and SHALL close every gate it opens.

#### Scenario: Leaving the cow pen
- **WHEN** andy has bred two cows and walks out of the pen
- **THEN** the gate is closed behind him and no cow follows him out
