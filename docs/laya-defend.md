# Laya defend

With the `defend` task on, the bot fights, flees or holds off hostile mobs with a Laya decision model (laya-go's `defend` game, prompt `v1`) instead of Mindcraft's `self_defense`, `cowardice` and low-health `self_preservation` behaviour. Those modes stay as the fallback.

## How it works

**When it starts.** The `laya_defending` mode runs before `cowardice` and `self_defense`. When a mob is **active** it starts an engagement, which interrupts the current action, as `self_defense` does. Active means a hostile mob within its notice range: 8 blocks, 12 for witches, 15 for skeletons and strays. Spiders count only at night.

**Each step** (every `step_ms`, 400 ms):
1. The bot builds the state (`src/agent/laya/defend_state.js`):

   ```
   Defend.
   Health 14 Food 12 Armor 8 Night yes Player no
   Weapons iron_sword bow
   Arrows 12 Shield yes Apples 1
   Mobs zombie E2 N2 H20 skeleton W12 S4 H20
   ```

2. It asks the model Action, Target, Weapon and Danger.
3. It carries out the answer (`defend_actions.js`):

| Action | What the bot does |
|---|---|
| fight | hold the weapon; walk up and strike, or draw and loose the bow |
| shield | raise the shield while closing in, then strike |
| backoff | step back with the pathfinder; shoot if the weapon is the bow |
| flee | run from the target with the pathfinder (up to 1.5 s per step) |
| eat | eat a golden apple |
| ignore | end the engagement; stay quiet for `quiet_ms` |

**When it ends:** the mobs are no longer active, the model says ignore, a fallback starts, or 60 seconds pass. Moving always uses the pathfinder, which never paths into lava or off a dangerous drop.

**Safety rules** (`defend.js`) apply laya-go's safety-critical rules to every answer:
- **Close creeper:** fighting or shielding against a creeper within 4 blocks becomes **flee** (counted as a creeper override), unless the bot is strong (health ≥ 14, armour ≥ 15, iron sword or better) and the creeper is alone. Shooting it is allowed.
- **Refused, so the ordinary modes take over for `fallback_ms`:**
  - ignoring a melee mob within reach;
  - eating with no golden apple;
  - fighting with no target;
  - a bow with no arrows.
- **Weapon not carried:** fights bare-handed.

**Other fallbacks:** no answer or a low-confidence answer also hands defence to the ordinary modes for `fallback_ms`.

**Mobs:**
- The bot's state lists up to 4 of laya-go's eight kinds within 16 blocks, nearest first, in laya-go's order.
- Mob health is used when the server sends it; otherwise it's taken as full.
- **Weapons:** at most 3: the bow and the best melee weapons by damage per second.
- **Armour:** the worn pieces' defence points.
- **Player:** whether another player is within 8 blocks.

## Settings (`decision_models.tasks.defend`)

| Setting | Default | Meaning |
|---|---|---|
| `enabled` | `false` | off: the ordinary modes defend as before |
| `server`, `model` | `golaya`, `defend-a` | who answers |
| `min_confidence` | `0.4` | Action and Target must reach this |
| `step_ms` | `400` | pause between decisions |
| `fallback_ms` | `8000` | ordinary modes defend this long after a fallback |
| `quiet_ms` | `3000` | after ignore, wait this long before engaging again |
| `log_steps` | `true` | `bots/<name>/logs/laya-defend.jsonl`: state, answer, outcome |

Every 10 minutes the bot prints a summary line: engagements, actions, creeper overrides, fallbacks and vetoes.

## Tests

`test/laya_defend.test.js` covers:
- the contract test: a fake bot's state and questions equal laya-go's golden request (`test/fixtures/laya-defend-v1/`);
- mob order and weapon choice;
- the safety rules;
- the engagement loop with fakes.
