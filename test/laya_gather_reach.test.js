// openspec fix-gather-unreachable-logs: failed blocks aren't retried, logs out of reach aren't candidates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { logReachable, CollectTries, shortReason, LOG_TYPES, MAX_COLLECT_FAILURES, LOG_REACH_ABOVE_GROUND } from '../src/agent/laya/reach.js';
import { runCraft } from '../src/agent/laya/craft.js';

// a column world: ground (grass) at y 63 everywhere unless set
function world(cells = {}, groundY = 63) {
    return (x, y, z) => {
        const k = `${x},${y},${z}`;
        if (k in cells) return cells[k];
        if (y <= groundY) return { name: 'grass_block', boundingBox: 'block' };
        return { name: 'air', boundingBox: 'empty' };
    };
}
const LOG = { name: 'oak_log', boundingBox: 'block' };
const LEAVES = { name: 'oak_leaves', boundingBox: 'block' };

test('a standing 5-log trunk: every log is reachable', () => {
    const cells = {};
    for (let y = 64; y <= 68; y++) cells[`0,${y},0`] = LOG;
    const at = world(cells);
    for (let y = 64; y <= 68; y++) assert.equal(logReachable(at, { x: 0, y, z: 0 }), true, `y ${y}`);
});

test('the live case: bottom chopped, logs 8 above the grass are out of reach', () => {
    // 14 Nov 2026: "firstBlockAboveHead: oak_log (6 blocks up)" with feet on grass at 64
    const cells = { '0,71,0': LOG, '0,72,0': LOG, '0,73,0': LEAVES };
    const at = world(cells);
    assert.equal(logReachable(at, { x: 0, y: 71, z: 0 }), false);
    assert.equal(logReachable(at, { x: 0, y: 72, z: 0 }), false);
});

test('reach limit: ground + 6 yes, ground + 7 no; leaves are not ground', () => {
    const at = world({});
    assert.equal(LOG_REACH_ABOVE_GROUND, 6);
    assert.equal(logReachable(at, { x: 0, y: 69, z: 0 }), true, '6 above the grass at 63');
    assert.equal(logReachable(at, { x: 0, y: 70, z: 0 }), false, '7 above');
    const canopy = world({ '0,69,0': LEAVES, '0,68,0': LEAVES }, 50);
    assert.equal(logReachable(canopy, { x: 0, y: 70, z: 0 }), false, 'standing on leaves is not reaching');
});

test('an unloaded block below counts as reachable (no guessing)', () => {
    assert.equal(logReachable(() => null, { x: 0, y: 100, z: 0 }), true);
});

test('a failed block is skipped for the rest of the call', () => {
    const t = new CollectTries();
    const p = { x: 1, y: 71, z: 2 };
    assert.equal(t.skips(p), false);
    t.fail(p);
    assert.equal(t.skips(p), true);
    assert.equal(t.skips({ x: 1, y: 72, z: 2 }), false);
});

// the collect loop's shape (skills.collectBlock) over a fake world: nearest candidate first, a collect that
// fails for unreachable ones. Returns {collected, tried} — proof the same block isn't chosen twice.
function collectLoop(candidates, num, reachable) {
    const tries = new CollectTries();
    let collected = 0;
    const tried = [];
    const left = [...candidates];
    for (let attempts = 0; collected < num && !tries.givenUp() && attempts < num + 2 * MAX_COLLECT_FAILURES; attempts++) {
        const next = left.find(c => !tries.skips(c));
        if (!next) break;
        tried.push(next.id);
        if (reachable(next)) { collected++; tries.ok(); left.splice(left.indexOf(next), 1); } else tries.fail(next);
    }
    return { collected, tried, givenUp: tries.givenUp(), failed: tries.failed.size };
}

test('one unreachable log beside a good tree: tried once, 4 from the tree', () => {
    const cands = [{ id: 'high', x: 0, y: 71, z: 0 }, ...[64, 65, 66, 67, 68].map(y => ({ id: `t${y}`, x: 10, y, z: 0 }))];
    const r = collectLoop(cands, 4, c => c.id !== 'high');
    assert.equal(r.collected, 4);
    assert.equal(r.tried.filter(id => id === 'high').length, 1);
});

test('nothing reachable: gives up after 5 failures, not num retries of one block', () => {
    const cands = Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, x: i, y: 80, z: 0 }));
    const r = collectLoop(cands, 12, () => false);
    assert.equal(r.collected, 0);
    assert.equal(r.tried.length, MAX_COLLECT_FAILURES);
    assert.equal(new Set(r.tried).size, r.tried.length, 'each block once');
    assert.equal(shortReason({ givenUp: r.givenUp, failedCount: r.failed, skippedOutOfReach: false }), 'unreachable');
});

test('shortReason: plain "none left" vs unreachable', () => {
    assert.equal(shortReason({ givenUp: false, failedCount: 0, skippedOutOfReach: false }), 'none');
    assert.equal(shortReason({ givenUp: false, failedCount: 0, skippedOutOfReach: true }), 'unreachable');
});

test('gathering log means every overworld log type', () => {
    for (const n of ['oak_log', 'birch_log', 'spruce_log', 'dark_oak_log', 'cherry_log', 'mangrove_log'])
        assert.ok(LOG_TYPES.includes(n), n);
    assert.ok(!LOG_TYPES.some(n => n.endsWith('_stem')), 'nether stems stay out');
});

test('craft loop: a gather that says why reports that reason', async () => {
    const p = 0.9;
    const gatherLog = { answers: { Action: { top: 'gather', topProbability: p }, Item: { top: 'log', topProbability: p }, Count: { top: '7', topProbability: p } }, ms: 3 };
    const deps = {
        client: { decide: () => Promise.resolve(gatherLog) }, task: { log_steps: false },
        items: () => [{ name: 'oak_log', count: 5 }],
        near: () => ({ table: false, furnace: false, chest: false }),
        act: { gather: () => Promise.resolve({ ok: false, why: 'no more logs I can reach here (I have 5)' }) },
        log: () => {},
    };
    const r = await runCraft('log', 12, deps);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no more logs I can reach here (I have 5)');
});
