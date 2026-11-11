import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nearestChest, signedChest, chestsAt, depositAll, isSign, signText } from '../src/agent/laya/home_chest.js';

// world: a map of "x,y,z" → block name; everything else air.
const world = blocks => (x, y, z) => ({ name: blocks[`${x},${y},${z}`] || 'air' });

test('nearest chest to the speaker within 8', () => {
    const chests = [{ x: 10, y: 64, z: 0 }, { x: 3, y: 64, z: 1 }, { x: 0, y: 64, z: 20 }];
    assert.deepEqual(nearestChest(chests, { x: 0, y: 64, z: 0 }), { x: 3, y: 64, z: 1 });
    assert.equal(nearestChest([{ x: 9, y: 64, z: 0 }], { x: 0, y: 64, z: 0 }), null);
});

test('sign with the bot name next to a chest is adopted', () => {
    const blockAt = world({ '5,64,5': 'chest', '9,64,9': 'barrel' });
    const signs = [
        { x: 5, y: 65, z: 5, text: 'Bob\n' },            // someone else's
        { x: 9, y: 64, z: 10, text: 'ANDY stuff\n' },     // on the barrel's side
        { x: 20, y: 64, z: 20, text: 'andy' },            // no chest near
    ];
    assert.deepEqual(signedChest(signs, blockAt, 'Andy'), { x: 9, y: 64, z: 9 });
    assert.equal(signedChest(signs.slice(0, 1), blockAt, 'andy'), null);
    assert.equal(signedChest([{ x: 20, y: 64, z: 20, text: 'andy' }], blockAt, 'andy'), null);
    // diagonal counts (within 1 block), a straight neighbour wins
    const two = world({ '1,64,1': 'chest', '1,63,0': 'chest' });
    assert.deepEqual(signedChest([{ x: 0, y: 64, z: 0, text: 'andy' }], world({ '1,63,1': 'chest' }), 'andy'), { x: 1, y: 63, z: 1 }, 'a corner counts');
    assert.deepEqual(signedChest([{ x: 0, y: 64, z: 1, text: 'andy' }], two, 'andy'), { x: 1, y: 64, z: 1 }, 'straight beats diagonal');
    assert.ok(isSign({ name: 'oak_wall_sign' }) && isSign({ name: 'birch_sign' }) && isSign({ name: 'oak_hanging_sign' }) && !isSign({ name: 'chest' }));
    assert.equal(signText({ getSignText: () => ['andy', ''] }), 'andy\n');
});

test('a full home chest spills into the chests touching it', async () => {
    const blockAt = world({ '0,64,0': 'chest', '1,64,0': 'chest', '0,65,0': 'barrel', '5,64,5': 'chest' });
    const chests = chestsAt({ x: 0, y: 64, z: 0 }, blockAt);
    assert.deepEqual(chests, [{ x: 0, y: 64, z: 0 }, { x: 1, y: 64, z: 0 }, { x: 0, y: 65, z: 0 }]);
    assert.deepEqual(chestsAt({ x: 9, y: 9, z: 9 }, blockAt), [], 'no chest there');
    const room = [10, 5, 100], used = [];
    const into = async (c, items) => {
        const i = chests.findIndex(x => x.x === c.x && x.y === c.y);
        used.push(i);
        if (i === 1) throw new Error('locked');
        return items.map(it => { const k = Math.min(room[i], it.count); room[i] -= k; return { ...it, count: it.count - k }; });
    };
    assert.deepEqual(await depositAll(chests, [{ name: 'wheat', count: 30 }], into), []);
    assert.deepEqual(used, [0, 1, 2]);
    used.length = 0;
    assert.deepEqual(await depositAll(chests.slice(0, 1), [{ name: 'wheat', count: 3 }], into), [{ name: 'wheat', count: 3 }]);
});

test('isHomeName and homeState: the home chest must be a chest', async () => {
    const { isHomeName, homeState } = await import('../src/agent/laya/home_chest.js');
    assert.ok(isHomeName('home_chest'));
    assert.ok(isHomeName('Home Chest'));
    assert.ok(!isHomeName('home'));
    assert.ok(!isHomeName('mine'));
    const blocks = { '1,64,1': { name: 'chest' }, '2,64,1': { name: 'dirt' } };
    const blockAt = (x, y, z) => blocks[`${x},${y},${z}`] || null;
    assert.equal(homeState([1, 64, 1], blockAt), 'ok');
    assert.equal(homeState([2.4, 64.9, 1.2], blockAt), 'gone', 'a fake home chest (no chest there)');
    assert.equal(homeState([9, 64, 9], blockAt), 'unknown', 'not loaded');
    assert.equal(homeState(undefined, blockAt), 'unknown');
});
