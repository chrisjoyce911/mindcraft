# laya-go mine prompt v2 fixtures

- `request.json`: laya-go's golden v2 mine request.
- `decisions.jsonl`: 300 plan situations `generate.PlanSituations(7, 300)` with `prompt.StateFor(v2)`, `rules.Decide`, `rules.Hazard` and `rules.Unload`, from laya-go `cb1c791` (OpenSpec `laya-v2.1-data`: collect within 12 with a plan, the `low-health` stop, hard plan situations). The same calls reproduce the previous file byte for byte at `9887258`.
