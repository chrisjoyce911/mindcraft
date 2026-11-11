# Spec Delta

## Purpose

Defines how Mindcraft asks decision models: the `decision_models` settings (servers and tasks), the client and its normal answer form, model discovery, failure handling, per-task counters, and the check command.

## ADDED Requirements

### Requirement: Settings
`settings.js` SHALL hold `decision_models` with named `servers` (each a URL) and named `tasks` (each with `enabled`, `server`, `model`, `timeout_ms` and `min_confidence`). Every task SHALL be off by default.

#### Scenario: Defaults
- **WHEN** Mindcraft starts with the default settings
- **THEN** no decision request is sent

### Requirement: Asking a task
`decide(task, state, questions)` SHALL post the state, the questions and the task's model to the task's server, and SHALL return the answers in the normal form: for each question its type, top option, top probability, every option's probability, and whether the top probability reaches the task's `min_confidence`.

#### Scenario: Choice answer
- **WHEN** the server answers a choice with `NE` at 0.61 and `min_confidence` is 0.4
- **THEN** the answer's top is `NE`, its top probability is 0.61, and it is confident

#### Scenario: Noul answer
- **WHEN** the server answers a noul with probability 0.12
- **THEN** the answer's probability is 0.12 and its top is `false`

#### Scenario: Swap by settings
- **WHEN** a task's server and model are changed in the settings
- **THEN** the next request goes to the new server with the new model, with no code change

### Requirement: Model discovery
When a task's `model` is empty, the client SHALL use the server's single model with the `decisions` capability, and SHALL treat the task as unavailable when there is none or more than one.

#### Scenario: Mixed model list
- **WHEN** a server lists two chat models and one decisions model
- **THEN** the task uses the decisions model

#### Scenario: No decisions model
- **WHEN** a server lists no model with the `decisions` capability
- **THEN** `decide` returns null with the reason `no_model`

### Requirement: Failures never throw
`decide` SHALL return null, and count the reason, when the task is off or unknown (`disabled`), no reply arrives within `timeout_ms` (`timeout`), the server can't be reached (`unreachable`), the status isn't 200 (`http`), or the reply lacks a question or has the wrong type (`malformed`). It SHALL NOT throw.

#### Scenario: Timeout
- **WHEN** the server takes longer than `timeout_ms`
- **THEN** `decide` returns null and the `timeout` count rises by one

#### Scenario: Malformed
- **WHEN** the reply has no answer for one of the questions
- **THEN** `decide` returns null with the reason `malformed`

### Requirement: Counters
`stats(task)` SHALL report how many requests were asked and answered, failures by reason, and the mean and longest answer time.

#### Scenario: Counting
- **WHEN** a task is asked three times, answered twice and times out once
- **THEN** its stats show three asked, two answered and one timeout

### Requirement: Check command
`npm run laya:check [task]` SHALL report, for each task or the named one, the server and whether it is reachable, its decision models, the model the task uses, and, when the task has a sample request, the answer and its time. It SHALL exit non-zero when an enabled task can't be answered.

#### Scenario: Follow sample
- **WHEN** the `follow` task is checked against a server that answers
- **THEN** the report shows laya-go's golden `v1` request answered, with its top move and time
