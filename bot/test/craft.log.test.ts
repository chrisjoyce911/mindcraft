// 5.1 laya-craft.jsonl in the old bot's format: the live 1.2 line (test/fixtures/laya-logs/laya-craft.jsonl) and one
// line per outcome branch (branches/craft.jsonl, recorded from the old JS by tools/laya-logs/record-craft.mjs with
// the same sessions as here), byte for byte (time aside: the fixture's is used). Also jobFailedMessage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decideCraftStep, type CraftSituation } from '../src/models/craft/index.js';
import { craftLine, stamp, type CraftLine } from '../src/log/jsonl.js';
import { jobFailedMessage } from '../src/jobs/message.js';
import { answer, runCraft, type OldDeps } from './craftfake.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lines = (rel: string): string[] => fs.readFileSync(path.join(REPO, 'test/fixtures/laya-logs', rel), 'utf8').split('\n').filter(Boolean);
const timeOf = (line: string): Date => new Date((JSON.parse(line) as { time: string }).time);

test('golden: laya-craft.jsonl (did) byte for byte', async () => {
    const [want] = lines('laya-craft.jsonl');
    const s: CraftSituation = { goal: 'wooden_pickaxe', count: 1, chest: {}, tableNear: false, furnaceNear: false, chestNear: true, chestKnown: true,
        have: { coal: 87, log: 22, planks: 5, cobblestone: 90, leaf_litter: 17, torch: 4, leather: 2 }, hidden: 6 };
    const d = await decideCraftStep(s, { decide: async () => answer('craft', 'planks', 1, 0.987, 78) }, 0.3);
    assert.equal(d.kind, 'act');
    if (d.kind !== 'act') return;
    const line = craftLine({ goal: 'wooden_pickaxe x1', state: d.state, entry: d.entry, outcome: 'did' });
    assert.equal(stamp(line, timeOf(want!)), want);
});

// the record-craft.mjs sessions
function session(inv: Record<string, number>, { script = [] as (ReturnType<typeof answer> | null)[], client = true, fail = [] as string[] } = {}): OldDeps {
    const add = (name: string, n: number) => { inv[name] = (inv[name] || 0) + n; };
    return {
        client: client ? { decide: async () => script.shift() ?? null } : null,
        task: { log_steps: true, max_steps: 4 },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => ({}),
        readChest: async () => null,
        act: {
            gather: async (g, n) => { if (fail.includes('gather')) return false; add(g === 'log' ? 'oak_log' : g, n); return true; },
            craft: async (g, t) => {
                if (fail.includes('craft')) return false;
                if (g === 'stick') { inv.oak_planks! -= 2 * t; add('stick', 4 * t); }
                if (g === 'planks') { inv.oak_log! -= t; add('oak_planks', 4 * t); }
                return true;
            },
            smelt: async () => true, place: async () => true, take: async () => true, store: async () => true,
        },
    };
}

test('branches: craft — did, done, fallback (low-confidence, needs-pickaxe, rules), stop no-answer, failed, done after goal-carried', async () => {
    const want = lines('branches/craft.jsonl');
    const got: CraftLine[] = [];
    const run = (goal: string, count: number, deps: OldDeps) => runCraft(goal, count, deps, { lines: got });
    await run('stick', 4, session({ oak_planks: 2 }, { script: [answer('craft', 'stick', 1, 0.97, 41), answer('done', 'none', 1, 0.99, 40)] }));
    await run('stick', 4, session({ oak_log: 1 }, { script: [answer('gather', 'log', 1, 0.1, 39)] }));
    await run('raw_iron', 3, session({ wooden_pickaxe: 1 }, { script: [answer('gather', 'raw_iron', 3, 0.8, 38)] }));
    await run('stick', 4, session({ oak_planks: 2 }, { script: [answer('craft', 'stick', 1, 0.9, 37)], fail: ['craft'] }));
    await run('stick', 4, session({ stick: 4 }, { script: [answer('craft', 'stick', 1, 0.9, 36)] }));
    await run('planks', 4, session({ oak_log: 1 }, { client: false }));
    assert.equal(got.length, want.length);
    for (const [i, w] of want.entries()) assert.equal(stamp(got[i]!, timeOf(w)), w, `line ${i}`);
    const outcomes = new Set(got.map(l => l.outcome));
    for (const o of ['did', 'failed', 'fallback', 'done', 'stop']) assert.ok(outcomes.has(o as CraftLine['outcome']), o);
});

test('log_steps false writes nothing', async () => {
    const got: CraftLine[] = [];
    const deps = session({ oak_planks: 2 }, { script: [answer('craft', 'stick', 1), answer('done', 'none', 1)] });
    deps.task.log_steps = false;
    await runCraft('stick', 4, deps, { lines: got });
    assert.deepEqual(got, []);
});

test('jobFailedMessage: the old words (make for craft, get for gather)', () => {
    assert.equal(jobFailedMessage({ kind: 'craft', item: 'wooden_sword', count: 1 }, 'take planks failed'), "I couldn't make 1 wooden sword: take planks failed.");
    assert.equal(jobFailedMessage({ kind: 'gather', item: 'log', count: 4 }, 'gather log failed'), "I couldn't get 4 log: gather log failed.");
    assert.equal(jobFailedMessage({ kind: 'mine', ore: 'iron', count: 4 }, null), "I couldn't mine 4 iron.");
    assert.equal(jobFailedMessage({ kind: 'hunt', mob: 'cow', item: 'beef', count: 3 }, 'no cow nearby'), "I couldn't hunt for 3 beef: no cow nearby.");
    assert.equal(jobFailedMessage({ kind: 'farm', crop: 'any', goal: 'forever' }, 'something went wrong'), "I couldn't farm any: something went wrong.");
    assert.equal(jobFailedMessage({ kind: 'craft', item: 'stick', count: 2 }, 'x'.repeat(200)).length, "I couldn't make 2 stick: .".length + 120);
});
