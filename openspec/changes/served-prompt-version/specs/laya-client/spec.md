## ADDED Requirements

### Requirement: Served prompt version
The client SHALL use the prompt version the server reports for a task's model (`prompt_version` in `GET /v1/models`,
or the `X-Laya-Prompt-Version` header of a decision) as the task's `prompt`, and the task's `prompt` setting only when
the server reports none. A reported change SHALL take effect from the next read of the task's `prompt`.

#### Scenario: Director replaced by v1.2
- **WHEN** settings say director prompt v1 and golaya serve reports director with prompt_version v1.2
- **THEN** the director writes the v1.2 state text

#### Scenario: Server says nothing
- **WHEN** the server's `/v1/models` has no prompt_version for the model
- **THEN** the task's `prompt` setting is used
