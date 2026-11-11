# laya-go command prompt v1 fixtures

- `request.json` is laya-go's `games/command/prompt/testdata/v1_sample_request.json`: the message "Andy, can you craft me 2 iron picks please?" from chrisjoyce911 to andy.
- `resolve_cases.json` is `games/command/generate/testdata/resolve_cases.json`: 400 `Resolve` calls with their answers, the message normalisation cases, and every option list.

Both come from laya-go commit `4d6d956` (branch `command`). test/laya_command.test.js checks the bot matches them exactly.
