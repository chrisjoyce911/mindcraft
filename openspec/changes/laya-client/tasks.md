# Tasks

- [x] 1.1 Add `decision_models` to `settings.js` (servers `golaya` and `mlx`, task `follow` off) and `test` and `laya:check` scripts to `package.json`; verify the "Defaults" scenario
- [x] 1.2 Add `src/models/laya.js`: `decide`, the normal answer form, discovery, failure reasons, and `stats`; verify every "Asking a task", "Model discovery", "Failures never throw" and "Counters" scenario with fake servers like `golaya serve` and MLX-Serve
- [x] 1.3 Copy laya-go's golden `v1` follow request into `test/fixtures/laya-follow-v1/` (recording the laya-go commit) as the follow task's sample, and add `src/models/laya_check.js`; verify the "Follow sample" scenario
- [x] 1.4a Write `docs/laya-client.md`: configuring servers and tasks, swapping models, `laya:check`, using the client in code
- [ ] 1.4 Try it for real: `golaya serve` with an untrained follow model, then MLX-Serve's `aac6fef/laya-mlx` if installed, switching only the settings; record both `laya:check` reports in `docs/laya-client.md` along with how to configure servers and tasks
