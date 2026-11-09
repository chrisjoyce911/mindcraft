# Laya command: chat to commands without the LLM

With the `command` task on, every player message is first put to a small Laya decision model, laya-go's `command` game. The model says whether the message is for this bot, which command it asks for, and the item, tier and count it names.
- **Clear commands** run at once through the bot's ordinary command system, the same `!followPlayer`, `!givePlayer` and so on the LLM would write. They take milliseconds, with no LLM call.
- **Chat, unsure answers and failures** go to the LLM as before.

## What the model is asked (prompt `v1`)

```
Command.
Me andy From chrisjoyce911
Said andy can you craft me 2 iron picks please
```

The message is normalised exactly as laya-go does (`normalize` in `src/agent/laya/command_state.js`):
- lower case;
- apostrophes dropped;
- other punctuation as spaces;
- at most 120 characters.

The model answers five questions:
- `Addressed`: is the message for me;
- `Command`;
- `Item`: a kind such as wood, iron, pickaxe or zombie;
- `Tier`;
- `Count`.

## From answer to command

`resolve()` turns the Item kind into a Minecraft item using the bot's inventory. Its rules are laya-go's `generate.Resolve`, checked case for case in the tests. `plan()` then writes the command lines:

| Command | Runs |
|---|---|
| follow | `!followPlayer(speaker, 3)` (the Laya follow model, if that task is on) |
| come | `!goToPlayer(speaker, 2)` |
| stop / stay | `!stop` / `!stay(-1)` |
| gather | `!layaGather(item, n)`, or `!collectBlocks` without the craft task's commands. No count said: 8. |
| mine | `!layaMine(item, n)` if it exists, else `!layaGather`, else `!collectBlocks(ore block)`. No count: 4. |
| craft | `!layaCraft(item, n)`, else `!craftRecipe`. A tool without a tier: the best tier the inventory allows. |
| give | `!givePlayer(speaker, item, n)` with the largest matching carried stack. "All" gives the whole stack; "everything" gives every stack. Asking for more than it has gives what it has ("I only have 3 bread"). Not carried: "I don't have any …". |
| attack | `!attack(mob)`; "defend me" / "kill it" attacks the nearest hostile mob |
| store | `!putInChest(item, n)`; "everything" stores all but tools, weapons, armour and food |
| eat | `!consume(food)`; no food named: the best good food carried |
| inventory | `!inventory` |
| chat | the LLM, as before |

**Not for this bot:** with Addressed below 0.15 the message is ignored. That covers "bob, follow me" said to andy, or a player talking to someone else.

**Unsure:** Addressed between 0.15 and 0.5, or Command below `min_confidence` (0.6), goes to the LLM.

**No LLM at all:** set `no_llm: true`. Chat and unsure messages then get a short canned reply instead of an LLM call, which lets the bot run with no LLM.

Every decision is logged to `bots/<name>/logs/laya-command.jsonl`: the state, the answers, what was run, or why it went to the LLM.

## Settings (`decision_models.tasks.command`)

| Setting | Default | |
|---|---|---|
| `enabled` | false | off: every message goes to the LLM as before |
| `server`, `model` | `golaya`, `command-a` | |
| `timeout_ms` | 500 | |
| `min_confidence` | 0.6 | Command's top probability needed to act |
| `addressed_min`, `ignore_below` | 0.5, 0.15 | see above |
| `no_llm` | false | canned reply instead of the LLM |
| `log_decisions` | true | |

## Trying it

1. Serve the trained model: `golaya serve -dir <folder with command-a>`.
2. Set `enabled: true` and run `npm run laya:check`.
3. Try these in game:
   - "andy follow me"
   - "get me 10 logs"
   - "make a pickaxe"
   - "give me your bread"
   - "kill that zombie"
   - "put your stuff in the chest"
   - "what do you have"
   - "bob come here" (should be ignored by andy)
   - "hi andy" (goes to the LLM)
