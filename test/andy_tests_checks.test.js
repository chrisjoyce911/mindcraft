import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, count, describeCheck } from '../tools/andy-tests/lib/checks.js';

const snaps = {
    before: { t: 0, inventory: { oak_log: 3, cobblestone: 10 }, position: { x: 0, y: 70, z: 0 }, health: 20, hunger: 10 },
    after: { t: 10, inventory: { wooden_pickaxe: 1, cobblestone: 4, raw_iron: 2, iron_ore: 1 }, position: { x: 3, y: 60, z: 4 }, health: 18, hunger: 17 },
    low: { t: 5, inventory: {}, position: { x: 0, y: 70, z: 0 }, health: 20, hunger: 6 },
};
const ctx = {
    snapshots: snaps,
    chat: ['*tester used setHomeChest*', 'Home chest set at 13 64 -5.'],
    logs: [{ task: 'farm', action: 'harvest', outcome: 'ok' }, { task: 'farm', action: 'pond' }, { task: 'mine', outcome: 'failed' }],
    timeline: [{ t: 1, action: 'action:layaMine', pos: { x: 0, y: 66, z: 0 } }, { t: 2, action: 'mode:self_defense', pos: { x: 0, y: 55, z: 0 } }, { t: 3, action: 'action:followPlayer', pos: { x: 0, y: 61, z: 0 } }],
    waited: { idle: true, timedOut: false },
    final: { action: { current: 'action:followPlayer' }, gameplay: { position: { x: 3, y: 60, z: 4 } }, nearby: { entityTypes: ['cow'] } },
    chests: { '13 64 -5': { cobblestone: 640, coal: 2 } },
    chestsBefore: { '13 64 -5': { cobblestone: 0 } },
    serverReplies: ['Set the time to 1000'],
    tester: { x: 5, y: 60, z: 4 },
};
const ok = c => assert.equal(evaluate(c, ctx).ok, true, JSON.stringify(evaluate(c, ctx)));
const bad = (c, re) => { const r = evaluate(c, ctx); assert.equal(r.ok, false); if (re) assert.match(r.reason, re); };

test('count: names, alternatives and regex', () => {
    assert.equal(count(snaps.after.inventory, 'raw_iron'), 2);
    assert.equal(count(snaps.after.inventory, 'raw_iron|iron_ore'), 3);
    assert.equal(count(snaps.after.inventory, '/iron/'), 3);
    assert.equal(count({}, 'x'), 0);
});

test('inventory delta and absolute', () => {
    ok({ type: 'inventory', item: 'wooden_pickaxe', min: 1 });
    bad({ type: 'inventory', item: 'stone_pickaxe', min: 1 }, /stone_pickaxe \+0, wanted ≥ \+1/);
    ok({ type: 'inventory', item: 'cobblestone', max: -6 });
    bad({ type: 'inventory', item: 'cobblestone', max: -7 }, /-6, wanted ≤ -7/);
    ok({ type: 'inventory', item: 'cobblestone', absolute: true, min: 4 });
    ok({ type: 'inventory', item: 'cobblestone', since: 'low', min: 4 });
    bad({ type: 'inventory', item: 'x', since: 'nope', min: 1 }, /no snapshot "nope"/);
});

test('chest contents and delta', () => {
    ok({ type: 'chest', at: '13 64 -5', item: 'cobblestone', min: 640 });
    ok({ type: 'chest', at: '13 64 -5', item: 'cobblestone', min: 640, delta: true });
    bad({ type: 'chest', at: '13 64 -5', item: 'coal', min: 3 }, /chest coal × 2/);
    bad({ type: 'chest', at: '1 2 3', item: 'coal', min: 1 }, /could not be read/);
});

test('idle, reply, serverReply', () => {
    ok({ type: 'idle' });
    assert.equal(evaluate({ type: 'idle' }, { ...ctx, waited: { timedOut: true }, final: { action: { current: 'action:layaMine' } } }).ok, false);
    ok({ type: 'reply', match: 'home chest set at 13 64 -5' });
    bad({ type: 'reply', match: 'No water' }, /andy said: .*Home chest set/);
    ok({ type: 'reply', match: 'No water', none: true });
    bad({ type: 'reply', match: 'Home chest', none: true });
    ok({ type: 'serverReply', match: 'Set the time' });
    bad({ type: 'serverReply', match: 'Gamerule' }, /cheats/);
});

