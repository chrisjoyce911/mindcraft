# Laya farming

`!layaFarm(minutes)` farms nearby with laya-go's **farm** decision model. At each step the bot:
1. reads the 9×9 cells around it, what it carries and the adult animals within 16 blocks (`src/agent/laya/farm_state.js`);
2. asks the model for an **Action**, **Target** and **Item**;
3. checks the answer with a safety veto;
4. carries it out (`src/agent/laya/farm_actions.js`).

## What it does

| Action | In the game |
|---|---|
| harvest | breaks the ripe crop and picks up the drops |
| plant | plants the seed on the empty farmland |
| till | clears grass on top, then uses the hoe on the ground |
| water | digs out the dry farmland and pours the water bucket into the hole |
| bone_meal | uses bone meal on the growing crop |
| breed | feeds the two nearest adults of the kind |
| wait | nothing for a moment |

**Getting what it needs:**
- **Before starting:** if it has no hoe or no seeds, it gets them.
- **During farming:** when an answer needs an item it doesn't carry (a water bucket, bone meal, a seed), it gets that item, then reads its farm again.
- **How it gets items:** through `craft(item, count)`, which uses the craft task's `runCraft` when the `laya-craft` change is in. Otherwise it uses Mindcraft's skills:
  - a wooden hoe;
  - seeds from breaking grass;
  - a crafted bucket, filled at the nearest water;
  - bone meal.

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
| `min_confidence` | 0.5 | Action and Target must reach it, or the bot waits a moment |
| `step_ms` | 500 | the pause after a wait or a refused step |
| `max_steps` | 400 | the most steps in one `!layaFarm` |
| `log_steps` | `true` | `bots/<name>/logs/laya-farm.jsonl`: each step's state, answer and outcome, and each item crafted |

**Model and prompt:** see laya-go's `docs/farm.md`. A contract test (`test/laya_farm.test.js`) checks that the bot's state equals laya-go's golden request byte for byte.
