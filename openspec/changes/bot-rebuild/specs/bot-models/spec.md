# bot-models

## ADDED Requirements

### Requirement: Models stay behind golaya serve
The bot SHALL be a thin client of `golaya serve` (`GET /v1/models`, `POST /v1/decisions`), with per-task server, model,
prompt version, timeout and minimum confidence from settings, the served prompt version read from `/v1/models`, and the
same backoff and failure reasons as today.

#### Scenario: server down
- **WHEN** golaya is unreachable
- **THEN** every task falls back to its rules and the client backs off 1–10 s, as today

### Requirement: Byte-identical state text
For each task (director, command, follow, eat, defend, craft, mine, farm, chores) the one renderer SHALL produce state
text byte-identical to laya-go's golden sample requests for that prompt version, checked by tests in CI.

#### Scenario: director golden sample
- **WHEN** the director renderer is given the facts of laya-go's v1.2 sample request
- **THEN** its request body equals the sample byte for byte

### Requirement: Typed answers
Each model answer SHALL be parsed once into that task's typed union; an answer outside the set or below the confidence
threshold SHALL be decided by the rules, with the reason logged.

#### Scenario: nonsense answer
- **WHEN** the director model answers `eat` at food 20
- **THEN** the rules' answer is used and the log line has `why: not-hungry`

### Requirement: Logs keep their format
`bots/<name>/logs/laya-<task>.jsonl` SHALL keep today's file names, field names and value formats, so the training and
analysis tools read old and new logs alike.

#### Scenario: director log
- **WHEN** the new bot logs a director decision
- **THEN** the line has the same keys (`event`, `state`, `answer`, `rule`, `source`, `p`, …) as the old bot's
