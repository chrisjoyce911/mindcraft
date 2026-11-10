# game-tests (delta)

## ADDED Requirements

### Requirement: Promotion gate
`npm run game-test:gate -- --task <task> --candidate <dir>` SHALL serve the candidate model on a separate golaya port, start andy on a freshly reset test world with only that task's server pointed at it (settings.js untouched), run the task's gate suite strictly, compare with the baseline summary and exit 0 for pass, 1 for fail and 2 for an error.

#### Scenario: Candidate as good as the served model
- **WHEN** every test that passed with the served farm model also passes with the candidate
- **THEN** the gate exits 0 and its report lists any new passes as gains

#### Scenario: A regression
- **WHEN** `follow` passed in the baseline and fails with a candidate farm model
- **THEN** the gate exits 1 and the report names `follow` and its reason

#### Scenario: World not running
- **WHEN** the test world can't be started
- **THEN** the gate exits 2 and serves nothing

### Requirement: Gate suite
The suite for a task SHALL be the scenarios tagged with that task's area in `gates` plus every `quick` scenario, or every scenario with `--suite full`. A scenario marked `flaky` that fails SHALL be run once more before it counts as a fail.

#### Scenario: Flaky retry
- **WHEN** a flaky scenario fails and then passes on the retry
- **THEN** it counts as a pass and the report notes the retry

### Requirement: Gate report
The gate SHALL write `bots/andy/logs/game-tests/gate-<task>-<Brisbane time>.json` and `.md` with the verdict, the candidate and baseline model ids, both summaries side by side and the reasons. The MCP server SHALL offer the same as `run_gate`.

#### Scenario: Report names
- **WHEN** a mine gate runs at 14:05 AEST
- **THEN** its report is `gate-mine-<date>_14-05-…json` and records both model ids
