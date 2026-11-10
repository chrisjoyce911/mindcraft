# laya-jobs (delta)

## ADDED Requirements

### Requirement: An interrupted Laya job resumes
A Laya job (`!layaMine`, `!layaFarm`, `!layaCraft`, `!layaGather`) interrupted by a mode SHALL resume with the
same arguments and the remaining count once the mode is done, with no LLM call, also when the interrupt
aborted a dig or a path. A new command or `!stop` SHALL replace it; a death SHALL end it.

#### Scenario: defend during a mine job
- **WHEN** laya_defending interrupts `!layaMine("iron", 9)` mid-dig after 3 raw iron
- **THEN** once the fight is over andy goes on mining iron until he has the other 6

### Requirement: One decision point for the next activity
The agent SHALL keep a job stack (the current Laya job, and a safety activity paused over it) and SHALL ask one
decision point, `nextActivity`, on events and about every second, with the director spec's state text and
answers (`continue`, `defend`, `flee`, `eat`, `heal`, `unload`, `resume`, `idle`). Its rules SHALL be the spec's
rules in the spec's order; with `decision_models.tasks.director` enabled, a confident model answer SHALL replace
them. Each decision SHALL be logged to `bots/<name>/logs/laya-director.jsonl`.

#### Scenario: hurt while mining
- **WHEN** health drops to 8 during `!layaMine` with no mob within 8 blocks
- **THEN** the director answers `heal`, the mine job is paused, andy eats and waits, and then the answer is `resume`
