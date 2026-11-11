# bot-commands

## ADDED Requirements

### Requirement: Typed commands
Player chat SHALL go to the command model and be turned into a typed `Command` (`job` with a typed `JobSpec`, `stop`,
`chores on|off`, `reply`, `ignore`). No `!command(...)` text SHALL be built or parsed inside the bot, and no code SHALL
be evaluated, except the legacy parser at the harness boundary.

#### Scenario: mine command
- **WHEN** a player says "mine 8 iron"
- **THEN** the command model's answers become `{kind:'job', job:{kind:'mine', ore:'iron', count:8}}` and the mine job
  starts, logged to `laya-command.jsonl` as today

### Requirement: Legacy command text at the boundary
The harness SHALL accept today's `!name(args)` lines (as sent by `andy_command` and the game scenarios) and parse them
into the same typed `Command`, for every command the scenarios use. Unknown or malformed lines SHALL be answered with an
error message, never evaluated.

#### Scenario: harness sends a legacy command
- **WHEN** the harness sends `!layaMine("iron", 3)`
- **THEN** it becomes `{kind:'job', job:{kind:'mine', ore:'iron', count:3}}`

### Requirement: No LLM
The bot SHALL contain no chat LLM, prompter, conversation history, code generation, eval, vision or speech. A message the
command model can't place SHALL get the canned reply (today's `no_llm` behaviour) or be ignored by the addressed
threshold.

#### Scenario: chit-chat
- **WHEN** a player says "nice weather"
- **THEN** andy answers with the canned help line or ignores it, and no network call other than golaya is made
