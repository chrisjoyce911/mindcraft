# laya-jobs (delta)

## ADDED Requirements

### Requirement: Jobs and modes stop within 100 ms of an interrupt
A Laya job's work (runJob) and a mode's work (modes `execute`) SHALL return within about 100 ms of
`bot.interrupt_code`, even when a skill under them doesn't. The work given up on SHALL be cancelled: skills that
check `stopped(bot)` stop at their next check after the interrupt has cleared. A chore inside its job is cancelled
with it.

#### Scenario: an interrupted gather
- **WHEN** `!layaGather("coal", 4)` is interrupted by a mode while its collect never settles
- **THEN** the action ends at once (no "waiting for code to finish executing" ×30, no process exit) and the job is
  paused for the director to resume

### Requirement: A player's job survives a restart
A player's Laya job on the stack SHALL be kept in `bots/<name>/laya-job.json` with its progress; the file SHALL go
when the job ends, is replaced or the stack is cleared (`!stop`, death). After a restart a saved job no older than
15 minutes SHALL go back on the stack paused (the director resumes it) and andy SHALL say he carries on with it; an
older or unknown one SHALL be reported as lost. Chores are not kept.

#### Scenario: killed in the middle of "collect 4 coal"
- **WHEN** the agent process restarts while `!layaGather("coal", 4)` (target 35 coal) is on the stack
- **THEN** after the restart andy says "I was restarted while I was going to get 4 coal. I'll carry on with it." and
  gathers to 35 coal, not 4 more
