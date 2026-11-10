# laya-chores (delta)

## ADDED Requirements

### Requirement: Chores mode
With chores on and a home chest known, after `idle_seconds` with no action, no player message and no following, the bot SHALL ask the chores model for a job, run it bounded by `job_minutes`, and ask again; it SHALL use the ported chores rules when the model is unsure or answers an away job that Safe marks unsafe.

#### Scenario: Idle start
- **WHEN** chores are on, a home chest is set and andy has been idle for 30 s
- **THEN** he asks the chores model and starts the answered job

#### Scenario: No home chest
- **WHEN** chores are on and no home chest is known
- **THEN** chores mode does nothing and says once that it needs a home chest

### Requirement: Interruption and resume
Any player message or command SHALL interrupt the current chore (finishing an unload in progress first), and chores SHALL resume only after the next idle period.

#### Scenario: Come here mid-chore
- **WHEN** andy is mining for a coal shortfall and a player says "andy come here"
- **THEN** he stops mining, comes, and starts chores again only after 30 s idle

### Requirement: Safe at night and in danger
At night or in danger the bot SHALL only tend, compost, empty or rest near home, never mine, build, expand or fetch wood away from home.

#### Scenario: Night
- **WHEN** it is night and logs are short
- **THEN** andy rests or does a home job, not lumber

### Requirement: Chores state
The bot SHALL write laya-go's chores prompt v1 byte for byte from the clock, its status, the home and purpose chests and pack, `farms`, `builds` and the build queue.

#### Scenario: Golden state
- **WHEN** the bot writes laya-go's golden chores situation
- **THEN** the state and questions equal `v1_sample_request.json`

### Requirement: Chores on and off
`!layaChores("on")` and `!layaChores("off")` SHALL switch chores mode, kept in memory as `chores_on`; off SHALL also stop the current chore.

#### Scenario: Take a break
- **WHEN** a chore is running and `!layaChores("off")` is run
- **THEN** the chore stops and no new one starts while idle
