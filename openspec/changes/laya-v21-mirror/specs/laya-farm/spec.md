# laya-farm (delta)

## ADDED Requirements

### Requirement: The pond keeps away from holes
The pond cell SHALL be the nearest dry cell with no `X` beside it, or the nearest dry cell when every one has one.

#### Scenario: a hole beside the nearest dry cell
- **WHEN** the nearest dry cell has a dug hole (X) beside it and another dry cell has none
- **THEN** the pond goes on the other cell
