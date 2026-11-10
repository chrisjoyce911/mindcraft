# Tasks

- [x] 1. Library: config (settings.js, env overrides), Brisbane time, laya log reader, mindserver client, tester (LAN scan, commands with replies, chat, tp, walk, chests), `Session` with lazy connect, waiting, snapshots, chat log and session report.
- [x] 2. MCP stdio server (minimal JSON-RPC) with the tool list; `.mcp.json` registering `andy`.
- [x] 3. Scenario loader (validation, templates, selection) and checks; `test/game/scenarios.json` with the ordered suite and tags.
- [x] 4. Runner (wait idle, setup, action, checks, cleanup, skip on disabled tasks, report) and CLI `npm run game-test`.
- [x] 5. `docs/game-tests.md`: what each test checks, running by CLI and by Claude through MCP, manual checklist.
- [x] 6. Unit tests with fakes; `npm test` passes.
- [ ] 7. First live run by the user (needs a LAN world with cheats and andy running); fix what it finds.
