# laya-go chores prompt v1 fixtures

- `request.json` is laya-go's `games/chores/prompt/testdata/v1_sample_request.json` (branch `chores`, `f05b409`). test/laya_chores.test.js builds the same state and request byte for byte.
- `decisions.jsonl`: the first 1000 of `generate.Situations(7, 2000)` with `prompt.State` and `rules.Decide` (answer and rule), from laya-go `f05b409` (chores shared spec v1, `openspec/changes/chores-v1/chores-spec.md`). The test checks the state round trip and that the rules agree on every one; all 40 rules are exercised.
