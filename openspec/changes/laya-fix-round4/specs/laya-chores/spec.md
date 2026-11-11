# laya-chores (delta)

## ADDED Requirements

### Requirement: Standing still on purpose is not stuck
The `unstuck` mode SHALL be paused while andy stands still on purpose: the rest chore and the director's eat and
heal.

#### Scenario: rest
- **WHEN** andy rests 20 s at the base
- **THEN** unstuck doesn't interrupt the rest

### Requirement: One test of an unlit base
The chores sensor (`lit`) and the light_base actuator SHALL use one dark-spot test (a torch can go there and block
light is below 8). The actuator SHALL read the dark spots fresh; with none left it SHALL end done ("the base is
lit").

#### Scenario: a torch just placed
- **WHEN** the sensor said `lit no` from before the last torch's light update arrived
- **THEN** light_base finds no dark spot by the same test and ends done, not failed

### Requirement: Chores shared spec v1.1
The chores state and rules SHALL be laya-go's chores v1.1, byte for byte as `v1.1_sample_request.json`: Animals as
the smallest search (49/97/193/none) an adult of each kind is in; food-low hunts to 193, the top-up to 97; Failed
lists chores whose latest failure is under 5 minutes old, never rest or a need answer; when nothing else applies
and an item was noted missing, the answer SHALL be its need answer, not rest. A need answer SHALL tell the player
("I need wood: …", once per item per 5 minutes) and then stay like rest.

#### Scenario: no animals anywhere, food 1
- **WHEN** food is 1, the axe is stone and no animal is within 193
- **THEN** the chore is need_food and andy says he needs food
