# test-world (delta)

## ADDED Requirements

### Requirement: A local, pinned, reset-able test server
The test server SHALL run the `itzg/minecraft-server` image at an exact tag (no floating tag), vanilla 1.21.6, offline mode, EULA accepted, a fixed seed, difficulty easy, spawn protection 0, bound to `127.0.0.1:25566` with RCON on `127.0.0.1:25576` only. Its data SHALL live outside version control. The RCON password SHALL be generated on first use and stored only in the data directory.

#### Scenario: no secret in the repo
- **WHEN** the server is started for the first time
- **THEN** a random password is written to `<data>/rcon.secret` (mode 600) and passed to the container through a mounted file, and nothing under the repo holds it

#### Scenario: only localhost
- **WHEN** the container runs
- **THEN** its game and RCON ports are published on 127.0.0.1 only

### Requirement: Start, stop, reset and template
`start` SHALL return once the server answers RCON and a status ping, or fail with the container's last log lines. `stop` SHALL stop it (saving the world). `reset` SHALL stop the server, replace the world directory with a copy of the template and start it again, failing clearly when there is no template. `template` SHALL generate the world from the seed, set the game rules (no daylight or weather cycle, day, clear, no insomnia, mobs still spawn), generate the chunks around the sites, build the fixed test base, then stop and snapshot the world without player data. Log lines SHALL be Brisbane time.

#### Scenario: reset without a template
- **WHEN** `reset` runs and `<data>/template/world` doesn't exist
- **THEN** it fails saying to run `npm run world:template` first, and the live world is untouched

#### Scenario: reset
- **WHEN** a test has dug holes and placed chests, and `reset` runs
- **THEN** the world is the template again and the server accepts connections

### Requirement: Known test sites
`tools/test-world/sites.json` SHALL name the seed and, for each site (base, farm, dry, mine, cave), a standing position and what a probe checks there (grass underfoot, water within a radius, no water within a radius, stone exposed, air below ground). A site check SHALL report each site's result with the reason.

#### Scenario: dry site
- **WHEN** the probe checks the dry site
- **THEN** it passes only if no water block is loaded within 64 blocks of it

### Requirement: Mindcraft against the test world without editing settings.js
`npm run world:bot` SHALL start Mindcraft from the checkout with host 127.0.0.1, port 25566, version 1.21.6 and mindserver port 8091 layered over `settings.js` through `SETTINGS_JSON`, plus `tools/test-world/bot-settings.local.json` when present. `settings.js` SHALL not be modified.

#### Scenario: user's settings untouched
- **WHEN** `world:bot` starts andy
- **THEN** andy joins 127.0.0.1:25566 without a LAN scan and `settings.js` is unchanged

### Requirement: Harness and MCP use the test world
The harness SHALL support a `test` world target (env `ANDY_WORLD=test`, or set by the world tools) that connects tester to 127.0.0.1:25566 and the mindserver on the test bot's port. The MCP server SHALL offer `world_status`, `world_start`, `world_stop`, `world_reset`, `bot_start`, `bot_stop` and `site_tp`. On the test world, server commands SHALL go over RCON unless they are relative to tester (`~`, `^`, `@s`), which go through tester chat; results SHALL say which was used. Scenarios SHALL accept a `site` step that teleports andy (and tester beside him) to a named site and retakes the anchor, and does nothing outside the test world.

#### Scenario: command over RCON
- **WHEN** the target is the test world and a client runs `server_command("/time set day")`
- **THEN** it is sent over RCON and the result has `via: "rcon"` and the reply "Set the time to 1000"

#### Scenario: site step on the user's world
- **WHEN** a scenario with `{"site": "farm"}` runs against the LAN world
- **THEN** the step is recorded as skipped (not the test world) and the test carries on relative to andy
