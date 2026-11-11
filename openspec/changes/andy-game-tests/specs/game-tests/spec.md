# game-tests (delta)

## ADDED Requirements

### Requirement: A tester player and the mindserver drive andy
The harness SHALL join the world as the player `tester` (finding the LAN port when `settings.port` is -1), run slash commands as tester and return the server's reply text, send andy chat in game and `!commands` through the mindserver `send-message` event with `from: tester`, and read andy's state from the mindserver's `state-update` and his chat from `bot-output` and game chat. Connections SHALL be made on first use and kept until disconnected, and a world or mindserver that isn't up SHALL give a clear error naming what to start.

#### Scenario: command reply
- **WHEN** a client runs `server_command("/time set day")` and the world allows cheats
- **THEN** the result has the server's reply text ("Set the time to 1000")

#### Scenario: mindserver down
- **WHEN** nothing listens on the mindserver port
- **THEN** connecting fails with an error naming the port and saying to start Mindcraft

### Requirement: Scenarios are data with setup, action, checks and cleanup
Each scenario SHALL have a unique name, tags, a timeout, setup steps, action steps, checks and cleanup steps. Step and check coordinates SHALL be templates relative to andy's block position when the test starts (`{x+3} {y} {z}`) and names (`{andy}`, `{tester}`). Loading SHALL reject unknown step or check types, missing names and duplicates. A run SHALL select scenarios by name or tag in file order.

#### Scenario: relative chest
- **WHEN** andy stands at 10 64 -5 and a step is `/setblock {x+3} {y} {z} chest`
- **THEN** tester runs `/setblock 13 64 -5 chest`

### Requirement: Checks decide pass or fail with a reason
The runner SHALL support checks on: the inventory change of an item since a snapshot (or its count), a chest's contents, andy idle at the end, a reply from andy matching a pattern, a laya log entry in the test's time window matching fields, andy's position change (at the end or the extreme during the test), distance to tester, health/food change, an entity gone from andy's surroundings, an action label seen, and the server's reply to a command. Every failed check SHALL give a reason with the expected and actual value. A test whose required Laya tasks are disabled in andy's settings SHALL be skipped, saying which.

#### Scenario: inventory delta
- **WHEN** a check wants `wooden_pickaxe` up by 1 and andy had 0 before and 1 after
- **THEN** it passes; with 0 after it fails with "wooden_pickaxe +0, wanted ≥ +1"

### Requirement: Waiting for andy
Waiting SHALL end when andy has been idle for a settle time after being busy (or after a grace time if he never got busy), or at the timeout, returning his chat lines and the action labels seen meanwhile. Before each test the runner SHALL wait for andy to be idle.

#### Scenario: resumed job
- **WHEN** a fight interrupts a job and it resumes within the settle time
- **THEN** waiting continues until the job ends

### Requirement: Reports in Brisbane time
Every run and every MCP session SHALL write `bots/andy/logs/game-tests/<Brisbane time>.jsonl` and `.md`: each test's expanded setup and action, andy's replies, inventory before and after, check results, and the laya log lines in the test's time window; each MCP tool call SHALL be appended. Times SHALL be Australia/Brisbane.

#### Scenario: report name
- **WHEN** a suite starts at 2026-11-10 04:05:06 UTC
- **THEN** its report is `bots/andy/logs/game-tests/2026-11-10_14-05-06.md` with times shown as AEST

### Requirement: CLI and MCP front ends
`npm run game-test -- [names] [--tag t] [--list]` SHALL print PASS/FAIL/SKIP per test with seconds and reason and exit non-zero on a failure. The MCP stdio server SHALL expose the tools named in the proposal over JSON-RPC (`initialize`, `tools/list`, `tools/call`), log only to stderr, and return tool errors as `isError` results.

#### Scenario: list
- **WHEN** the user runs `npm run game-test -- --list --tag quick`
- **THEN** the quick scenarios are printed in order with their tags and timeouts, and nothing connects
