# Andy game tests

Repeatable in-game tests for the Mindcraft bot **andy**, in the user's own Minecraft world. There are three ways to run them, all using the same library (`tools/andy-tests/lib/`):

- **Claude, live, through MCP (the main way).** The `andy` MCP server gives Claude tools to look at andy, talk to him, change the world and run the scripted scenarios. Claude decides as it goes: which test to run next, retrying, digging into a failure.
- **The CLI:** `npm run game-test`, which runs the scripted suite and prints PASS/FAIL.
- **By hand:** the checklist at the end, typed in game.

A second player, **`tester`** (a mineflayer bot the harness runs), joins the same world. It runs the slash commands, says the chat lines (so a chat line goes through andy's normal chat handling with `tester` as the speaker) and reads chests. Andy's state comes from the mindserver.

**The test world.** Instead of your own world, the tests can run on a local server that resets to a fixed template in about 10 seconds and has named sites (base, farm, dry, mine, cave): `npm run world:start`, `npm run world:bot`, `npm run game-test -- --world test --tag quick` (or `--reset` to reset it first), or the MCP tools `world_start`, `bot_start`, `world_reset`, `site_tp`. Every scenario starts with a `site` step there, and on the test world server commands go over RCON. See `docs/test-world.md`.

## What it needs from you

- **A world open to LAN with cheats on** (Java 1.21.6; *Open to LAN → Allow Cheats: ON*). `tester` must be able to run `/give`, `/tp`, `/fill`, `/summon` and the rest. The `setup-world` test checks this. If the server says tester has no permission, run `/op tester` from your own player.
- **Mindcraft running with andy in game** (`npm start` in the mindcraft checkout). The mindserver listens on `mindserver_port` (8090).
- **The Laya tasks a test needs, enabled** in `settings.js` `decision_models.tasks`, with golaya serving the models. A test whose `requires` lists a disabled task is **skipped** and says so. The harness reads andy's settings from the mindserver.
- **A test world.** The tests `/clear` andy's inventory, give him items, `/fill` blocks around him, build a platform at Y 299–304, summon a husk, set `/difficulty easy` and lock the time to day. Chests the tests place are left in the world.
- The settings the harness uses are read from `settings.js` at the repo root:
  - `host`;
  - `port` (-1 scans LAN ports 49000–65000, the same scan as `src/mindcraft/mcserver.js`);
  - `minecraft_version`;
  - `mindserver_port`.

  Environment overrides: `ANDY_MC_HOST`, `ANDY_MC_PORT`, `ANDY_MC_VERSION`, `ANDY_MINDSERVER_PORT`, `ANDY_AGENT` (andy), `ANDY_TESTER` (tester), `ANDY_BOT_DIR` (default `<repo>/bots/andy`, where the Laya logs are read and the reports are written), `ANDY_SCENARIOS`.
- `only_chat_with` must be empty or include `tester`, or andy ignores tester.

## Running through Claude (MCP)

The project's `.mcp.json` registers the server as `andy` (`node tools/andy-tests/mcp.js`, started from the repo root). Claude Code offers it when you open the project. To add it yourself, for every project:

```
claude mcp add andy -- node /Users/chris/lnkz/mindcraft/tools/andy-tests/mcp.js
```

Then ask Claude things like "check andy's status", "run the quick suite", "set up a farm patch next to andy and ask him to farm wheat, and tell me what the farm model did".

The tools connect on first use and stay connected until `disconnect`. If the world or the mindserver isn't up, the error says what to start.

| Tool | Does |
|---|---|
| `connect` / `disconnect` | join the world as tester and connect to the mindserver, or leave; `connect` returns the session report path |
| `andy_status` | andy's position, health, food, current action (`Idle`, `action:layaMine`, `mode:self_defense`…), inventory, equipment, blocks at feet and head, nearby players and mob types, modes; tester's position and distance |
| `andy_say` | tester says it in game chat; returns andy's replies in `wait_ms` |
| `andy_command` | a `!command` (or any message) sent through the mindserver `send-message` event, from tester; returns andy's replies |
| `server_command` | a slash command as tester; returns the server's reply lines. `~` is relative to **tester** |
| `tester_tp` | tester to `x y z`, or `dx dy dz` from andy (default 2 east), so "come here" and `!setHomeChest` have a speaker beside him |
| `tester_move` | tester walks by `dx`/`dz`, or to `x y z` (pathfinder, falling back to 1-block teleports) |
| `andy_wait_idle` | wait until andy's action ends (or the timeout); returns the action labels seen and his chat meanwhile |
| `andy_chat_log` | andy's chat lines since the session connected (mindserver `bot-output` and game chat, merged) |
| `andy_logs` | the Laya step logs `laya-<task>.jsonl`: filter by task, time (`since_s`, `since`) and fields (`{"outcome":"fallback"}`, `{"action":"/harvest\|plant/"}`) |
| `inventory_snapshot` / `inventory_diff` | save andy's inventory, position, health and food under a label; diff it against another label or now |
| `chest_contents` | tester teleports onto the chest at `x y z`, opens it and returns `{item: count}` |
| `list_tests` | the scenarios, by tag; `detail` adds the steps and checks |
| `run_test` | one scenario; returns status, reason, every check, andy's replies, inventory change and the Laya log lines in the test's window |
| `run_suite` | scenarios by `tag` and/or `names`; returns the summary and the report path |
| `world_status`, `world_start`, `world_stop`, `world_reset`, `bot_start`, `bot_stop`, `use_world`, `site_tp` | the local test world and andy on it: see `docs/test-world.md` |

**The session report.** Every tool call is appended to `bots/andy/logs/game-tests/<Brisbane time>.jsonl` and `.md` (one pair per MCP server start), so an ad-hoc session can be reviewed afterwards. `run_suite` writes its own report.

**Long runs.** The `full` suite can take an hour (mining and farming). Claude Code's MCP tool timeout may cut a long `run_suite` short: raise it with `MCP_TOOL_TIMEOUT=3600000`, or let Claude run slow tests one at a time with `run_test`. Andy keeps working even if a call times out. `andy_wait_idle` and `andy_status` show where he got to.

## Running the CLI

```
npm run game-test -- --list                 # the suite, no connection
npm run game-test -- --list --tag quick -v  # with steps and checks
npm run game-test -- --tag quick            # the quick tests (a few minutes)
npm run game-test -- --tag full             # everything, in order
npm run game-test -- farm-water eat         # these tests, in file order
npm run game-test -- --world test --tag quick   # on the local test world
npm run game-test -- --reset --tag quick        # reset the test world first
npm run game-test -- --world test --tag full --name baseline-v1   # a named benchmark run
npm run game-test:compare -- a.json b.json      # diff two runs' summaries
```

Each test prints `PASS`, `FAIL`, `SKIP` or `ERROR` with its seconds and the reason, for example `FAIL  craft-furnace  42.0s  inventory: furnace +0, wanted ≥ +1`. The exit code is 0 when nothing failed, 1 on a failure, 2 when it can't connect.

The report goes to `bots/andy/logs/game-tests/<Brisbane time>.md` and `.jsonl` (with `--name n`: `n-<Brisbane time>.*`). For each test it has:
- **via**: how the action reached andy's job (see below);
- the steps as run, with coordinates filled in, and their output;
- each check and why it passed or failed;
- andy's replies;
- inventory before, after and the change;
- chests read;
- the `laya-*.jsonl` lines logged during the test.

Times are Australia/Brisbane (AEST).

**The summary (`.json`).** At the end of a suite run (CLI or `run_suite`), a machine-readable summary is written next to the report: `{started, finished, world, summary: {pass, fail, error, skip, ms}, tests: [{test, result, seconds, via, command?, reason}]}`. The keys are stable, so two runs can be compared: `npm run game-test:compare -- <a.json> <b.json>` prints a side-by-side table with each test marked `better`, `worse` or `same` (plus `new`, `gone`, `skip`, and "via changed"). It exits with 1 when any test got worse.

**Via.** For each test, the report and the summary record the path:
- `model`: a chat line the Laya command model turned into a command (`laya-command.jsonl` kind `run`; `command` is what it ran);
- `llm`: a chat line the command model handed to the LLM (kind `llm`), which then did or didn't run something;
- `direct`: the action sends a `!command` itself;
- `none`: no `laya-command` entry for the chat line.

A chat test still passes or fails on its outcome, but `via` shows whether the command model or the LLM got it there.

## How a test runs

Scenarios are data in `test/game/scenarios.json`, in suite order:
1. **Skip** the test if a task in its `requires` is disabled in andy's settings.
2. **Wait** for andy to be idle. If he's still busy after 60 s, send `!stop`.
3. Take andy's block as `{x} {y} {z}`, then run the **setup** steps. Templates such as `/setblock {x+3} {y} {z} chest`, `{andy}` and `{tester}` are filled in at this point. Then snapshot `before`.
4. Run the **action** steps, then wait until andy is idle. The wait ends when he has been idle for `settle` (3 s) after being busy, so a job that a fight interrupts and then resumes is waited for. If he never gets busy, it ends after `grace` (6 s, or 20 s for chat that may go to the LLM). It also ends at the test's `timeout`.
5. Snapshot `after`, read the chests the checks name, then evaluate the **checks**.
6. Run the **cleanup** steps, whether the test passed or failed.

**Steps:**
- `cmd`: a slash command as tester;
- `say`: game chat as tester;
- `andy`: a mindserver message from tester;
- `wait`: a pause in ms;
- `waitIdle`;
- `waitFor`: andy's `stat`, `item`, `entity`, `action` or `idle`;
- `waitReply`: a regex on andy's chat;
- `waitLog`: a Laya log entry;
- `tp`, `walk`: move tester;
- `snapshot`: save andy's state under a label;
- `anchor`: retake andy's position;
- `site`: test world only, andy and tester to a named site, taken as `{x} {y} {z}` (does nothing on another world);
- `reset`: test world only, the world back to its template (about 10 s plus andy's restart, with nothing saved; tester is put back in creative). `home-chest-sign` and the three mine tests start with it, so they don't depend on what earlier tests dug or saved. Without it, mine-coal takes the coal by the mine site, and unload-home-chest then has to path far for coal. (Does nothing on another world.)

Options on any step: `timeout`, `repeat`, `optional`, `replyMs`, `idleFail`.

**Fail fast.** A `waitFor`, `waitReply` or `waitLog` fails as soon as it's clear the condition won't come. That is when andy was busy during the wait, his action ended, and the condition still isn't met `idleFail` ms later (30 s; `defaults.idleFail` in the file, or per step; `false` waits out the timeout). The reason says so: "andy's action ended and … was still not true 30s later". A wait while andy never gets busy (eat waiting for his food to drop) is not affected.

**Checks:**
- `inventory`: the change since a snapshot, or `absolute`;
- `chest`: what a chest holds, or with `delta` its change;
- `idle`;
- `reply`: or `none` for must not;
- `log`: Laya entries matching fields in the test's window;
- `position`: the change in y, x, z or horizontal distance, at the end or the extreme `during` the test;
- `near`: distance to tester;
- `stat`: health or hunger;
- `noEntity`;
- `actionSeen`: or `final`;
- `serverReply`: or `none` for must not;
- `block`: blocks of a kind (`block`: a name or `/regex/`) within `radius` (6) of andy (or `near: "x y z"`), counted when the action ends, before cleanup; `min` (1) / `max`.

Any check may carry a `note` saying why it's there.

**Strict checks.** The checks pass on what the test is about, not on something incidental:
- the farm job's own count line, not any mention of harvesting;
- `!setHomeChest`'s "Home chest set at x y z", not the LLM saying it set the chest;
- a pond step that worked and the water really there;
- staircase `down` steps, not ore in reach at the surface;
- a defence action and the husk really dead, not wandered off;
- his food going up after he got hungry.

## The tests

Tags: `quick` (about 10 minutes in all), `full` (everything), and one per area (`setup`, `follow`, `craft`, `home`, `farm`, `mine`, `defend`, `eat`, `slow`).

| Test | Tags | Needs | Checks |
|---|---|---|---|
| `setup-world` | quick | cheats | tester in creative beside andy; `/time set day`, `doDaylightCycle false`, clear weather locked. The server's replies prove tester can run commands. |
| `follow` | quick | | "andy follow me", then tester walks 12 blocks east. Andy's action becomes `followPlayer`; he ends within 5 blocks of tester, having moved 6+ blocks. |
| `craft-wooden-pickaxe` | quick | | With only 3 oak logs, "andy make a wooden pickaxe": he gains a wooden pickaxe and finishes. |
| `craft-stone-pickaxe` | quick | | With 2 logs, 3 cobblestone and a crafting table, "andy make a stone pickaxe": he gains one. |
| `craft-furnace` | quick | | With 8 cobblestone and a crafting table, "andy make a furnace": he gains one. |
| `home-chest-sign` | full | farm | At the farm site (water close by), with a hoe and seeds: a chest 3 blocks east with a sign saying "andy" beside it. Starting `!layaFarm` makes him adopt it once the farm loop runs (farm prompt v2 only): "Found my name on a sign: the chest at … is my home chest now." **This only works while andy has no home chest saved**, so run it first after a fresh start with `load_memory: false`. Saved places survive `!restart`. |
| `home-chest-command` | quick | | A chest 3 blocks east, tester beside it. `!setHomeChest` replies "Home chest set at x y z" with that chest. |
| `home-chest-chat` | quick | command | A chest 3 blocks west. "andy this is your chest" must run `!setHomeChest`: "Home chest set at x y z" with that chest (andy then adds "That's my chest now."). The LLM saying it set the chest doesn't pass. |
| `farm-water` | full, slow | farm, command | A 9×9 grass patch around andy, a row of 7 ripe wheat on wet farmland 2 blocks south, and water beside it. With a hoe and 16 seeds, "andy farm wheat 5": he gains 5+ wheat, says "Harvested 5 wheat." (the job's count line, 5 or more), the farm log has harvest steps done, and he stops by himself. |
| `farm-no-water` | full | farm | Andy on a 9×9 grass platform at Y 300, with no water within 64 blocks and no bucket or iron. `!layaFarm("wheat", 5)` stops with "No water near here — take me to water or give me a water bucket." The farm log has a `find_water` step with outcome `no-water`, and he never says "Harvested 1+". |
| `farm-bucket` | full | farm | The same platform, plus a water bucket. Within 10 s of his first `pond` step, the farm log has a `pond` step with outcome `done`, there is water within 6 blocks of him (before cleanup), and he never says "No water near here". |
| `mine-coal` | full, slow | | "andy go mine coal 5" with a stone pickaxe, torches and bread: he ends with 5+ more coal. Coal unloaded into a home chest isn't counted. Cleanup teleports him back. |
| `mine-iron-staircase` | full, slow | mine | `!layaMine("iron", 3)` with the v2 plan. He announces "The iron mine starts at …"; the mine log has 4+ `down` steps done; his Y drops 4+ during the run; he gains 3 raw iron. Iron showing at the surface doesn't pass: the announcement and the staircase are required. |
| `unload-home-chest` | full, slow | mine | A home chest 3 blocks east set with `!setHomeChest`. Andy's pack is filled with 31 stacks of cobblestone (2 slots free), then `!layaMine("coal", 2)`. He walks home and empties it: the chest gains 640+ cobblestone and his drops by 640+ (he keeps 32). Fails 30 s after his mine job ends if he hasn't unloaded. |
| `defend` | quick | | Andy follows tester; a husk is summoned 5 blocks east of him. A husk is a zombie that doesn't burn in the locked daytime. The husk dies (no husk within 48 blocks, by `/execute … if entity`), a defence action is seen (`self_defense`, `laya_defending`, a fight), and he ends back on `followPlayer` (the interrupted job resumed). Sets `/difficulty easy`. |
| `eat` | quick | | 8 bread and a strong hunger effect. When his food falls (≤ 16), the effect is cleared; he eats (auto-eat or the Laya eat model). Bread goes down, his food goes up after he got hungry, and it ends at 15+. |

**Why a test can fail other than andy:**
- The LLM answering a chat line in place of the command model: chat tests have a 20 s grace.
- The terrain: walls in the follow path, no coal or iron within reach.
- An already-saved home chest (`home-chest-sign`).
- The report's Laya log lines and andy's replies usually show which.

## Adding a test

Add an object to `tests` in `test/game/scenarios.json` (`name`, `tags`, `timeout` in ms, `requires`, `setup`, `action`, `checks`, `cleanup`, `description`). `npm test` validates the file (`test/andy_tests_scenarios.test.js`). Check it reads right with `npm run game-test -- --list -v <name>`.

## Manual checklist

The same tests, typed in game. Stand right next to andy (`/tp @s andy`), so `~` is about andy's position, and watch his replies in chat. Commands with `andy` as the target work from anywhere.

1. **setup-world:** `/gamemode creative @s`, `/time set day`, `/gamerule doDaylightCycle false`, `/weather clear`, `/gamerule doWeatherCycle false`.
2. **follow:** say `andy follow me`, walk about 12 blocks away. He follows and stays within about 5 blocks. Then `!stop`.
3. **craft-wooden-pickaxe:** `/clear andy`, `/give andy oak_log 3`, say `andy make a wooden pickaxe`. He has a wooden pickaxe.
4. **craft-stone-pickaxe:** `/clear andy`, `/give andy oak_log 2`, `/give andy cobblestone 3`, `/give andy crafting_table`, say `andy make a stone pickaxe`.
5. **craft-furnace:** `/clear andy`, `/give andy cobblestone 8`, `/give andy crafting_table`, say `andy make a furnace`.
6. **home-chest-sign** (fresh andy only): `/setblock ~3 ~ ~ chest`, `/setblock ~3 ~ ~1 oak_sign{front_text:{messages:["andy","","",""]}}`, then `!layaFarm("wheat", 1)`. He says "Found my name on a sign: the chest at … is my home chest now." Then `!stop`.
7. **home-chest-command:** `/setblock ~3 ~ ~ chest`, stand by it, `!setHomeChest`. He says "Home chest set at …".
8. **home-chest-chat:** `/setblock ~-3 ~ ~ chest`, stand by it, say `andy this is your chest`. He says "That's my chest now."
9. **farm-water:** stand 6 blocks north of andy so you're off the patch; the `~` below are andy's position, so run them while standing on his spot first.
   - `/clear andy`
   - `/fill ~-4 ~-2 ~-4 ~4 ~-2 ~4 dirt`
   - `/fill ~-4 ~-1 ~-4 ~4 ~-1 ~4 grass_block`
   - `/fill ~-4 ~ ~-4 ~4 ~3 ~4 air`
   - `/fill ~-3 ~-1 ~2 ~3 ~-1 ~2 farmland[moisture=7]`
   - `/fill ~-3 ~ ~2 ~3 ~ ~2 wheat[age=7]`
   - `/setblock ~ ~-1 ~3 water`
   - `/give andy wooden_hoe`
   - `/give andy wheat_seeds 16`
   - say `andy farm wheat 5`

   He harvests 5 wheat, says "Harvested 5 wheat." and stops.
10. **farm-no-water:**
    - `/clear andy`
    - `/fill ~-4 299 ~-4 ~4 299 ~4 dirt`
    - `/fill ~-4 300 ~-4 ~4 300 ~4 grass_block`
    - `/tp andy ~ 301 ~`
    - `/tp @s ~ 301 ~-4`
    - `/give andy wooden_hoe`
    - `/give andy wheat_seeds 16`
    - `!layaFarm("wheat", 5)`

    He says "No water near here — take me to water or give me a water bucket." and stops.
11. **farm-bucket:** on the same platform, `/give andy water_bucket`, then `!layaFarm("wheat", 1)`. He digs a pond (laya-farm.jsonl shows `pond`). Then `!stop`. Clean up: teleport both back down, then `/fill ~-4 299 ~-4 ~4 304 ~4 air` from the platform's centre.
12. **mine-coal:** `/clear andy`, `/give andy stone_pickaxe`, `/give andy torch 16`, `/give andy bread 8`, say `andy go mine coal 5`. He comes back with 5 coal, or `/tp andy @s` when he's done.
13. **mine-iron-staircase:** the same kit with `torch 32`, then `!layaMine("iron", 3)`. He says "The iron mine starts at …", stairs down and gets 3 raw iron.
14. **unload-home-chest:**
    - `/setblock ~3 ~ ~ chest`, stand by it, `!setHomeChest`
    - `/clear andy`
    - `/give andy stone_pickaxe`, `/give andy torch 16`, `/give andy bread 4`
    - `/give andy cobblestone 64` 31 times (or `/give andy cobblestone 1984`)
    - `!layaMine("coal", 2)`

    He walks to the chest and empties the cobblestone, keeping 32. Then `!stop`.
15. **defend:** `/difficulty easy`, `/give andy iron_sword`, `!followPlayer("<you>", 3)`, then `/summon husk ~5 ~ ~`. He kills it and goes back to following you. Then `!stop`.
16. **eat:** `/clear andy`, `/give andy bread 8`, `/effect give andy hunger 60 100`. When his food is down (the mindserver UI shows it), `/effect clear andy hunger`. He eats bread and his food goes back up.
