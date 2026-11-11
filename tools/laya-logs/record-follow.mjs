// Records test/fixtures/laya-logs/branches/follow.jsonl from the old bot's followWithLaya
// (src/agent/laya/follow.js) with the fakes of test/laya_follow_loop.test.js: one line per branch
// (stepped, wait, fallback no-answer / low-confidence / wait / veto / stuck). Run once from the repo root:
//   node tools/laya-logs/record-follow.mjs   (rewrites the fixture, with new times)
// bot/test/follow.test.ts rebuilds each line from the new bot's follow runner on the same world and answer.
import { rmSync } from 'fs';
import { followWithLaya } from '../../src/agent/laya/follow.js';

const out = new URL('../../test/fixtures/laya-logs/branches/follow.jsonl', import.meta.url).pathname;
rmSync(out, { force: true });

const Y0 = 64;
const AIR = { name: 'air', boundingBox: 'empty' };
const STONE = { name: 'stone', boundingBox: 'block' };
const LAVA = { name: 'lava', boundingBox: 'empty' };
function world(lava = []) {
    const isLava = new Set(lava.map(([x, z]) => `${x},${z}`));
    return (x, y, z) => {
        if (x < 0 || x >= 30 || z < 0 || z >= 9) return null;
        if (y > Y0) return AIR;
        if (y === Y0 && isLava.has(`${x},${z}`)) return LAVA;
        return STONE;
    };
}
const answer = (move, p = 0.9, ms = 3) => ({ model: 'fake', ms, answers: {
    Move: { type: 'choice', top: move, topProbability: p, confident: p >= 0.4, probabilities: { [move]: p } },
    Hazard: { type: 'noul', top: 'false', probability: 0.125, topProbability: 0.875, confident: true },
} });

// one session: the bot at (2, 4), the player at (14, 4); stops after `steps` decisions
async function session(replies, { blockAt = world(), stuck = false } = {}) {
    const bot = {
        entity: { position: { x: 2.5, y: Y0 + 1, z: 4.5 } },
        players: { tester: { entity: { position: { x: 14.5, y: Y0 + 1, z: 4.5 } } } },
        health: 20, interrupt_code: false,
    };
    let i = 0;
    const deps = {
        client: { decide: async () => { const r = replies[i++]; if (i >= replies.length) bot.interrupt_code = true; return r; } },
        task: { step_ms: 0, fallback_ms: 0, log_steps: true, stuck_ms: 1 },
        blockAt,
        stepTo: async (x, y, z) => { if (stuck) return false; bot.entity.position = { x: x + 0.5, y, z: z + 0.5 }; return true; },
        fallback: async () => {},
        sleep: async () => {},
        log: () => {},
        stepLog: out,
    };
    await followWithLaya(bot, 'tester', 3, deps);
}

await session([answer('E', 0.9, 41)]);                          // stepped
await session([answer('wait', 0.8, 40)]);                       // wait
await session([null]);                                          // fallback no-answer
await session([answer('E', 0.2, 39)]);                          // fallback low-confidence
await session([answer('wait'), answer('wait'), answer('wait', 0.7, 44)]); // wait, wait, fallback wait
await session([answer('E', 0.95, 38)], { blockAt: world([[3, 4]]) });     // fallback veto (harmful)
await session([answer('E', 0.9, 37)], { stuck: true });         // fallback stuck
