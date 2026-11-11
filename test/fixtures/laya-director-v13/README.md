# laya-go director prompt v1.3 fixtures

- `request.json` is laya-go's `games/director/prompt/testdata/v1.3_sample_request.json` (worktree `laya-go-rules2`,
  `0cbe811`, shared spec v1.3: the Me line). test/laya_director.test.js builds the same state and request byte for byte.
- `decisions.jsonl`: 1000 situations `generate.Situations(7, 1000)` with `prompt.State` and `rules.Decide` (answer and
  rule), from laya-go `0cbe811` (v1.3: defend only when the bot is attacked, flee-low on an attack, heal regardless
  of non-attacking hostiles).
