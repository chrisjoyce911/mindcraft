# Proposal

## Why

Roadmap item 6 (`docs/laya-roadmap.md`, agreed 2026-11-10) lists the supporting `!commands` and their chat phrasings:
- chores on and off;
- marking a site;
- building;
- wood;
- ore memory;
- stock;
- open-ended mining and farming, and the home chest (both done in command v2).

laya-go `command-v3` teaches the command model the phrasings. This change adds the Mindcraft commands that don't exist yet and maps the v3 answers onto them.

## What Changes

- **New commands** (`commands/actions.js`):
  - **`!setSite(name)`:**
    - remembers the speaker's position (or the bot's) as `site_<name>`, one place per site name, like `home_chest`;
    - names: `farm`, `trees`, `mine`, `ranch`, `cane`, `melons`, `base`;
    - replies "The <name> site is at x y z.".
  - **`!layaTrees(count?)`:**
    - with a tree farm (`farms` kind trees), fells and replants its grown trees;
    - otherwise cuts wild birch, then oak, within 48 blocks of home (or the `trees` site), collecting saplings and apples and replanting the saplings where the trees stood;
    - stops at `count` logs, or when no tree is left in range;
    - unloads into the `andy wood` chest or the home chest.
  - **`!listOres(kind?)`:** a short list from ore memory (`laya-mine-v3`), such as "I've seen 2 diamond (nearest 34 blocks, needs iron), 5 iron, 3 coal.", or "I haven't seen any ores to come back for."
  - **`!goToOre(kind, count?)`:** walks to the nearest remembered ore of that kind and mines it, then the next, up to `count` (default: all remembered within 128). It crafts the needed pickaxe first through the upgrade path, or says what it lacks.
  - **`!stock(item?)`:**
    - with an item: the count across the pack, home and purpose chests (last read, re-read when within 32), such as "We have 23 iron: 3 on me, 20 in the mine chest.";
    - without one: the top 8 kinds.
- **Command mapping** (`command.js`, `command_state.js`):
  - command prompt v3, with laya-go's goldens and `resolve_cases_v3.json` byte for byte;
  - **v3 answers to lines:**

    | Answer | Runs |
    |---|---|
    | chores on / off | `!layaChores("on" / "off")` |
    | site | `!setSite(<site>)` |
    | build | `!layaBuild(<blueprint>)`; with item none, a fuzzy match of the message's words against `blueprints/` names, else "I don't know how to build that yet." |
    | wood | `!layaTrees(n?)` |
    | ores | `!listOres` |
    | goto_ore | `!goToOre(<ore>)` |
    | stock | `!stock(<item>?)` |

  - a "hurry", "fast" or "quickly" in the message passes `"fast"` to `!layaMine` (tool choice in `laya-mine-v3`);
  - `prompt: 'v2'` keeps the v2 mapping.
- **Sites in other changes:** `laya-farm-v3`, `laya-build` and `laya-chores` read `site_<name>` when it is set. This change only writes the sites.

## Capabilities

### Modified Capabilities
- `laya-command`: command prompt v3 mapping and the new commands (`!setSite`, `!layaTrees`, `!listOres`, `!goToOre`, `!stock`).

## Impact

- **Changed:** `src/agent/commands/actions.js`, `src/agent/laya/{command,command_state}.js`, `library/skills.js` (tree cutting with sapling collection and replanting), `settings.js` (command `prompt`), `docs/laya-command.md`.
- **New:** `src/agent/laya/{sites,stock}.js` (pure), tests, `test/fixtures/laya-command-v3/`.
- **New in-game scenarios:**
  - `cmd-set-site`: "andy put the farm here" → `site_farm`;
  - `cmd-trees`: "andy go get wood" near the base forest; logs go up, and saplings are carried or replanted;
  - `cmd-stock`: "andy how much iron have we got" with iron in a chest; the reply has the right total;
  - `cmd-list-ores`: after `mine-remember`, the reply names the diamond;
  - `cmd-goto-ore`: "andy go get the diamonds you saw" with an iron pickaxe given; diamond +1;
  - `cmd-build-chat`: "andy build a composter" runs `!layaBuild("composter")`;
  - `home-chest-chat` (the baseline's v1 fail): passes with the v3 model.
- **Depends on:**
  - laya-go `command-v3` (the model; the mapping needs it);
  - `laya-mine-v3` (ore memory) for `!listOres` and `!goToOre`;
  - `laya-build` for build;
  - `laya-chores` for chores.

  `!setSite`, `!layaTrees` and `!stock` work on their own. The others reply that the feature is off when their change isn't present.
