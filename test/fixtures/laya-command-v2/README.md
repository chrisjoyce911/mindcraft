# laya-go command prompt v2 fixtures

- `request.json`, `farm_request.json`, `home_request.json` are laya-go's `games/command/prompt/testdata/v2_sample_request.json`, `v2_farm_request.json` ("andy farm wheat 10") and `v2_home_request.json` ("andy this is your home chest").
- `resolve_cases.json` is `games/command/generate/testdata/resolve_cases_v2.json`: 400 v2 `Resolve` calls, the normalisation cases and every v2 option list.

From laya-go branch `farm-v2` (uncommitted command work on top of `d827c6e`, 2026-11-10). test/laya_command.test.js checks the bot matches them exactly; re-copy when laya-go commits the command part.
