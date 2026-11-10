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
