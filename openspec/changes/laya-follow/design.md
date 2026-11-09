# Design

## Context

- **laya-go** (`~/lnkz/laya-go`, branch `minecraft`) defines the follow task:
  - `docs/follow.md` gives the rules;
  - `games/follow/prompt` gives prompt `v1`;
  - `games/follow/prompt/testdata/v1_sample_request.json` is the golden request.

  A model trained there is served by `golaya serve` (`POST /v1/decisions`, model id = its folder path under the served directory).
- **Mindcraft today:** `!followPlayer` runs `skills.followPlayer`, which sets mineflayer-pathfinder's `GoalFollow` and loops every 500 ms, handling doors, modes and cheat teleports. The LLM chooses the command; the pathfinder does every step.
- **The model reads a 2.5D world:** one column per X, Z with a height and a surface. Minecraft is 3D. The mapping below decides what each real column looks like to the model, so it must be conservative where the two worlds differ.

## Goals / Non-Goals

**Goals:**
- Byte-identical `v1` state text, enforced by a test against laya-go's golden request.
- **Never worse than today:** with Laya on, a harmful step is vetoed by rules, and anything uncertain falls back to the pathfinder.
- Measurements and a step log that show whether Laya helps.

**Non-Goals:**
- Replacing the LLM, any other command, or modes.
- Mobs, combat or eating during follow (later Laya stages).
- Teaching the model from the logged steps (a later laya-go change reads the log).

## Decisions

### Settings (the `follow` task, from `laya-client`)
```js
"follow": {
    "enabled": false,           // laya-client: when on, !followPlayer steps with Laya
    "server": "golaya", "model": "follow-a", "timeout_ms": 300, "min_confidence": 0.4,
    "step_ms": 250,             // a decision every quarter second
    "fallback_ms": 4000,        // how long to use the pathfinder after a fallback
    "log_steps": true           // bots/<name>/logs/laya-follow.jsonl
}
```
- **Asking:** the loop asks with `decide("follow", state, questions)` and treats `null` as "fall back", with laya-client's reason.
- **Low confidence:** comes from the answer's `confident` flag.

### Reading a column from the world
For each of the 81 columns (bot at the centre, X east, Z south, north first), with `base` the Y of the block under the bot's feet:

1. **Unloaded:** if `bot.blockAt` returns null anywhere it is needed, the cell is unknown (`?`).
2. **Find the stand block:** scan Y from `base + 8` down to `base − 8`. The stand block is the first block `B` that is **standable** with **two passable blocks** above it.
   - **Standable:** a solid block (its bounding box is a block), water, or lava.
   - **Passable:** an empty bounding box (air, grass, flowers, open doors) that isn't water or lava.
3. **Surface:**
   - **Water** for water;
   - **harmful (`!`)** for lava, fire, soul fire, magma, campfire, soul campfire, cactus, sweet berry bush, powder snow, wither rose, and for a column whose passable blocks include fire;
   - **ground** otherwise.
4. **Walls:** fences, walls, fence gates and closed doors are 1.5 blocks or more and can't be stepped onto. When the scan reaches one before a stand block, the column is ground at `B + 2` relative height or higher, which the model reads as a wall.
5. **Nothing found:**
   - air all the way down to `base − 8`: ground at −8 (`H`), a harmful drop;
   - solid all the way from `base + 8`: ground at +8 (`8`), a wall.
6. **Height** is `B − base`, clamped to ±8.
7. **The bot's own column** is written `0`, or `W` when the bot stands in water, as laya-go requires.

Partial blocks (slabs, snow layers, carpet, farmland) count as their block's Y. A half block of error never turns a safe step into a harmful one. Leaves are solid and standable.

### State text
Exactly laya-go `v1`:
- `Follow.\nPlayer E12 N3\n` and nine rows of nine characters, joined by single newlines, with no other whitespace.
- **Player offset:** `round(player.x) − botX`, `round(player.z) − botZ`.
- **Alphabet tables** are copied from laya-go's `prompt.go`, and the golden test pins them. The golden request is the one `laya-client` already copied into `test/fixtures/laya-follow-v1/`.

### The loop
Each `step_ms`:
1. Stop when `bot.interrupt_code` is set, as today.
2. If within `follow_dist` of the player, wait (there's no need to ask).
3. Build the state and ask. **Fall back** if:
   - there's no answer;
   - the top `Move` probability is below `min_confidence`;
   - the top move is `wait` while the bot hasn't arrived for more than two steps in a row.
4. **Veto** if the move is harmful or illegal on the grid, using laya-go's rules:
   - a climb of two or more;
   - a drop of four or more not into water;
   - `!`;
   - a diagonal that goes up, or that passes a non-enterable or higher orthogonal neighbour;
   - `?`.

   A veto counts and falls back.
5. **Otherwise step:** set pathfinder `GoalBlock` to the target column at its stand height + 1, and wait until the bot reaches it or 1.5 s pass. If it hasn't moved after 1.5 s, that counts as stuck and falls back.

**Fallback:** run the existing `GoalFollow` behaviour for `fallback_ms`, then hand back to Laya.

The existing loop's door handling, mode pausing and cheat teleport stay in the fallback path. The Laya path pauses the same modes while following.

### Measurements and step log
- **Session counters:**
  - steps asked and taken;
  - fallbacks by reason (no answer, low confidence, wait, veto, stuck);
  - damage taken (sum of `health` drops);
  - seconds stuck;
  - mean answer time.

  They're logged when the follow ends, and on request with a `!stats`-style line in the bot log.
- **Step log:** each step adds one JSON line: time, state, the answer's top move and probability, the hazard probability, what happened (stepped, vetoed, fallback reason), and whether health dropped within the next second. These lines are laya-go's future self-play input.

### Tests (`node --test test/`)
- **Contract:**
  - a fake world built from laya-go's golden sample terrain (`sampleMap`, bot (1, 3), player (13, 0)) must produce exactly the `state` in the copied `v1_sample_request.json`;
  - the questions the client sends must deep-equal the fixture's.
- **Alphabet:** every surface and height from −8 to +8 round-trips, and values beyond ±8 clamp.
- **Block mapping:** fences become walls, magma becomes harmful, nothing below becomes a deep drop, and unloaded becomes `?`.
- **Veto:** each harmful and illegal case from laya-go's `world` scenarios.
- **Loop decisions** with a fake Laya server: low confidence, `wait`, a timeout and a veto each fall back with the right reason.

## Risks / Trade-offs

- **2.5D mapping errors in caves, under trees and on stairs.** These are covered by the veto, then fallback, and the step log shows where they happen.
- **One-block steps through the pathfinder are slower** than one continuous pathfinder follow. A decision every 250 ms at walking speed (about 4.3 blocks a second) keeps pace. If the bot lags the player, `step_ms` and multi-step moves can be tuned once there's data.
- **An untrained model** answers about uniformly, so it mostly falls back on low confidence. That is the right behaviour, and it proves the plumbing until a trained model is served.
