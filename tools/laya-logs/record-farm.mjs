// Records test/fixtures/laya-logs/branches/farm.jsonl from the old bot's farmWithLaya (src/agent/laya/farm.js) on the
// fake farms of tools/laya-logs/farm-sessions.mjs: every entry shape of laya-farm.jsonl. Run once from the repo root:
//   node tools/laya-logs/record-farm.mjs   (rewrites the fixture, with new times)
// bot/test/farm.log.test.ts rebuilds each line from the new bot's FarmRun on the same farms and answers.
import { rmSync } from 'fs';
import { farmWithLaya } from '../../src/agent/laya/farm.js';
import { SESSIONS } from './farm-sessions.mjs';

const out = new URL('../../test/fixtures/laya-logs/branches/farm.jsonl', import.meta.url).pathname;
rmSync(out, { force: true });

for (const session of SESSIONS) {
    const s = session.make();
    s.deps.stepLog = out;
    await farmWithLaya(s.bot, session.goal, s.deps);
}
