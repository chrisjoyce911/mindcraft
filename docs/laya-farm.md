# Laya farming

`!layaFarm(crop, count)` farms nearby with laya-go's **farm** decision model. Both arguments are optional:

| Command | Does |
|---|---|
| `!layaFarm` or `!layaFarm("any")` | farms any crop until stopped (`!stop`), unloading into the home chest when the pack fills |
| `!layaFarm("wheat")` | farms until stopped, planting wheat where it can |
| `!layaFarm("carrots", 20)` | farms until 20 carrots have been harvested since it started, then stops |
| `!layaFarm(3)` | the old form: a lone number is minutes, any crop |

Crops: `wheat`, `carrots`, `potatoes`, `beetroot`, `any`. The count is of the crop's produce (wheat, carrots, potatoes, beetroot; any of them for `any`), measured at each harvest, so replanting and unloading don't change it, and it carries over when a fight interrupts farming.

At each step the bot:
1. reads the 9×9 cells around it, what it carries and the adult animals within 16 blocks (`src/agent/laya/farm_state.js`); with prompt v2 also the crop asked for and its pack;
2. asks the model for an **Action**, **Target** and **Item** (and with v2 **Unload**);
3. checks the answer with a safety veto;
4. carries it out (`src/agent/laya/farm_actions.js`).

## Prompt v2

laya-go's farm prompt v2 (`games/farm/prompt`, change `farm-v2`) is v1 with two lines after `Farm.`:

```
Farm.
Crop carrots
Pack 5 Home 12 Health 20 Food 18 Hostiles 0 Valuables 6
Carry hoe x1 bone_meal x3 wheat_seeds x12 carrot x5
...
```

- **Pack** is the same line as mine v2 (`src/agent/laya/pack.js`): free slots, the distance to the home chest (memory place `home_chest`, `none` when unknown), health, food, hostile mobs within 16, and Valuables: the harvested crops carried beyond the seeds and food kept.
- **Actions** add `pond` and `find_water`; **Target** adds the nearest dry ground; **Unload** asks "I should go and empty my pack into the home chest now."
- When the model isn't sure, a port of laya-go's v2 rules decides (`farm_state.decide`; checked against 400 generated laya-go situations).

## What it does

| Action | In the game |
|---|---|
| harvest | breaks the ripe crop and picks up the drops |
| plant | plants the seed on the empty farmland |
| till | clears grass on top, then uses the hoe on the ground |
| water | digs out the dry farmland and pours the water bucket into the hole |
| bone_meal | uses bone meal on the growing crop |
| breed | feeds the two nearest adults of the kind |
| pond | (v2) digs a 1-block hole in dry ground and pours the water bucket in, so the ground around is near water; refused if the water could flow out |
| find_water | (v2) no water to farm with here: see below |
| wait | nothing for a moment |

**Getting what it needs:**
- **Before starting:** if it has no hoe or no seeds, it gets them.
- **During farming:** when an answer needs an item it doesn't carry (a water bucket, bone meal, a seed), it gets that item, then reads its farm again.
- **How it gets items:** through `craft(item, count)`, which uses the craft task's `runCraft` when the `laya-craft` change is in. Otherwise it uses Mindcraft's skills:
  - a wooden hoe;
  - seeds from breaking grass;
  - a crafted bucket, filled at the nearest water;
  - bone meal.

## No water, no endless waiting

The user's first trial was a savanna plateau far from water: every cell was `L` (dry ground), and the v1 model answered `wait` 73 times in a row. Now:

- **With a water bucket** (and a hoe and seeds) the v2 rules make a **pond**; with any prompt, a `wait` in a view with no water and nothing growing becomes a pond on the nearest dry ground.
- **Without one**, `find_water` (or a `wait` in a dry view with nothing growing): the bot looks for a water source within `water_radius` (64) blocks, walks there and carries on farming. If there is none, or it's still dry after walking there, it says **"No water near here — take me to water or give me a water bucket."** and stops.
- A water bucket is only made from what's there: a carried bucket or 3 iron ingots, and water within `water_radius`.
- **Wait limit:** after `wait_limit` waits (or unsure v1 answers) in a row with nothing growing in view, it stops. While crops grow it keeps waiting.

## Unloading (v2)

**Setting the home chest** (`src/agent/laya/home_chest.js`), the chest block's exact position saved as `home_chest`:
- `!setHomeChest`: the chest (chest, trapped chest or barrel) nearest the player who spoke last, within 8 blocks;
- in chat, "andy this is your chest" (the command game's `home` command) runs `!setHomeChest`: "That's my chest now.";
- a sign with the bot's name on or next to a chest within 32 blocks: when no home chest is saved, the bot adopts it and says so.

A full home chest spills into the chests touching it (the other half of a double chest, chests beside, above or below).

With a home chest known the bot unloads when the model is sure Unload is true, or the rule says so when it isn't sure (laya-go `pack.Unload`: free ≤ 2; free ≤ 6 with home within 24; 4+ valuables when hurt, hungry or among 2+ mobs), and always when no slot is free. It walks to the chest, puts in everything except tools, buckets, bone meal, food and up to `keep_seeds` (16) of each seed (carrots and potatoes count as seeds; wheat and beetroot all go), walks back to where it was farming and carries on. With a full pack and no home chest it says so once.

## Safety

- **Veto:** the target must fit the action:
  - a ripe crop to harvest;
  - empty farmland and a seed to plant;
  - grass or dirt to till;
  - dry farmland to water;
  - a growing crop for bone meal;
  - two adults and one of their foods to breed.
- **No trampling:** movement avoids farmland and crop blocks, with no parkour or sprinting. The bot stands next to its target, never on the farm.
- **No flooding:** water only goes into a hole whose four sides are solid.

## Settings (`decision_models.tasks.farm`)

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | off: `!layaFarm` says so and does nothing |
| `server`, `model` | `golaya`, `farm-a` | who answers |
| `prompt` | `v2` | `v2`: crop, pack, Unload, pond, find_water, rules when unsure; `v1` for a v1 model (`farm-a`) |
| `min_confidence` | 0.5 | Action and Target must reach it, or (v1) the bot waits a moment / (v2) the rules decide |
| `step_ms` | 500 | the pause after a wait or a refused step |
| `max_steps` | 400 | the most steps of a timed `!layaFarm(minutes)`; a count or "until stopped" has no step limit (`max_steps_open`) |
| `wait_limit` | 20 | waits in a row with nothing growing before it stops |
| `water_radius` | 64 | how far it looks for water |
| `keep_seeds` | 16 | seeds of each kind kept when unloading |
| `log_steps` | `true` | `bots/<name>/logs/laya-farm.jsonl`: each step's state, answer and outcome, and each item crafted |

**Model and prompt:** see laya-go's `docs/farm.md`. Contract tests (`test/laya_farm.test.js`) check that the bot's v1 and v2 states equal laya-go's golden requests byte for byte (`test/fixtures/laya-farm-v1/`, `laya-farm-v2/`), and that the rules port agrees with laya-go on generated situations. `npm run laya:check farm` asks the sample of the task's prompt.

**Until a v2 model is served** `farm-a` (a v1 model) gets v2 requests: its unsure or failed answers fall to the v2 rules, and a confident `wait` in a dry view still turns into a pond or a walk to water. Set `prompt: 'v1'` to use it as before.
