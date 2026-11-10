import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, modelShare, addShares, shareBrief, shareTable } from '../tools/andy-tests/lib/share.js';

const e = (task, x) => ({ task, time: '2026-11-10T09:00:00Z', ...x });

test('classify reads each task log format', () => {
    assert.deepEqual(classify('command', { kind: 'run' }), { by: 'model', veto: false, fallback: false });
    assert.deepEqual(classify('command', { kind: 'llm', reason: 'chat' }), { by: 'rules', veto: false, fallback: true });
    assert.equal(classify('director', { source: 'rules' }).by, 'rules');
    assert.equal(classify('director', { source: 'model' }).by, 'model');
    assert.deepEqual(classify('follow', { outcome: 'fallback', reason: 'veto' }), { by: 'rules', veto: true, fallback: false });
    assert.deepEqual(classify('follow', { outcome: 'fallback', reason: 'stuck' }), { by: 'rules', veto: false, fallback: true });
    assert.equal(classify('follow', { outcome: 'stepped' }).by, 'model');
    assert.equal(classify('mine', { source: 'model' }).by, 'model');
    assert.deepEqual(classify('mine', { source: 'rules', why: 'veto', veto: 'no floor' }), { by: 'rules', veto: true, fallback: false });
    assert.deepEqual(classify('mine', { source: 'rules', why: 'stop-early' }), { by: 'rules', veto: false, fallback: true });
    assert.deepEqual(classify('mine', { source: 'rules', why: 'walk-first' }), { by: 'rules', veto: false, fallback: false });
    assert.equal(classify('mine', { walk: {}, outcome: 'done' }), null, 'a walk is no decision');
    assert.deepEqual(classify('farm', { source: 'model', outcome: 'veto' }), { by: 'rules', veto: true, fallback: false });
    assert.equal(classify('farm', { source: 'model', outcome: 'done' }).by, 'model');
    assert.deepEqual(classify('farm', { source: 'dry' }), { by: 'rules', veto: false, fallback: true });
    assert.equal(classify('farm', { count: 1, item: 'hoe', outcome: 'crafted' }), null);
    assert.deepEqual(classify('craft', { outcome: 'fallback', reason: 'not-craftable' }), { by: 'rules', veto: false, fallback: true });
    assert.equal(classify('craft', { outcome: 'did' }).by, 'model');
    assert.equal(classify('defend', { outcome: 'fight' }).by, 'model');
    assert.equal(classify('eat', { outcome: 'no-eat' }).by, 'model');
    assert.equal(classify('eat', { outcome: 'fallback' }).by, 'rules');
    assert.equal(classify('unknown', { source: 'model' }), null);
});

test('modelShare counts per task and in total; addShares sums tests; brief and table', () => {
    const s = modelShare([e('mine', { source: 'model' }), e('mine', { source: 'model' }), e('mine', { source: 'rules', why: 'veto' }),
        e('mine', { walk: {} }), e('director', { source: 'rules' }), e('command', { kind: 'run' })]);
    assert.deepEqual(s.tasks.mine, { decisions: 3, model: 2, rules: 1, veto: 1, fallback: 0 });
    assert.deepEqual(s.tasks.director, { decisions: 1, model: 0, rules: 1, veto: 0, fallback: 0 });
    assert.deepEqual(s.total, { decisions: 5, model: 3, rules: 2, veto: 1, fallback: 0 });
    assert.equal(shareBrief(s), 'model 3/5 (60%)');
    assert.equal(shareBrief(modelShare([])), 'no decisions');
    const sum = addShares([s, s, null]);
    assert.deepEqual(sum.total, { decisions: 10, model: 6, rules: 4, veto: 2, fallback: 0 });
    const t = shareTable(s).split('\n');
    assert.equal(t[2], '| command | 1 | 1 | 0 | 0 | 0 | 100% |', 'tasks in the fixed order');
    assert.equal(t[3], '| director | 1 | 0 | 1 | 0 | 0 | 0% |');
    assert.equal(t[4], '| mine | 3 | 2 | 1 | 1 | 0 | 67% |');
    assert.equal(t.at(-1), '| **total** | 5 | 3 | 2 | 1 | 0 | 60% |');
});
