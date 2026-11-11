// Records test/fixtures/laya-logs/branches/craft.jsonl from the old bot's runCraft (src/agent/laya/craft.js) with
// the fakes of test/laya_craft_loop.test.js: one line per outcome branch (did, failed, fallback by the rules /
// low-confidence / a refused step, done, done after a refusal with the goal carried, stop no-answer). Run once
// from the repo root:
//   node tools/laya-logs/record-craft.mjs   (rewrites the fixture, with new times)
// bot/test/craft.log.test.ts rebuilds each line from the new bot's craft runner on the same world and answers.
import { rmSync } from 'fs';
import { runCraft } from '../../src/agent/laya/craft.js';

const out = new URL('../../test/fixtures/laya-logs/branches/craft.jsonl', import.meta.url).pathname;
rmSync(out, { force: true });

const answer = (action, item, count, p = 0.9, ms = 3) => ({
    answers: { Action: { top: action, topProbability: p }, Item: { top: item, topProbability: p }, Count: { top: String(count), topProbability: p } },
    ms,
});

// one session: the inventory, what's near, the model's replies (null: no answer), the actions' results
async function session(goal, count, inv, { near = {}, script = [], client = true, fail = [] } = {}) {
    const add = (name, n) => { inv[name] = (inv[name] || 0) + n; };
    const act = {
        gather: async (g, n) => { if (fail.includes('gather')) return false; add(g === 'log' ? 'oak_log' : g, n); return true; },
        craft: async (g, t) => {
            if (fail.includes('craft')) return false;
            if (g === 'stick') { inv.oak_planks -= 2 * t; add('stick', 4 * t); }
            if (g === 'planks') { inv.oak_log -= t; add('oak_planks', 4 * t); }
            return true;
        },
        smelt: async () => true, place: async () => true, take: async () => true, store: async () => true,
    };
    await runCraft(goal, count, {
        client: client ? { decide: async () => script.shift() ?? null } : null,
        task: { log_steps: true, max_steps: 4 },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => near,
        readChest: async () => null,
        act,
        log: () => {},
        stepLog: out,
    });
}

await session('stick', 4, { oak_planks: 2 }, { script: [answer('craft', 'stick', 1, 0.97, 41), answer('done', 'none', 1, 0.99, 40)] }); // did, done
await session('stick', 4, { oak_log: 1 }, { script: [answer('gather', 'log', 1, 0.1, 39)] });   // fallback low-confidence (+ did), stop no-answer
await session('raw_iron', 3, { wooden_pickaxe: 1 }, { script: [answer('gather', 'raw_iron', 3, 0.8, 38)] }); // fallback needs-pickaxe (+ did), stop
await session('stick', 4, { oak_planks: 2 }, { script: [answer('craft', 'stick', 1, 0.9, 37)], fail: ['craft'] }); // failed
await session('stick', 4, { stick: 4 }, { script: [answer('craft', 'stick', 1, 0.9, 36)] });     // done after goal-carried
await session('planks', 4, { oak_log: 1 }, { client: false });                                    // rules: fallback (+ did), done
