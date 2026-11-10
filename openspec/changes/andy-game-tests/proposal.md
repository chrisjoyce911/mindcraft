# Proposal

## Why

Every Laya task (follow, craft, home chest, farm, mine, defend, eat) has unit tests with fakes, but checking that andy really does the job in the user's Minecraft world is manual: type in chat, watch, read `bots/andy/logs/laya-*.jsonl`. The user wants that repeatable, and mostly driven by Claude live from the Claude Code window: Claude sets up a situation in the world, asks andy to do something, watches what happens, retries and pokes at failures, and leaves a reviewable record.

## What Changes

- **A test library** (`tools/andy-tests/lib/`) with one `Session` that both front ends use:
  - a **tester** player (mineflayer, username `tester`) joins the same world (LAN port scan reused from `src/mindcraft/mcserver.js`), runs slash commands with the server's reply text, chats to andy, teleports and walks, and reads chests;
  - a **mindserver client** (socket.io, port from `settings.js`) sends `send-message` as `tester`, listens to `state-update` (position, health, food, inventory, current action) and `bot-output` (andy's chat);
  - inventory snapshots and diffs, waiting until andy is idle, andy's chat log, laya log tails by task and time window;
  - a **session report** (`bots/andy/logs/game-tests/<Brisbane time>.jsonl` and `.md`) every call is appended to.
- **An MCP server** (`tools/andy-tests/mcp.js`, stdio, a minimal JSON-RPC implementation so no dependency is added to the shared `node_modules`) registered as `andy` in a project `.mcp.json`. Tools: `connect`, `disconnect`, `andy_status`, `andy_say`, `andy_command`, `server_command`, `tester_tp`, `tester_move`, `andy_wait_idle`, `andy_chat_log`, `andy_logs`, `inventory_snapshot`, `inventory_diff`, `chest_contents`, `list_tests`, `run_test`, `run_suite`. Connections are made lazily and kept across calls.
- **Scenarios** (`test/game/scenarios.json`): an ordered suite of setup steps (commands relative to andy's position), an action (a chat line or a `!command`), checks, a timeout and cleanup, tagged `quick`/`full` and by area: setup world, follow, craft wooden/stone pickaxe and furnace, home chest three ways, farm with water / no water / bucket, mine coal, mine iron with the staircase, unload into the home chest, defend and resume, eat.
- **A runner and CLI**: `npm run game-test -- [names|--tag quick|--list]` prints PASS/FAIL/SKIP per test with timing and the reason, and writes the report.
- **Docs** `docs/game-tests.md`: each test, how to run it (CLI and through Claude/MCP), and the same tests as a manual in-game checklist.
- Unit tests with fakes (no server) for checks, scenario parsing, the runner, logs and the MCP protocol.

## Capabilities

### New Capabilities
- `game-tests`: in-game test harness, scenarios, runner/CLI, MCP control server.

## Impact

- **New:** `tools/andy-tests/` (lib, `cli.js`, `mcp.js`), `test/game/scenarios.json`, `test/andy_tests_*.test.js`, `docs/game-tests.md`, `.mcp.json`.
- **Changed:** `package.json` (`game-test` and `game-test:mcp` scripts). No change to the bot itself.
- **Needs the user:** a world open to LAN with cheats on (tester must be able to run commands), Mindcraft running with andy in game, the Laya tasks a test needs enabled. Tests clear and give andy items, place blocks and summon mobs near him: use a test world.
