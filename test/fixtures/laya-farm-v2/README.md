# laya-go farm prompt v2 fixtures

- `request.json` is laya-go's `games/farm/prompt/testdata/v2_sample_request.json`: the v1 golden farm with `Crop carrots` and `Pack 5 Home 12 Health 20 Food 18 Hostiles 0 Valuables 6`.
- `barren_request.json` is `games/farm/prompt/testdata/v2_barren_request.json`: the trial's savanna plateau (every cell dry ground or path), a hoe and one wheat seed, no home chest.
- `decisions.jsonl`: 200 v1 and 200 v2 situations from laya-go's farm generator (`generate.SituationsFor(v, 7, 200)`) with their state text, `rules.Decide` answer and rule, and Target and Item options.

All from laya-go branch `farm-v2`, commit `d827c6e` (the two requests are identical to it; `decisions.jsonl` was generated from the same rules before that commit). test/laya_farm.test.js checks the bot matches them exactly.
