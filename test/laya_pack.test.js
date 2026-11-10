import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pack, packLine, homeDistance, homeOf, unloadRule, wantUnload, depositList, countHostiles, isTool } from '../src/agent/laya/pack.js';

test('pack line: laya-go games/internal/pack Line', () => {
    assert.equal(packLine(pack({ free: 5, home: 12 })), 'Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0');
    assert.equal(packLine(pack({ free: 0, home: null, health: 7.6, food: 3, hostiles: 14, valuables: 5000 })),
        'Pack 0 Home none Health 8 Food 3 Hostiles 9 Valuables 999');
    assert.equal(packLine(pack({ free: 40, home: 2000 })), 'Pack 36 Home 999 Health 20 Food 20 Hostiles 0 Valuables 0');
});

test('home distance: rounded up, never 0 (laya-go reads 0 as none), capped', () => {
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }), 5);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }), 1);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }), 999);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, null), null);
    assert.deepEqual(homeOf([1, 2, 3]), { x: 1, y: 2, z: 3 });
    assert.deepEqual(homeOf(() => [1, 2, 3]), { x: 1, y: 2, z: 3 });
    assert.equal(homeOf(undefined), null);
    assert.equal(homeOf(() => undefined), null);
});

test('unload rule: every clause of laya-go pack.Unload', () => {
    const p = o => pack({ free: 20, home: 50, ...o });
    assert.equal(unloadRule(p({ home: null, free: 0 })), false, 'no home chest');
    assert.equal(unloadRule(p({ free: 2 })), true, 'full');
    assert.equal(unloadRule(p({ free: 3 })), false);
    assert.equal(unloadRule(p({ free: 5, home: 20 })), true, 'nearly full near home');
    assert.equal(unloadRule(p({ free: 5, home: 25 })), false);
    assert.equal(unloadRule(p({ valuables: 4, health: 8 })), true, 'valuables when hurt');
    assert.equal(unloadRule(p({ valuables: 4, food: 6 })), true, 'valuables when hungry');
    assert.equal(unloadRule(p({ valuables: 4, hostiles: 2 })), true, 'valuables among mobs');
    assert.equal(unloadRule(p({ valuables: 3, hostiles: 2 })), false);
    assert.equal(unloadRule(p({ valuables: 4 })), false, 'not in danger');
    assert.equal(unloadRule(p({ free: 0 }), true), false, 'blocked (a game veto)');
});

test('want unload: full pack always, the model when sure, else the rule', () => {
    const full = pack({ free: 0, home: 40 }), roomy = pack({ free: 20, home: 40 });
    assert.equal(wantUnload(full, { confident: true, probability: 0.1 }, false), true);
    assert.equal(wantUnload(pack({ free: 0, home: null }), { confident: true, probability: 0.9 }, true), false);
    assert.equal(wantUnload(roomy, { confident: true, probability: 0.9 }, false), true);
    assert.equal(wantUnload(roomy, { confident: true, probability: 0.2 }, true), false);
    assert.equal(wantUnload(roomy, { confident: false, probability: 0.9 }, false), false);
    assert.equal(wantUnload(roomy, null, true), true);
});

test('deposit list and hostiles', () => {
    assert.deepEqual(depositList({ iron_hoe: 1, wheat: 30, wheat_seeds: 40, bread: 3 },
        (n, c) => (isTool(n) || n === 'bread' ? c : n === 'wheat_seeds' ? 16 : 0)),
    [{ name: 'wheat', count: 30 }, { name: 'wheat_seeds', count: 24 }]);
    const at = (x, hostile = true) => ({ hostile, position: { distanceTo: () => x } });
    const me = { position: {} };
    assert.equal(countHostiles([at(3), at(20), at(5, false), me, null], me, e => e.hostile), 1);
});
