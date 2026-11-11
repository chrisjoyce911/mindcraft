# Crafting, gathering and storage with a Laya model

When the `craft` decision task is on, `!layaCraft` and `!layaGather` make things step by step with a small Laya model trained in [laya-go](https://gitlab.com/lnkz/laya-go) (`docs/craft.md` there, prompt `v2`). Other Laya skills, such as mining and farming, call the same loop to make a tool or material they lack.

## What the model decides

Each step, the bot describes its situation and the model picks the next step:

```
Craft.
Goal iron_pickaxe x1
Have planks x3 stick x2 wooden_pickaxe x1
Other dirt x12
Chest raw_iron x5
Near crafting_table yes furnace no chest no
Inventory 4/36
```

- **Action:**
  - craft, smelt, gather;
  - take (from the chest);
  - place (a crafting table, furnace or chest);
  - store (in the chest);
  - done.
- **Item:** the goal's materials, the chest's materials, the Other items, or `none`.
- **Count:** how many (times to craft for craft), rounded up to 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48 or 64.

**laya-go's rules:**
- Make the goal's bill of materials, lowest step first: take from the chest before gathering, and make the tool a gather needs first.
- **When the next step's output won't fit in the inventory**, store the largest junk stack in a near chest. With no chest near, place one, or make one.
- Tools, weapons, armour and good food are never stored.

"Gather N of X" is the same model with a gathered item (`log`, `cobblestone`, `raw_iron`, `coal`, `diamond`, `sand`, `wheat`, `wheat_seeds`) as the goal.

## What the bot does with each step

| Step | Done with |
|---|---|
| gather `log` | `collectBlock` on the nearest log type |
| gather `raw_iron`, `coal`, `diamond` | `collectBlock` on the ore, deepslate too, with the best tool |
| gather `cobblestone` | `collectBlock` (stone drops cobblestone) |
| gather `wheat` | only ripe wheat (age 7) |
| gather `wheat_seeds` | breaks short or tall grass until it has them |
| gather `bone` | not possible by mining: the run stops |
| craft | `craftRecipe` (`planks` become the planks of the wood carried) |
| smelt | `smeltItem` on the source |
| place | `placeBlock` in the nearest free space |
| take / store | `takeFromChest` / `putInChest` on the nearest chest within 32 |

**Generic names:** the model says `log` and `planks` for every wood; the bot maps them to the wood it carries or finds.

**What counts as near:** a crafting table or furnace within 16 blocks, a chest within 32. The chest is opened once at the start to read its contents, and the bot keeps count of what it stores and takes after that.

**Safety check before acting:** each step must be possible:
- the right pickaxe for a gather;
- ingredients, plus a table near or carried, for a craft;
- the source, fuel and a furnace for a smelt;
- a placeable station that's carried, for a place;
- a chest near and a storable item, for a store.

A step that isn't possible, an answer below `min_confidence`, no answer, or "done" without the goal **stops the run** with the reason. Nothing is guessed. A run also stops after `max_steps` steps.

## Turning it on

1. **Serve a craft prompt `v2` model** (`craft-b` or later) with `golaya serve`. Prompt `v1` models such as `craft-a` don't fit.
2. **In `settings.js`,** set `"craft": { "enabled": true, "model": "craft-b", ... }`.
3. **In game:** `!layaCraft("iron_pickaxe", 1)`, `!layaGather("cobblestone", 32)` or `!layaGather("iron_ore", 8)`. Names such as `iron_ore`, `stone`, `oak_planks` and `wood` map to the model's items.

## From code

```js
const r = await skills.layaMake(bot, 'stone_pickaxe', 1); // {ok, reason, steps}
```

`layaMake` makes `count` **more** of the item than is carried. It's how other Laya skills, such as mining and farming, make what they need.

## Step log

Every step goes to `bots/<name>/logs/laya-craft.jsonl`, with:
- the goal and the state;
- the step and its confidence;
- the time;
- the outcome: `did`, `failed`, `done` or `stop` with a reason.

## Settings (the `craft` task)

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | off: the commands say so and nothing else changes |
| `server`, `model` | `golaya`, `craft-b` | who answers (see `docs/laya-client.md`) |
| `timeout_ms` | `2000` | per answer |
| `min_confidence` | `0.3` | a less sure step stops the run |
| `max_steps` | `40` | the most steps in one run |
| `log_steps` | `true` | the step log |

## Tests

- `test/laya_craft_state.test.js` checks the state against laya-go's v2 golden request and 300 of its generated situations, byte for byte. The fixtures are in `test/fixtures/laya-craft-v2/`.
- `test/laya_craft_loop.test.js` runs the loop with fakes: stepping, stopping, storage and the safety check.
