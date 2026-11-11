# Test world

A local Minecraft server just for the andy game tests (`docs/game-tests.md`). It is the same world every time and goes back to its template in about 10 seconds. It also has named places to run each kind of test: base, farm, dry, mine and cave.

It runs in Docker (OrbStack) on this Mac, on `127.0.0.1:25566` only. It never touches your own worlds or LAN games.

**EULA.** The user accepted the Minecraft EULA (https://www.minecraft.net/eula) for this local test server on 2026-11-10. `tools/test-world/compose.yaml` sets `EULA=TRUE` on that basis.

## Quick start

```
npm run world:template    # first time only: build the template world (about 1 minute)
npm run world:start       # start the server, wait until it accepts players (about 7 s)
npm run world:bot         # andy against the test world (foreground; Ctrl-C stops)
npm run game-test -- --world test --tag quick     # in another terminal
npm run world:reset       # back to the template (about 8 s)
npm run world:stop
```

Or let Claude drive it through the `andy` MCP server: `world_start`, `bot_start`, then the usual tools. See [Through Claude (MCP)](#through-claude-mcp).

## The server

| | |
|---|---|
| Image | `itzg/minecraft-server:2026.10.1-java21` (an exact tag, published 2026-10-25; digest `sha256:07ab333a…69ab74`) |
| Game | vanilla Java 1.21.6, offline mode (no Microsoft login), survival, difficulty easy |
| Seed | `1` |
| Spawn protection | 0 |
| View distance | 8 |
| Simulation distance | 6 |
| Memory | 3 GB |
| Timezone | the container logs in Australia/Brisbane |
| Address | `127.0.0.1:25566` (game) and `127.0.0.1:25576` (RCON), both on localhost only |
| Operators | `tester` (written into `ops.json` with its offline UUID) |
| Game rules (template) | no daylight cycle (time locked at day, 1000); no weather cycle (clear); no insomnia (no phantoms); mobs still spawn (in the dark: caves, the defend test summons its own); no wandering traders or patrols; no advancement announcements; spawn radius 0, so everyone joins at the base; world spawn at the base |

Data lives **outside the repo**, so the main checkout and worktrees share it: `../mindcraft-test-world-data` beside the checkout, which is `~/lnkz/mindcraft-test-world-data` (override with `TEST_WORLD_DATA`).

| Path | What |
|---|---|
| `server/` | the live server directory (mounted at `/data`); `server/world` is the world |
| `template/world` | the template the reset copies back; `template/template.json` records its seed, image, Brisbane creation time and the site check |
| `rcon.secret` | the RCON password, generated on first start, mode 600, mounted into the container as a file; never in the repo |
| `logs/bot-*.log` | output of a test bot started in the background |
| `bot.pid` | the background test bot |

`tools/test-world/data/`, `*.secret`, `.env` and `bot-settings.local.json` under `tools/test-world/` are gitignored too.

Other environment overrides: `TEST_WORLD_PORT`, `TEST_WORLD_RCON_PORT`, `TEST_WORLD_MINDSERVER_PORT` (8091), `TEST_WORLD_NODE` (the node for the bot; node@20 when installed, as `start-bot.sh` uses), `TEST_WORLD_OPS` (tester), `TEST_WORLD_SITES`.

## Commands

All of them are `node tools/test-world/world.js <command>`, or the npm scripts. Log lines are in Brisbane time.

| npm | Does |
|---|---|
| `world:start` | Starts the container and waits until the server answers a status ping and RCON `list`. If it doesn't, the error shows the container's last log lines. A no-op when it is already up. |
| `world:stop` | Stops the container. The server saves the world first. |
| `world:reset` | Stops, replaces `server/world` with a copy of `template/world`, starts and waits. The copy is an APFS clone, so it takes no time. Measured: **7–10 s** in all, about 1 s stopping and 6–9 s starting. Fails, leaving the live world alone, when there is no template. Warns when the template's seed isn't the one in `sites.json`. |
| `world:template` | First time, or `-- --force` to rebuild. It: <br>1. generates a new world from the seed; <br>2. sets the game rules and the world spawn over RCON; <br>3. force-loads ±48 blocks round every site and waits 30 s for the chunks; <br>4. runs the `build` commands in `sites.json`; <br>5. checks every site with a probe player; <br>6. releases the chunks, saves, stops, and copies the world without player data to `template/world`. <br>It exits non-zero when a site check fails; the template is still saved. Takes about 50 s. |
| `world:status` | Shows: <br>- the container state and whether it's ready; <br>- the players online; <br>- the image and seed; <br>- the template; <br>- the sites. |
| `world:sites` | Checks the sites (or `-- farm mine`) with a probe player against the running server. |
| `world:rcon -- <command>` | Runs one server command over RCON, e.g. `npm run world:rcon -- list`. |
| `world:bot` | Mindcraft against the test world. See [Andy on the test world](#andy-on-the-test-world). |

## Sites

`tools/test-world/sites.json` names places in the template. x y z is where a player stands (feet level). `npm run world:sites` checks each one.

| Site | x y z | What it is | Checked |
|---|---|---|---|
| `base` | 166 70 169 | A flat, open grass pad (x 156..184, z 161..177, grass at y 69), built by the template on the forest edge at world spawn. Open grass carries on east, for the follow test. A chest (158 70 162) and an oak sign saying "test base" (159 70 162) are in its north-west corner, out of the tests' way. | 9×9 open grass, the chest, the sign |
| `farm` | 208 63 149 | Grass at sea level on the river mouth's west bank; water 2 blocks east (210 62 147). The template clears the trees on x 203..209, z 144..154. | 3×3 open grass, 3+ water within 4 |
| `dry` | 200 200 200 | A 9×9 grass platform at y 199 (dirt under, glass floor and glass walls round it), built in the sky by the template. | 9×9 open grass, **no water within 64** |
| `mine` | 172 74 140 | Top of the bare stone and granite hill north of spawn. Coal and iron show on its slopes. Dig or stair down from here. | 40+ exposed stone within 6 (91 found) |
| `cave` | 178 57 195 | A natural cave pocket 14 blocks under the forest south-east of spawn: stone floor, roof 3 up, dark. | underground (floor and roof), 20+ stone within 4 |

Why the dry site is a platform: every natural grass spot within 150 blocks of spawn has the sea, the river or an underground aquifer within 64 blocks (the farm task's `water_radius`), so there is no natural dry site nearby.

Why the template builds things: tree placement near chunk borders is not identical between two generations of the same seed. So the template, not the seed, is what stays fixed. The base pad and the farm clearing make those two sites the same every time, and the site check at the end of `world:template` catches any drift. The build ends with `kill @e[type=item]`, because the fills knock plants loose and andy would stop to pick them up.

**Choosing the seed.** Several seeds were tried (1, 7, 42, 100, 777, 2024, 8675309, -1, 31415, 12345), surveying ±128 blocks round spawn. Seed 1 had the best mix:
- flat forest-edge grass at spawn;
- a bare stone hill with ore 10–20 blocks north;
- a river mouth into the sea about 45 blocks north-east;
- caves under spawn.

Other seeds spawned in mountains (12345), had no exposed stone near spawn (7, 8675309, 31415), or had water only 50–80 blocks away (100, 2024).

To change a site or the build, edit `sites.json`, then `npm run world:template -- --force`.

## Andy on the test world

`npm run world:bot` starts `main.js` from this checkout with `SETTINGS_JSON` on top of `settings.js`:

```
{"host":"127.0.0.1","port":25566,"minecraft_version":"1.21.6","mindserver_port":8091,"auto_open_ui":false}
```

It also sets `MINECRAFT_PORT` and `MINDSERVER_PORT`. **`settings.js` is not changed.** Everything else comes from it: the profiles' models, `decision_models` (which Laya tasks are on), `only_chat_with`, `load_memory`. So run it from the checkout whose `settings.js` you want: the main checkout for your local Laya settings.

- **No LAN scan:** the port is fixed.
- **Mindserver on 8091,** so it runs beside your own Mindcraft on 8090. The harness uses 8091 on the test world.
- **Node:** node@20 when installed, put first on `PATH`, as `start-bot.sh` does. Mindcraft spawns each agent with a bare `node`, and node 26 can't load it.
- **Profiles:** `npm run world:bot -- --profiles ./profiles/andy-micro.json` (default `./andy.json`).
- **Background:** `npm run world:bot -- --background` writes to `<data>/logs/bot-<Brisbane time>.log`; `npm run world:bot -- --stop` stops it.
- **`--print`** shows the command and settings without running anything.
- **Local overrides:** `tools/test-world/bot-settings.local.json` (gitignored) is merged on top, e.g. `{"only_chat_with": ["tester"], "load_memory": false}`. Keys replace `settings.js` keys whole, as `SETTINGS_JSON` does. To change one Laya task, copy the whole `decision_models` object.

Andy's logs and memory are under `bots/andy/` of the checkout it runs from, as usual. With `load_memory: true` a saved home chest survives a world reset, but the chest itself doesn't.

## The harness on the test world

The harness (`tools/andy-tests`) has two targets:
- **`settings`** (the default): your world from `settings.js` and `ANDY_MC_*`;
- **`test`**: `127.0.0.1:25566`, mindserver 8091.

Select `test` with `ANDY_WORLD=test`, `npm run game-test -- --world test …`, or `--reset` (reset the test world first, restarting andy, then run). In MCP, the world tools switch to it.

On the test world:
- **Server commands go over RCON:** setup steps, `server_command`, teleports to sites. That is more reliable than tester's chat and has no 256-character limit. Two exceptions go through tester's chat, as before:
  - commands relative to tester (`~`, `^`, `@s`);
  - any command when RCON fails (the result says `via` and `rconError`).

  After an RCON command the harness waits up to 0.5 s, so the change reaches andy's client before the next step.
- **The `site` step:** `{"site": "farm"}` (or `{"site": {"name": "farm", "who": "andy"}}`). It teleports andy to the site, with tester 2 blocks east of him, waits for andy to arrive, and takes the site as the test's `{x} {y} {z}`. **On any other world it does nothing** (recorded as skipped), and the test runs relative to andy as before.
- **Every scenario now starts with a site:**
  - `farm` for farm-water;
  - `dry` for farm-no-water and farm-bucket;
  - `mine` for the three mining tests;
  - `base` for the rest.
- **Templates:** `{site:farm}` is a site's `x y z`. `{site:farm.x}` is one coordinate, and `{site:farm.y+1}` adds an offset. They are filled in on the test world only.

## Through Claude (MCP)

The `andy` MCP server has these extra tools:

| Tool | Does |
|---|---|
| `world_status` | Shows: <br>- the container and whether it's ready, and the players; <br>- the seed, the template and the sites; <br>- the test bot; <br>- which world the tools use now. |
| `world_start` | Starts the test world, waits until it is ready, and points the tools at it. |
| `world_stop` | Stops it (saved). Tester leaves; andy is kicked. |
| `world_reset` | Back to the template. If the test bot is running, andy is started again through the mindserver (`start-agent`), and it waits until he is back in game. Measured: about 10.5 s in all, andy included. Snapshots are cleared. |
| `bot_start` | Starts andy against the test world in the background, as `world:bot --background`. Waits until he is in game (about 2 s after Mindcraft starts). Takes `profiles`. |
| `bot_stop` | Stops the test bot. |
| `use_world` | `test` or `settings`: which world the tools talk to. Drops the current connections. |
| `site_tp` | Andy, tester or both to a named site. |

A session might go: `world_start` → `bot_start` → `world_reset` → `site_tp farm` → `run_test farm-water` → `world_reset` → …

## Notes

- **The server is only for this.** It's bound to localhost, in offline mode (any name can join locally), and RCON has a random password.
- **Stopping andy:** `world_stop` or `world:stop` while andy is connected kicks him. Mindcraft restarts the agent once, and that restart fails while the server is down. `world_reset` deals with this. After a manual stop and start, use the mindserver UI (http://localhost:8091) or `bot_stop` and `bot_start`.
- **First start:** it unpacks the 1.21.6 server jar into `server/` (about 130 MB). Starts after that take about 7 s.
- **Removing it all:** `npm run world:stop`, `docker rm mindcraft-test-world`, then delete the data directory.
