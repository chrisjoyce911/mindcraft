# laya-jobs (delta)

## ADDED Requirements

### Requirement: An interrupted Laya job resumes
A Laya job (`!layaMine`, `!layaFarm`, `!layaCraft`, `!layaGather`) interrupted by a mode SHALL resume with the
same arguments and the remaining count once the mode is done, with no LLM call, also when the interrupt
aborted a dig or a path. A new command or `!stop` SHALL replace it; a death SHALL end it.

#### Scenario: defend during a mine job
- **WHEN** laya_defending interrupts `!layaMine("iron", 9)` mid-dig after 3 raw iron
- **THEN** once the fight is over andy goes on mining iron until he has the other 6
