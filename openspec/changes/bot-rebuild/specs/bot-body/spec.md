# bot-body

## ADDED Requirements

### Requirement: One owner of the body
The bot SHALL let exactly one runner (a job step or a director activity) move the body at a time, through a lease held
by the director. Sensors, the command parser and the harness SHALL only read the body. No mode, timer or event handler
SHALL call an actuator directly.

#### Scenario: a mob appears during mining
- **WHEN** a zombie hits andy while the mine job is digging
- **THEN** the director takes the lease for `defend`, the mine step's signal is aborted, and the mine job is paused, not
  dropped

#### Scenario: no competing modes
- **WHEN** andy stands still eating
- **THEN** nothing else (no unstuck, no idle staring, no item collecting) moves or turns the body

### Requirement: Cancellation through every actuator
Every actuator, wait and pathfinder call SHALL take an `AbortSignal`. On abort it SHALL stop the body's motion (clear the
pathfinder goal, stop digging, clear control states, stop pvp) and settle within 250 ms (target).

#### Scenario: abort while pathing
- **WHEN** the signal of a `goTo` is aborted mid-path
- **THEN** the pathfinder goal is cleared once and `goTo` resolves `{ok:false, reason:'cancelled'}` within 250 ms

### Requirement: Bounded stop, never an exit
If an aborted runner has not settled within 2 s, the director SHALL take the lease anyway, reset the body, log a
`stop-overrun` event naming the runner, and ignore the late result. The process SHALL NOT exit because a stop was slow.

#### Scenario: a stuck actuator
- **WHEN** a test actuator ignores its signal forever and a player says stop
- **THEN** the lease moves within 2 s, `stop-overrun` is logged and the process keeps running

### Requirement: Typed actuator outcomes
Every actuator SHALL return `{ok:true}` or `{ok:false, reason}` with `reason` from a closed enum (e.g. `cancelled`,
`timeout`, `no-path`, `unreachable`, `missing-item`, `no-block`, `inventory-full`). Actuators SHALL NOT chat; the job
or director decides what to say.

#### Scenario: craft without materials
- **WHEN** the craft actuator is asked for a stone pickaxe without cobblestone
- **THEN** it returns `{ok:false, reason:'missing-item'}` and says nothing

### Requirement: Timeouts are settings
Each actuator SHALL have a default time ceiling and each job a step budget, read from settings, so a hung actuator ends
with `timeout` rather than holding the body.

#### Scenario: dig that never finishes
- **WHEN** a dig has not completed in its ceiling (default 10 s)
- **THEN** the dig returns `{ok:false, reason:'timeout'}` and the job decides the next step
