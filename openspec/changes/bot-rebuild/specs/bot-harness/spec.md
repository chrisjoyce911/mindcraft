# bot-harness

## ADDED Requirements

### Requirement: Mindserver-compatible API
The new bot SHALL serve the socket.io protocol `tools/andy-tests` and the `andy` MCP server use today:
`listen-to-agents` → `state-update` (the full-state shape: gameplay, action, surroundings, inventory, nearby, modes
summary, places) every second; `agents-status`; `bot-output` (andy's chat); `send-message` (agent, {from, message});
`get-settings`; `start-agent`; on the same mindserver port.

#### Scenario: game suite against the new bot
- **WHEN** `npm run game-test` runs the 16 scenarios with `ANDY_BOT=new`
- **THEN** the harness connects, sends commands and reads state with no change to `tools/andy-tests`

### Requirement: Same launch contract
The new entry point SHALL start from `tools/test-world/bot.js` with the same `SETTINGS_JSON` and `--profiles` contract
and stop cleanly on SIGINT, so `bot_start`/`bot_stop` work for both bots.

#### Scenario: bot_start with the new bot
- **WHEN** the `bot_start` MCP tool runs with `ANDY_BOT=new`
- **THEN** the new bot joins the test world and `andy_status` reports it in game

### Requirement: Idle is observable
The state's `action.isIdle` SHALL be true exactly when the job stack is empty and no activity or chore holds the body, so
`andy_wait_idle` keeps its meaning.

#### Scenario: wait for a job
- **WHEN** a mine job ends with done
- **THEN** the next `state-update` reports `isIdle: true`
