# Laya mine

The `mine` task finds ore underground with a small Laya decision model, laya-go's `mine` game (see `docs/mine.md` in laya-go). It's off by default.

## Using it

1. Serve a mine model: `golaya serve -dir data/serve` with `mine-a` in it.
2. Set `decision_models.tasks.mine.enabled` to `true`, and check with `npm run laya:check mine`.
3. Ask the bot: `!layaMine("iron", 3)`, or in words ("mine 3 iron").

With the task off, `!layaMine` collects the nearest ore blocks, as `!collectBlocks` does.

## What it does

Each step, the bot sends laya-go's mine prompt v1:

```
Mine.
Ore iron Y 41 Pick stone Torches 6 Blocks 20 Dark 7 Heading E
Seen none
ASSSS AASSS SSSSS SSSSS SSSSS
SSSSS SSSSS SSSSS SSSSS SSSSS
SSSSS AAASS AAASL SSSSL SSSSS
SSSSS SSSSS SSSSS SSSSS SSSSS
SSSSS SSSSS SSSSS SSSSS SSSSS
```

- **Status line:** the ore, feet height, best pickaxe, torches, throwaway blocks (cobblestone, dirt and the like), blocks dug since the last torch, and heading.
- **Seen:** the distance to the nearest target ore within 16 blocks.
- **View:** the 5×5×5 blocks around the bot. Cells are `S` solid, `A` air, `W` water, `L` lava, `O` ore and `B` bedrock.

It runs the model's step as a short macro:

| Step | Macro |
|---|---|
| `collect` | the collect skill on the nearest ore block |
| `tunnel N/E/S/W` | dig head and feet ahead, step in |
| `down N/E/S/W` | stairs down: dig head, feet and floor ahead, step down |
| `up N/E/S/W` | stairs up: dig above the head, and head and above ahead, step up |
| `torch` | place a torch behind |
| `block` | fill lava or water touching the bot with a throwaway block |
| `stop` | craft a better pickaxe if that's the reason, otherwise stop |

It never digs straight down.

## Safety and fallbacks

**The veto:** laya-go's unsafe rules are ported to `mine_state.js`. A step is refused when it digs lava, water or bedrock, digs a block with lava or water behind it, or leaves nothing solid to stand on.

**The bot takes laya-go's rule answer (`decide`) instead when:**
- there's no answer;
- the answer isn't confident (`min_confidence`);
- the veto refuses it;
- the answer makes no sense: `collect` with no ore in sight, `block` with no fluid or no blocks, `torch` without torches, or `stop` while a step is possible.

**It gives up** after `max_steps` steps, after `max_failures` failed steps in a row, or when trapped.

## Crafting

It crafts what it needs through `skills.craftForTask`, which uses the Laya craft task's `runCraft` when present, otherwise `craftRecipe`:
- **A pickaxe:** stone for iron, copper and lapis; iron for gold, redstone and diamond. It crafts one before starting, when the model stops for a weak pickaxe, and when the pickaxe breaks.
- **Torches:** `torch_batch` of them when they run out with 8 or more dark blocks.

## Settings

| Setting | Default | |
|---|---|---|
| `enabled` | `false` | off: `!layaMine` collects the nearest ore |
| `server`, `model` | `golaya`, `mine-a` | |
| `timeout_ms`, `min_confidence` | 300, 0.4 | |
| `max_steps`, `max_failures` | 300, 4 | |
| `torch_batch` | 4 | |
| `log_steps` | `true` | `bots/<name>/logs/laya-mine.jsonl`: state, rule answer, model answer, the step taken and its outcome |

## Tests

- **`test/laya_mine_state.test.js`:** the golden state against laya-go byte for byte, the rules port, and the rules port against 300 laya-go answers.
- **`test/laya_mine_loop.test.js`:** the loop in a fake world.
