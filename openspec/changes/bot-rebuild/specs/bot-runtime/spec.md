# bot-runtime

## ADDED Requirements

### Requirement: Priority order
The director SHALL arbitrate in the order player command > safety > job > chore. A player command replaces the top job
(`stop` clears the stack); a safety activity (defend, flee, eat, heal) pauses the job under it; a job pre-empts chores;
a chore runs only when the stack is empty, the director answers idle, and chores are on.

#### Scenario: player command during a chore
- **WHEN** andy is storing items as a chore and a player says "follow me"
- **THEN** the chore is cancelled and the follow job runs

#### Scenario: resume after a fight
- **WHEN** a defend activity ends while a farm job is paused under it
- **THEN** the director answers `resume` and the farm continues from its saved progress (harvest count kept)

### Requirement: Modes replaced by director decisions
The bot SHALL have no autonomous modes. Defend, flee, eat, heal, escape from danger and unload SHALL be director
activities chosen by the director model or its rules; stuck handling SHALL belong to the running actuator; item pickup
and torch placing SHALL belong to the job that needs them.

#### Scenario: low health at night
- **WHEN** health is 5 and a skeleton is at 10 with no food
- **THEN** the only behaviour is the director's answer (flee-ranged by the rules), with no mode acting separately

### Requirement: Defend only attackers
andy SHALL fight only a mob that hurt andy or a player within the last 5 s (the attacks sensor). A hostile that is merely
near SHALL NOT be attacked; the director may answer flee or continue.

#### Scenario: a creeper walks past
- **WHEN** a creeper is at 6 and nobody has been hurt
- **THEN** andy does not attack it

#### Scenario: a player is hit
- **WHEN** a zombie hits a player 10 blocks from andy
- **THEN** the director answers defend (defend-player) and andy fights that zombie only

### Requirement: Jobs survive a restart
The job stack (spec, origin, typed progress, status) SHALL be saved atomically to `bots/<name>/laya-job.json` whenever
it changes; `memory.json` (places), `laya-chores.json` and `laya-mines.json` SHALL keep today's names and formats. On start, a stack saved less than 10 minutes ago SHALL be restored paused and resumed by the director; an older
one SHALL be dropped and andy SHALL say which job was lost.

#### Scenario: restart mid-mine
- **WHEN** andy has mined 3 of 8 iron and the process restarts
- **THEN** after spawn the mine job resumes and mines 5 more

### Requirement: Decision loop
The director SHALL decide on events (job end, activity end, chat, hurt, death, spawn) and at least every second, from
one Facts snapshot per tick. Events SHALL be queued and SHALL NOT move the body directly.

#### Scenario: death
- **WHEN** andy dies
- **THEN** the stack is cleared (as today) and the next decision after respawn starts from an empty stack
