# Proposal

## Why

Live play on 2026-11-11 (`bots/andy/logs/game-tests/live-play-2026-11-11.md`, bot log
`bot-2026-11-11_07-46-34.log`, `laya-*.jsonl`), models only (no chat LLM), showed code bugs in the actuators,
state and reporting. Bot code is sensors, actuators and the job stack: the Laya models decide. These fixes add no
decision rules. Code that must still choose something logs it as a rule step.

1. HIGH: `director:heal` ignored interrupts (a 10 s sleep with no food), so defend couldn't take over and andy was
   shot dead by a skeleton.
2. HIGH: unstuck interrupted `!layaGather`. The collect didn't stop: `pathfinder.stop()` waits for the next path
   node, which a stuck bot never reaches, and `cancelTask()` every 300 ms leaked `collectBlock_finished`/`error`
   listeners. After 10 s the process was killed, and the restart forgot the home chest because memory_bank places
   weren't saved.
3. MED: "craft sward" ended with no sword and no message. The first take recorded 1 plank when it took all 5 (bulk
   take), so the next take failed against a chest that was already empty.
4. MED: "put your stuff in chest" stored coal, torches and sticks.
5. LOW: the model crafted a second stone pickaxe for a goal of 1. A torch craft fell back with `needs-coal` while the
   chest had coal.
6. LOW: andy held an arrow or a torch in his main hand.
7. LOW: count `any` replies didn't say the count the way the player asked ("Mining 4 iron").
8. LOW: the director model server was unreachable once.

## What Changes

- Director activities (eat, heal, unload) wait in steps of at most 100 ms and end when `bot.interrupt_code` is set.
  When the director answers something else while one runs, it is stopped (a resumed job is not).
- Interrupts clear the pathfinder goal and call collectBlock's `cancelTask()` once per stuck task. `collectBlock`
  and `pickupNearbyItems` stop on an interrupt.
- `memory.json` gets `places` (memory_bank), written on every change and loaded with the memory on a restart.
- Craft: a take or store records what really moved (the change in the pack). A failed take re-reads the chest once
  and goes on. A step that makes more of a goal that is already carried is refused (`goal-carried`). A craft
  missing an ingredient that the known chest holds takes it first (rule step `take`). A Laya job that ends without
  its goal says why in chat.
- "Store everything" keeps coal, charcoal, torches, sticks, tools, weapons, armour and food.
- When idle (after a job or a pickup), andy holds his best weapon, else keeps a tool in hand, else holds his best
  pickaxe, else holds nothing.
- Replies say the count: "Mining 4 iron.", "Gathering 8 logs.", "Making 1 wooden sword."
- Laya client: an unreachable server is retried once at once, then not asked for a back-off of 1 s doubling to
  10 s (the callers use their rules). Entering and leaving back-off is logged.

The director's rules (`decide`) and state text are unchanged (laya-go `games/director`).

## Capabilities

### Modified Capabilities
- `laya-jobs`: activities stop at once; interrupts end stuck collects; places survive a restart; failed jobs say
  why; the hand; client back-off.
- `laya-craft`: take/store bookkeeping, retry, goal carried, ingredients from the chest; the store keep-list;
  count replies.

## Impact

`src/agent/{agent,interrupt,memory_bank,history}.js`, `src/agent/laya/{activities,hand,job_message,craft,command,director}.js`,
`src/agent/library/skills.js` (collectBlock, pickupNearbyItems), `src/agent/commands/actions.js`, `src/models/laya.js`,
`test/laya_fix_round3.test.js`.
