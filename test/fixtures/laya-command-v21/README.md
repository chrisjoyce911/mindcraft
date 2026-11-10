# laya-go command prompt v2.1 fixtures

- `request.json`, `beef_request.json` are laya-go's `games/command/prompt/testdata/v21_sample_request.json` and `v21_beef_request.json` ("gather beef").
- `resolve_cases.json` is `games/command/generate/testdata/resolve_cases_v21.json`: 400 v2.1 `ResolveFor` calls, the normalisation cases, every v2.1 option list and the `hunt` map (`HuntFor`).

From laya-go `~/lnkz/laya-go-v21` commit `cb1c791` (OpenSpec `laya-v2.1-data`, 2026-11-10). test/laya_command.test.js checks the bot matches them exactly.
