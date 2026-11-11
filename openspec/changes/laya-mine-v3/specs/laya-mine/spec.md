# laya-mine (delta)

## ADDED Requirements

### Requirement: Ore memory
While mining, the bot SHALL record each valuable ore block it sees within 16 blocks and doesn't mine (kind, position, tier needed, time seen) in memory `ores`, capped at `ore_memory_max`, and SHALL remove a record when that ore is collected or its block is found to be something else.

#### Scenario: Diamond seen with a stone pickaxe
- **WHEN** the bot mines iron with a stone pickaxe and a diamond ore is 6 blocks away
- **THEN** `ores` holds that diamond with tier iron

#### Scenario: Collected ore forgotten
- **WHEN** the bot later collects that diamond
- **THEN** it is no longer in `ores`

### Requirement: Opportunist grab
With prompt v3, on `grab` the bot SHALL collect the chosen valuable ore, pick up its drops and walk back onto its mine plan before the next plan step; after two failed grabs of the same block it SHALL mark it skipped.

#### Scenario: Diamond beside the tunnel
- **WHEN** an iron mine's tunnel passes a diamond ore and the bot has an iron pickaxe
- **THEN** it collects the diamond, returns to the plan line and still collects its iron

### Requirement: Recall
On `recall` the bot SHALL walk to the remembered target ore and collect it, and SHALL drop the record and continue the plan when the ore is no longer there.

#### Scenario: Gone ore
- **WHEN** the remembered iron's block is now air
- **THEN** the record is removed and the bot continues its plan

### Requirement: Upgrade before carrying on
When Upgrade is confidently true (or the rule says so when the model is unsure) and the bot is not in danger, it SHALL craft the next pickaxe tier with the craft loop, then resume the plan; when the craft fails it SHALL say so once and continue with its pickaxe, without asking again in that job.

#### Scenario: Iron in the pack
- **WHEN** the bot has a stone pickaxe and 3 raw iron and is asked to mine diamonds
- **THEN** it makes an iron pickaxe before going on, and does not stop with need-pickaxe

### Requirement: Tool choice
For every dig the bot SHALL equip the cheapest carried pickaxe that can mine the block, or the fastest such pickaxe when the job is open-ended, has a count of 16 or more, or was asked to hurry.

#### Scenario: Coal with three pickaxes
- **WHEN** the bot carries wooden, stone and iron pickaxes and mines 4 coal
- **THEN** it digs with the wooden pickaxe

#### Scenario: Hurry
- **WHEN** the same bot is asked to mine 4 coal fast
- **THEN** it digs with the iron pickaxe

### Requirement: Mine prompt v3 in the bot
With `prompt: 'v3'` the bot SHALL write laya-go's mine prompt v3 and ask its questions byte for byte as laya-go's golden requests, and the ported v3 rules SHALL decide when the model is unsure; `prompt: 'v2'` SHALL keep the v2 loop.

#### Scenario: Golden v3 state
- **WHEN** the bot reads laya-go's golden v3 situation
- **THEN** the state and questions equal `v3_sample_request.json`
