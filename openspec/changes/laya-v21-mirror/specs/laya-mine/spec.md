# laya-mine (delta)

## ADDED Requirements

### Requirement: v2.1 mine rules
With a plan the rules SHALL collect only ore seen within 12 blocks, and SHALL answer `stop` (rule `low-health`)
for a step down at health 8 or less; the bot SHALL then heal (eat, retreat, wait, or stop and ask for food).

#### Scenario: hurt on the staircase
- **WHEN** the plan step is down and health is 6
- **THEN** the rules answer stop with rule low-health and andy heals before going on
