# laya-go chores prompt v1.1 fixtures

- `request.json` is laya-go's `games/chores/prompt/testdata/v1.1_sample_request.json` (worktree `laya-go-rules2`,
  `0cbe811`, openspec change `chores-v11-director-v13`). test/laya_chores.test.js builds the same state and request
  byte for byte.
- `decisions.jsonl`: the first 1000 of `generate.Situations(7, 2000)` with `prompt.State` and `rules.Decide` (answer
  and rule), from laya-go `0cbe811` (chores shared spec v1.1: Animals as searches, need answers, Failed cooldown).
  The test checks the state round trip and that the rules agree on every one; all 45 rules are exercised.
