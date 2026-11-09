# Proposal

## Why

The long-term aim is a Mindcraft bot whose moment-to-moment decisions come from small local **Laya decision models**: millisecond answers, runnable by anyone on a CPU. The large language model is kept only for what needs language, such as chat and setting goals. Each stage moves one kind of decision from the LLM to a Laya model.

**Following a player is the first stage.** The decision is local and frequent: which way to step next, safely. The model for it is being trained now in [laya-go](https://gitlab.com/lnkz/laya-go) (`games/follow`, prompt `v1`). There, a 9×9 window was measured to be enough for 96.5% of walks on mixed terrain, with zero harm.

This change connects that model to the bot: build what the model reads from the real Minecraft world, ask it, take the step, and fall back to today's pathfinder whenever the model can't help.

## What Changes

- **Settings:** a new `laya` block in `settings.js`:
  - `enabled`, **off by default**, so nothing changes unless it's turned on;
  - the `golaya serve` URL and the model id;
  - the step interval;
  - the confidence threshold for the model's top move.
- **A Laya client** (`src/models/laya.js`): asks `POST /v1/decisions` with a short timeout, and treats any failure as "no answer".
- **The follow state** (`src/agent/laya/follow_state.js`): reads the 9×9 columns around the bot from the world and writes laya-go's prompt `v1` state text exactly.
  - `Follow.`, then the player's offset, then nine rows of one character per cell.
  - Each cell gives its surface and its height relative to the bot, from −8 to +8: ground `H`–`A` / `0` / `1`–`8`, water `P`–`I` / `W` / `Q`–`Y`, harmful `!`, unknown `?`.
  - Real blocks are mapped to that world:
    - the highest standable block with headroom, within 8 blocks of the bot;
    - fences and walls count as walls;
    - lava, fire, magma, cactus, berry bushes and the like count as harmful (`!`);
    - water as water;
    - nothing to stand on within 8 below counts as a deep drop;
    - unloaded chunks are unknown.
- **The follow loop** (`src/agent/laya/follow.js`), used by `!followPlayer` when `laya.enabled` is on.
  - Every step, it asks the model `Move` and `Hazard` and takes a one-block step with mineflayer's pathfinder.
  - A **safety veto** applies laya-go's harm rules to the same grid. It refuses any step onto `!`, any drop of four or more onto anything but water, any climb of two or more, and any corner cut. The model proposes and the rules dispose.
  - It **falls back** to the existing pathfinder follow for a few seconds when:
    - the model is unreachable;
    - its top probability is below the threshold;
    - it says `wait` while the bot hasn't arrived;
    - the veto refuses a step;
    - the bot is stuck.
- **Measurements:** each follow session records Laya steps, fallbacks by reason, vetoes, damage taken and time stuck. Each step's state, answer and outcome is logged to `bots/<name>/logs/laya-follow.jsonl`, both for judging the model in the game and as future self-play training data.
- **Tests** with Node's built-in runner (`npm test`):
  - laya-go's golden request is copied in as a fixture, and the state builder must reproduce its state text byte for byte from the same terrain;
  - the alphabet, the block mapping, the veto and the fallback decisions are tested with fake worlds and a fake Laya server.
- **Not in this change:**
  - other decisions (mining, crafting, eating, fighting);
  - mobs;
  - training on the logged steps;
  - removing or changing the LLM's commands. The LLM still chooses to follow; Laya only decides each step.

## Capabilities

### New Capabilities
- `laya-follow`: following a player with a Laya decision model: the settings, the client, the follow state built from the world, the safety veto, the fallback rules, the session measurements and step log, and the contract with laya-go's prompt `v1`.

### Modified Capabilities

## Impact

- **New code:**
  - `src/models/laya.js`;
  - `src/agent/laya/` (`follow_state.js`, `follow.js`);
  - `test/` (node:test) with `test/fixtures/laya-follow-v1/`.
- **Changed:**
  - `settings.js` gains the `laya` block (off by default);
  - `skills.followPlayer` hands over to the Laya loop when it's on;
  - `package.json` gains a `test` script.
- **Runtime:** a `golaya serve` process with a follow model. Until a trained model exists, an untrained one exercises the plumbing, and the veto and fallback keep the bot safe.
- **Untouched:** the LLM, its prompts and commands, and every other behaviour while `laya.enabled` is off.
- **Testing in the game** happens on the Mac mini, or between training runs: the Mac Studio's cores belong to the training comparison while it runs.