test('log entries in the window', () => {
    ok({ type: 'log', task: 'farm', match: { action: 'harvest' } });
    ok({ type: 'log', task: 'farm', match: '"pond"' });
    ok({ type: 'log', task: 'farm', min: 2 });
    bad({ type: 'log', task: 'farm', min: 3 });
    ok({ type: 'log', task: 'mine', match: { outcome: '/fail/' } });
    bad({ type: 'log', task: 'eat' });
    ok({ type: 'log', task: 'eat', max: 0 });
    // before: only entries before the first match of `before` count
    ok({ type: 'log', task: 'farm', match: { action: 'harvest' }, before: { action: 'pond' } });
    bad({ type: 'log', task: 'farm', match: { action: 'pond' }, before: { action: 'harvest' } });
    bad({ type: 'log', task: 'farm', match: { action: 'harvest' }, before: { action: 'till' } });
});

test('position at the end and during, near, stat', () => {
    ok({ type: 'position', axis: 'y', max: -4 });
    ok({ type: 'position', axis: 'y', during: 'min', max: -15 });
    bad({ type: 'position', axis: 'y', during: 'min', max: -16 }, /-15, wanted ≤ -16/);
    ok({ type: 'position', axis: 'dist', min: 5 });
    ok({ type: 'near', max: 3 });
    bad({ type: 'near', max: 1 }, /andy to tester 2/);
    ok({ type: 'stat', field: 'hunger', min: 15 });
    ok({ type: 'stat', field: 'hunger', since: 'low', min: 11 });
    bad({ type: 'stat', field: 'health', since: 'before', min: 0 }, /-2/);
});

test('entities and actions', () => {
    ok({ type: 'noEntity', entity: 'zombie' });
    bad({ type: 'noEntity', entity: 'cow' }, /cow still near/);
    ok({ type: 'actionSeen', match: 'self_defense' });
    ok({ type: 'actionSeen', match: 'followPlayer', final: true });
    bad({ type: 'actionSeen', match: 'layaMine', final: true }, /doing action:followPlayer/);
    ok({ type: 'actionSeen', match: 'followPlayer', after: 'before' });
    bad({ type: 'actionSeen', match: 'followPlayer', after: 'low' }, /saw nothing/); // only actions after the snapshot count
});

test('describeCheck reads as a sentence', () => {
    assert.equal(describeCheck({ type: 'inventory', item: 'coal', min: 5 }), "andy's coal changes by ≥ 5");
    assert.equal(describeCheck({ type: 'reply', match: 'Harvested' }), 'andy says /Harvested/');
});

test('place: andy remembers the place at exactly that block', () => {
    const ctx = { final: { places: { home_chest: [163, 70, 169], spawn: [0, 64, 0] } } };
    assert.equal(evaluate({ type: 'place', name: 'home_chest', at: '163 70 169' }, ctx).ok, true);
    assert.match(evaluate({ type: 'place', name: 'home_chest', at: '166 70 169' }, ctx).reason, /at 163 70 169, wanted 166 70 169/);
    assert.match(evaluate({ type: 'place', name: 'home', at: '1 2 3' }, ctx).reason, /no place home \(places: home_chest, spawn\)/);
    assert.equal(evaluate({ type: 'place', name: 'home_chest', at: '1 2 3' }, { final: {} }).ok, false);
    assert.equal(describeCheck({ type: 'place', name: 'home_chest', at: '1 2 3' }), 'andy remembers home_chest at 1 2 3');
});

test('place: anywhere, or not at all', () => {
    const ctx = { final: { places: { home_chest: [163.5, 70, 169], spawn: [0, 64, 0] } } };
    assert.equal(evaluate({ type: 'place', name: 'home_chest' }, ctx).ok, true);
    assert.match(evaluate({ type: 'place', name: 'home_chest' }, ctx).reason, /home_chest at 163 70 169/);
    assert.equal(evaluate({ type: 'place', name: 'home' }, ctx).ok, false);
    assert.equal(evaluate({ type: 'place', name: 'last_death_position', none: true }, ctx).ok, true);
    const died = { final: { places: { last_death_position: [10.2, 40, -3.7] } } };
    assert.match(evaluate({ type: 'place', name: 'last_death_position', none: true }, died).reason, /last_death_position at 10 40 -4/);
    assert.equal(evaluate({ type: 'place', name: 'last_death_position', none: true }, died).ok, false);
    assert.equal(evaluate({ type: 'place', name: 'x', none: true }, { final: {} }).ok, false);
    assert.equal(describeCheck({ type: 'place', name: 'home_chest' }), 'andy remembers home_chest');
    assert.equal(describeCheck({ type: 'place', name: 'last_death_position', none: true }), 'andy does not remember last_death_position');
});

