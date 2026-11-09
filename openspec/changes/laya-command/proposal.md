# Proposal

## Why

Every player instruction goes through the LLM, even "follow me" or "get me 10 logs". laya-go's `command` model turns such messages into commands in milliseconds on the CPU. That leaves the LLM for real conversation, or lets the bot run without one.

## What Changes

- **A `command` decision task** (off by default) in `settings.decision_models.tasks`.
- **`src/agent/laya/command_state.js`** builds laya-go command prompt `v1` (the state, the five questions, message normalisation) and mirrors `Resolve`, which turns an item kind into a Minecraft item using the inventory.
- **`src/agent/laya/command.js`** decides each player message.
  - **Clear commands** run through the ordinary command system:
    - `!followPlayer`, `!goToPlayer`, `!stop`, `!stay`, `!inventory`;
    - `!layaGather`, `!layaMine` or `!layaCraft` when present, else `!collectBlocks` or `!craftRecipe`;
    - `!givePlayer` (giving: against the inventory), `!attack`, `!putInChest`, `!consume`.
  - **Messages for someone else** are ignored.
  - **Chat and unsure answers** go to the LLM. With `no_llm` they get a canned reply.
- **`agent.handleMessage`** asks the task first for player messages, after explicit `!commands`.
- **Every decision is logged** to `bots/<name>/logs/laya-command.jsonl`.

## Capabilities

### New Capabilities
- `laya-command`: player messages to commands with the Laya command model, giving included.

### Modified Capabilities

## Impact

- **New:** `src/agent/laya/command_state.js`, `src/agent/laya/command.js`, `test/laya_command.test.js`, `test/fixtures/laya-command-v1/`, `docs/laya-command.md`.
- **Changed:** `src/agent/agent.js` (one hook) and `settings.js` (the `command` task).
