# Questions for the user (bot-rebuild)

Each has a recommendation; phase 1 can start once Q1–Q4 are answered.

| # | Question | Options | Recommended |
|---|---|---|---|
| Q1 | TypeScript build setup | (a) `tsc` → `bot/dist`, `tsx` for dev; (b) a bundler (esbuild); (c) Node 22's type stripping, no build | (a): simplest, readable output, stack traces match |
| Q2 | Test runner | (a) keep `node --test` (on compiled JS); (b) vitest | (a): same as today's 40 test files, no new tool |
| Q3 | One package or two | (a) `bot/` with its own `package.json` (old deps untouched until phase 7); (b) npm workspaces | (a) while both bots live; fold in at phase 7 |
| Q4 | mineflayer version | (a) pin 4.33.0 + today's patches; (b) upgrade during the rebuild | (a); upgrade later as its own change |
| Q5 | Multi-bot | (a) andy only, one process; (b) keep several bots (profiles, the mindserver managing many) | (a) for the rebuild; the harness protocol already names the agent, so a second bot can come later |
| Q6 | Places on a fresh start | today `memory.json` places load only when `load_memory` is on, so a fresh start forgets the home chest | always load places (they're the world's, not the LLM's) — but `forgetAgent` in the harness then really matters |
| Q7 | Mindserver web UI (`localhost:8090`) | (a) drop it; (b) keep a minimal status page | (b) minimal page from the same full state, if you use it; else (a) |
| Q8 | prismarine-viewer (`render_bot_view`) | keep / drop | drop (pulls canvas, three, webgl: most of the 1.2 GB) |
| Q9 | `mineflayer-pvp` | keep for the attack actuator / write our own swing loop | keep at first (patched), replace if it fights the lease |
| Q10 | Commands the command model can't emit (`!inventory`, `!consume`, `!attack`, `!stay`, …) used by players by hand | keep as typed commands / only what the scenarios and the command model use | keep the 18 the command model emits; others dropped unless you name them |
| Q11 | Cut-over gate | 16/16 suite twice + first day from scratch (proposed); add a live-play hour? | add one live-play hour on your world before deleting `src/` |
| Q12 | Fixes landing in the old bot meanwhile | port forward each phase (proposed) / freeze the old bot after phase 3 | port forward until phase 5, then freeze except crash fixes |

## Risks you should know about

- **Two bots for a while.** Fixes from fix4-style rounds have to be done twice until cut-over; the freeze in Q12 limits it.
- **Hidden behaviour in skills.js.** Years of small fixes (floor checks, placing retries, stumps, veins) live inside
  `skills.js` and the laya loops; the ported unit tests and the game suite are the net, but some will only show up in
  live play (hence Q11).
- **State text drift.** Any byte difference in a renderer silently makes a model worse; the golden tests are a hard
  CI gate.
- **Effort.** Roughly phases 2–3 a few days each, phase 5 the bulk (mine and chores are the largest), with the gate after
  each job type.
