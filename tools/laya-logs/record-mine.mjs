// Records test/fixtures/laya-logs/branches/mine.jsonl from the old bot's mineWithLaya (src/agent/laya/mine.js) with
// the fake world of test/laya_mine_loop.test.js: every entry shape of laya-mine.jsonl (start/planned, model steps,
// veto, collect with its ore, walk, unload with its probability, unload_later, drops, shift-stair, stop-descent,
// restart, unsafe restart, unsafe-ground, blocked, heal done/stopped, low-health heal, reuse gone/reused, stopped).
// Run once from the repo root:
//   node tools/laya-logs/record-mine.mjs   (rewrites the fixture, with new times)
// bot/test/mine.log.test.ts rebuilds each line from the new bot's MineRun on the same worlds and answers.
import { rmSync } from 'fs';
import { mineWithLaya } from '../../src/agent/laya/mine.js';
import { ORES } from '../../src/agent/laya/mine_state.js';
import { SESSIONS } from './mine-sessions.mjs';

const out = new URL('../../test/fixtures/laya-logs/branches/mine.jsonl', import.meta.url).pathname;
rmSync(out, { force: true });

for (const session of SESSIONS) {
    const s = session.make({ ORES });
    s.deps.stepLog = out;
    s.deps.task.log_steps = true;
    await mineWithLaya(s.bot, session.ore, session.count, s.deps);
}
