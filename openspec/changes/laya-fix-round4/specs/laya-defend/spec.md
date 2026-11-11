# laya-defend (delta)

## ADDED Requirements

### Requirement: Only attackers are fought
A mob SHALL count as attacking when it hurt andy or a player in the last 15 s (the damage's source entity; with no
source, the nearest hostile within 4 of the victim), or it is a creeper with its fuse lit within 5 of andy or a
player. The `laya_defending` mode SHALL see only attacking mobs (the defend state's Mobs); `self_defense` and
`cowardice` SHALL act only on attacking mobs. A mob attacking nobody SHALL NOT interrupt a job, however near.

#### Scenario: a skeleton attacking nobody
- **WHEN** a skeleton 12 blocks away in daytime shade attacks nobody while andy gathers
- **THEN** andy keeps gathering

#### Scenario: a zombie hits andy
- **WHEN** a zombie hits andy
- **THEN** he fights it

#### Scenario: a zombie hits the player
- **WHEN** a zombie hits tester near andy
- **THEN** andy defends tester

### Requirement: Director shared spec v1.3
The director state SHALL carry the Me line after the Hostiles line, `Me attacked yes by <kind> <dist>` (a mob that
hurt the bot in the last 5 s and is still alive, distance capped at 16) or `Me attacked no by none none`, byte for
byte as laya-go's `v1.3_sample_request.json`. The rules SHALL be v1.3's: defend only when the bot is attacked
(defend-player as v1.2), flee-low also on an attack at Health ≤ 6, heal without waiting for hostiles within 8. A
served model on prompt v1 or v1.2 SHALL be sent its own text, and where the v1.3 rules answer otherwise than v1.2's
the rules' answer SHALL stand.

#### Scenario: a far skeleton during a job
- **WHEN** a job runs, a skeleton is 12 off and nobody is attacked
- **THEN** the director answers `continue`
