# Tasks

- [ ] 1. OpenSpec change `test-world`: proposal, spec delta, tasks.
- [ ] 2. `tools/test-world/`: compose file (pinned image, 1.21.6, seed, ports on 127.0.0.1, RCON secret file), config, RCON client, world control (start/stop/reset/template/status) with Brisbane log lines; npm `world:*` scripts; gitignore.
- [ ] 3. Choose the seed (spawn near water with exposed stone), build the template, record and verify the sites in `sites.json` with a probe; fixed test base.
- [ ] 4. `world:bot`: Mindcraft against the test world through `SETTINGS_JSON`, mindserver 8091, local override file.
- [ ] 5. Harness: `test` world target, RCON for server commands, `site` step and `{site:…}` template, MCP world/bot/site tools.
- [ ] 6. `docs/test-world.md` (EULA acceptance, usage, sites), pointer in `docs/game-tests.md`.
- [ ] 7. Unit tests with fakes; `npm test` passes.
- [ ] 8. Live: template built, reset timed, tester and andy join, server left stopped.
- [ ] 9. First full scenario run on the test world by the user; fix what it finds.
