# laya-go director prompt v1 fixtures

- `request.json` is laya-go's `games/director/prompt/testdata/v1_sample_request.json` (branch `minecraft`). test/laya_director.test.js builds the same state and request byte for byte.
- `decisions.jsonl`: 1000 situations `generate.Situations(7, 1000)` with `prompt.State` and `rules.Decide` (answer and rule), from laya-go `db494eb` (shared spec v1.1). The test checks the state round trip and that the rules agree on every one.