test('repeat: the same failed answer three times in a row', () => {
    const run = (skill, target, result, time, reason) => ({ task: 'chores', event: 'run', skill, target, result, time, ...(reason ? { reason } : {}) });
    const check = { type: 'repeat', task: 'chores', match: { event: 'run' }, key: ['skill', 'target'], result: 'failed', max: 2 };
    const two = [run('craft', 'torch', 'failed', 't1'), { task: 'chores', event: 'ask' }, run('craft', 'torch', 'failed', 't2'), run('craft', 'torch', 'done', 't3'), run('craft', 'torch', 'failed', 't4')];
    assert.equal(evaluate(check, { logs: two }).ok, true, JSON.stringify(evaluate(check, { logs: two })));
    assert.match(evaluate(check, { logs: two }).reason, /longest: craft torch ×2/);
    const three = [run('craft', 'torch', 'failed', 't1', 'stuck'), run('craft', 'torch', 'failed', 't2', 'stuck'), run('craft', 'torch', 'failed', 't3', 'stuck')];
    const r = evaluate(check, { logs: three });
    assert.equal(r.ok, false);
    assert.match(r.reason, /craft torch failed 3 times in a row \(t1, t2, t3\): stuck/);
    // a different target breaks the run, so does a done
    const mixed = [run('mine', 'iron', 'failed', 't1'), run('mine', 'coal', 'failed', 't2'), run('mine', 'iron', 'failed', 't3'), run('mine', 'iron', 'failed', 't4')];
    assert.equal(evaluate(check, { logs: mixed }).ok, true);
    // other tasks and non-run lines do not count
    assert.equal(evaluate(check, { logs: three.map(e => ({ ...e, task: 'craft' })) }).ok, true);
    assert.equal(evaluate({ ...check, max: 3 }, { logs: three }).ok, true);
    assert.equal(evaluate({ ...check, result: '/fail/' }, { logs: three }).ok, false);
    assert.equal(evaluate(check, { logs: [] }).ok, true);
    // except: skipped entries neither count nor break a run
    const cut = [run('hunt', 'food', 'failed', 't1', 'interrupted'), run('hunt', 'food', 'failed', 't2', 'interrupted'), run('hunt', 'food', 'failed', 't3', 'interrupted')];
    assert.equal(evaluate({ ...check, except: { reason: 'interrupted' } }, { logs: cut }).ok, true);
    assert.equal(evaluate(check, { logs: cut }).ok, false);
    const through = [three[0], cut[0], three[1], three[2]];
    assert.equal(evaluate({ ...check, except: { reason: 'interrupted' } }, { logs: through }).ok, false);
    assert.match(describeCheck(check), /never has 3 failed entries in a row with the same skill\+target/);
});

test('log and repeat since a snapshot', () => {
    const at = iso => ({ time: iso });
    const ctx = {
        snapshots: { before: { t: Date.parse('2026-11-12T04:00:10Z') } },
        logs: [
            { task: 'chores', event: 'ask', state: 'Base chest yes', ...at('2026-11-12T04:00:05Z') },
            { task: 'chores', event: 'run', skill: 'craft', target: 'torch', result: 'failed', ...at('2026-11-12T04:00:06Z') },
            { task: 'chores', event: 'run', skill: 'craft', target: 'torch', result: 'failed', ...at('2026-11-12T04:00:11Z') },
            { task: 'chores', event: 'run', skill: 'craft', target: 'torch', result: 'failed', ...at('2026-11-12T04:00:12Z') },
            { task: 'chores', event: 'ask', state: 'Base chest no', ...at('2026-11-12T04:00:13Z') },
        ],
    };
    assert.equal(evaluate({ type: 'log', task: 'chores', match: { state: '/chest yes/' } }, ctx).ok, true);
    const r = evaluate({ type: 'log', task: 'chores', match: { state: '/chest yes/' }, since: 'before' }, ctx);
    assert.equal(r.ok, false);
    assert.match(r.reason, /since before: 0/);
    const rep = { type: 'repeat', task: 'chores', match: { event: 'run' }, max: 2 };
    assert.equal(evaluate(rep, ctx).ok, false);
    assert.equal(evaluate({ ...rep, since: 'before' }, ctx).ok, true);
    assert.match(evaluate({ ...rep, since: 'nope' }, ctx).reason, /no snapshot "nope"/);
    assert.match(describeCheck({ type: 'log', task: 'chores', match: {}, since: 'before' }), /since before/);
});
