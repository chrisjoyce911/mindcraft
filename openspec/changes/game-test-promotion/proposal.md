# Proposal

## Why

The roadmap's standing rule and item 7 (`docs/laya-roadmap.md`): a new model is served only if it beats the old one on its held-out test **and** does at least as well in game on the strict suite. Today the second half is manual. Promotion on the Studio (`data/cycle3.sh` in laya-go, gitignored) looks only at the held-out check, and `npm run game-test:compare` (branch `baseline-fixes`) just prints two runs side by side. Five new or changed models are coming, so the gate has to be a command with a pass/fail exit code.

## What Changes

- **`npm run game-test:gate -- --task <task> --candidate <model dir> [--baseline <summary.json>]`** (`tools/andy-tests/gate.js`). In order, it:
  1. starts a second `golaya serve` (binary from `--golaya` or `GOLAYA`) on a spare port (default 11236) with the candidate installed under the task's model name;
  2. resets the test world and starts andy (`bot_start`) with `SETTINGS_JSON` pointing that task's server at the candidate. `settings.js` is not touched.
  3. runs the strict suite;
  4. compares the result with the baseline: the latest strict summary with the served model, or `--baseline`;
  5. writes a verdict and stops andy and the candidate server.
- **The suite:**
  - every scenario tagged with the task's area, plus the `quick` tests (so a farm model can't break follow);
  - the task-to-tag map lives in `test/game/scenarios.json` (`gates`);
  - `--suite full` runs everything.
- **Verdict rule:**
  - **pass** only when no test that passed in the baseline fails or errors with the candidate, and the number of passes is not lower;
  - new passes are listed as gains;
  - a test that is flaky in the baseline (marked `flaky: true` in scenarios.json) is re-run once before it counts as a fail.
- **Output:**
  - `bots/andy/logs/game-tests/gate-<task>-<Brisbane time>.json` and `.md`: the verdict, both summaries side by side, the reasons;
  - exit code 0 for pass, 1 for fail, 2 for error (world or server down).
- **An MCP tool** `run_gate`, with the same arguments, for Claude-driven sessions.
- **`docs/game-tests.md`:** a promotion section, plus the line for laya-go's cycle script:
  - promote on a better held-out check **and** `game-test:gate` exit 0;
  - otherwise keep `<game>-best` and log why.

## Capabilities

### Modified Capabilities
- `game-tests`: the promotion gate (candidate server, the task suite, the verdict rule, the report, the CLI and the MCP tool).

## Impact

- **New:** `tools/andy-tests/gate.js`, `test/andy_tests_gate.test.js`.
- **Changed:**
  - `tools/andy-tests/lib/{runner,report}.js`: summaries carry the model id per task;
  - `tools/andy-tests/mcp.js`: `run_gate`;
  - `test/game/scenarios.json`: `gates` map, `flaky` flags;
  - `package.json` (`game-test:gate`), `docs/game-tests.md`.
- **Depends on:** `baseline-fixes`: the strict runner, summaries and `compare.js`. That branch must be merged first.
- **Follow-up outside git:** laya-go's `data/cycle3.sh` `promote()` calls the gate. That is a manual edit on the Studio (`data/` is not committed), listed as a task.
