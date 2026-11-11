# laya-director (delta)

## ADDED Requirements

### Requirement: Nothing to defend
A model answer `defend` with no hostile counted and no player attacked SHALL be replaced by the rules' answer and
logged with `why: nothing-to-defend`; a model answer `eat` at food 20 (Minecraft won't let him eat) likewise, with
`why: not-hungry`.

#### Scenario: idle after a chore
- **WHEN** nothing is near, `Last done`, and the model answers defend
- **THEN** the director answers idle (rules) and chores go on
