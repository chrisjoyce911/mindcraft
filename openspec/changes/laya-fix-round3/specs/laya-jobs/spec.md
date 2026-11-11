# laya-jobs (delta)

## ADDED Requirements

### Requirement: Director activities stop promptly
The director's eat, heal and unload SHALL check `bot.interrupt_code` at least every 100 ms and end when it is set,
so a mode (laya_defending, unstuck, ...) or `!stop` takes over without the 10 s kill. When the director answers
something other than the running eat, heal or unload, that activity SHALL be stopped; a resumed job SHALL NOT be
stopped by a `continue` answer.

#### Scenario: a skeleton while healing with no food
- **WHEN** andy heals at health 3 with no food and laya_defending interrupts
- **THEN** heal ends within about 100 ms and the defend mode runs

### Requirement: Interrupts end stuck collects
An interrupt SHALL clear the pathfinder goal (every `pathfinder.goto` ends) and SHALL ask collectBlock to cancel
at most once per running task. `collectBlock` and `pickupNearbyItems` SHALL stop going for the next block or item
once interrupted.

#### Scenario: unstuck during gather wood
- **WHEN** unstuck interrupts `!layaGather("log", 8)` while andy is stuck on the path to a log
- **THEN** the gather stops within a few seconds, with no MaxListenersExceeded warning and no process kill

### Requirement: Remembered places survive a restart
The memory bank's places (home_chest, last_death_position, ...) SHALL be written to `memory.json` (`places`) on
every change and loaded with the memory on a restart.

#### Scenario: restart after a crash
- **WHEN** the home chest is set and the agent process restarts
- **THEN** the director state shows `Home <dist>`, not `Home none`

### Requirement: Failed jobs say why
A Laya job that ends without its goal (failed or blocked) SHALL say so in chat with the reason, also when the
director resumed it.

#### Scenario: a craft that can't finish
- **WHEN** `!layaCraft("wooden_sword", 1)` ends with `take planks failed`
- **THEN** andy says "I couldn't make 1 wooden sword: take planks failed."

### Requirement: The hand holds a weapon
When no action runs (after a job or a pickup), andy SHALL hold his best weapon (sword, else axe); with none he
SHALL keep a tool in hand, else hold his best pickaxe, else hold nothing.

#### Scenario: an arrow picked up
- **WHEN** andy, idle with a wooden sword, picks up an arrow into his hand
- **THEN** he holds the wooden sword

### Requirement: An unreachable model server backs off
The Laya client SHALL retry an unreachable server once at once. If it is still unreachable, the client SHALL NOT ask
it again for a back-off that starts at 1 s and doubles to 10 s, and SHALL log entering and leaving the back-off. It
SHALL never throw; callers use their rules.

#### Scenario: golaya restarts while andy is idle
- **WHEN** the director model's server refuses connections
- **THEN** the director's rules decide, the server is asked again after 1 s, 2 s, 4 s, ... (at most 10 s apart), and
  the log says when it is reachable again
