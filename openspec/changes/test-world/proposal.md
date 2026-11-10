# Proposal

## Why

The in-game tests (`andy-game-tests`) run in the user's own LAN world: its terrain changes, the tests leave chests and holes behind, and nothing can be put back. A failure can be the world's fault (no water, a wall in the follow path, no coal in reach) as easily as andy's. The tests need a world that is the same every time and can be reset in seconds, with known places to run each kind of test.

## What Changes

- **A local test server** (`tools/test-world/`): docker compose with the `itzg/minecraft-server` image pinned to an exact tag, vanilla Java 1.21.6, offline mode, a fixed seed, easy, spawn protection off, modest view/simulation distance, 3 GB. It listens on `127.0.0.1:25566` only, with RCON on `127.0.0.1:25576`; the RCON password is generated on first use into the data directory (outside the repo, never committed). `tester` is an operator.
- **Data outside the repo**: `../mindcraft-test-world-data` beside the checkout (`TEST_WORLD_DATA` overrides): the live server, the template world, the secret and the logs, shared by the main checkout and worktrees. `tools/test-world/data/` is gitignored too.
- **Scripts** (`node tools/test-world/world.js`, npm `world:*`): `start` (start, wait until it answers RCON and a status ping), `stop`, `reset` (stop, replace the world with the template copy, start, wait), `template` (first time: generate from the seed, set the game rules over RCON, generate the chunks near spawn, build the fixed test base, check the sites, stop, snapshot), `status`, `sites` (check the sites with a probe player), `bot` (start Mindcraft against the test world). Log lines are Brisbane time.
- **Known test sites** (`tools/test-world/sites.json`): base (flat grass), farm (grass beside water), dry (grass, no water within 64 blocks), mine (exposed stone), cave; each with what a probe checks. The template builds a small base (a chest and a sign) at the base site.
- **Mindcraft against the test world without touching `settings.js`**: `npm run world:bot` starts `main.js` with `SETTINGS_JSON` (host 127.0.0.1, port 25566, version 1.21.6, mindserver 8091 so it doesn't clash with the user's own Mindcraft on 8090, no browser) on top of the checkout's `settings.js`, plus an optional gitignored `tools/test-world/bot-settings.local.json`.
- **Harness and MCP**: the harness gets a second world target, `test` (env `ANDY_WORLD=test`, or switched by the world tools). New MCP tools `world_status`, `world_start`, `world_stop`, `world_reset`, `bot_start`, `bot_stop`, `site_tp`. On the test world, server commands go over RCON (falling back to tester chat for commands relative to tester: `~`, `^`, `@s`). Scenarios get a `site` step (teleport andy and tester to a named site; a no-op outside the test world) and a `{site:name}` template.
- **Docs** `docs/test-world.md` (with the EULA acceptance), unit tests with fakes.

## EULA

The user accepted the Minecraft EULA (https://www.minecraft.net/eula) for this local test server on 2026-11-10; the compose file sets `EULA=TRUE` on that basis.

## Capabilities

### New Capabilities
- `test-world`: the reset-able local server, its sites and the harness/MCP wiring.

## Impact

- **New:** `tools/test-world/` (compose, `world.js`, `bot.js`, `lib/`, `sites.json`), `docs/test-world.md`, `test/test_world_*.test.js`.
- **Changed:** `tools/andy-tests/lib/{config,session,tools,scenarios,runner,real}.js` (world target, RCON, site step, world tools), `test/game/scenarios.json` (site steps), `package.json` (`world:*` scripts), `.gitignore`, `docs/game-tests.md` (pointer). No change to the bot or `settings.js`.
- **Needs:** Docker (OrbStack), about 3 GB RAM while the server runs, ~1 GB disk for the data directory.
