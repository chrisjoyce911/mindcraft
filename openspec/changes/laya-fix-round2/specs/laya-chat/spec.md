# laya-chat (delta)

## ADDED Requirements

### Requirement: The chat LLM can be switched off
With `settings.llm` false, the bot SHALL NOT call the chat LLM. Player chat SHALL go to the Laya command model;
when it can't act (chat, unsure, unknown, or the command task is off) the bot SHALL reply with a canned line
listing example commands. System, self and other-bot messages SHALL be logged and not answered. Typed
`!commands` SHALL run, except `!newAction` and `!goal`, which are refused with a short reply. The default
(`llm` unset or true) SHALL keep the upstream behaviour.

#### Scenario: an interrupt with the LLM off
- **WHEN** a mode interrupts `!layaMine` with `llm` false
- **THEN** no auto-message is sent to the LLM and the mine job resumes

#### Scenario: plain chat with the LLM off
- **WHEN** a player says "hi andy" and the command model answers `chat`
- **THEN** andy replies with the canned line

#### Scenario: death with the LLM off
- **WHEN** andy dies with `llm` false
- **THEN** he says where he died and stays stopped
