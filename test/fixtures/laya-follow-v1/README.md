# laya-go follow prompt v1 golden request

`request.json` is laya-go's `games/follow/prompt/testdata/v1_sample_request.json`, copied at laya-go commit `a14f1c3` (branch `minecraft`). It pins the follow task's state text and questions. If laya-go bumps the follow prompt version, copy the new golden request here and update the code that builds follow states.

The terrain it was built from (laya-go `world.Parse` rows; bot at (1, 3), player at (13, 0)):

```
..1122233
.~~.1122a
.~~..112b
....L.1bc
..d.....b
..d..12..
.....23..
```
