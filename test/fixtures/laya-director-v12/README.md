# laya-go director prompt v1.2 fixtures

- `request.json` is laya-go's `games/director/prompt/testdata/v1.2_sample_request.json` (branch `chores`, `ee8314d`). test/laya_director.test.js builds the same state and request byte for byte.
- `decisions.jsonl`: 1000 situations `generate.Situations(7, 1000)` with `prompt.State` and `rules.Decide` (answer and rule), from laya-go `94b2117` (shared spec v1.2: Player line, defend-player, flee-ranged). Every one of the 18 rules is exercised.
