// 5.2 the mine's geometry: the mine parts of test/laya_chores_round2.test.js (floorDrop, hollowUnder, veinOf), and
// the pure helpers the loop tests don't reach: exposed, openSky, moveFeet, cellsToDig, depositList.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { floorDrop, hollowUnder, veinOf, exposed, openSky, moveFeet, cellsToDig, depositList, readView, ORES } from '../src/models/mine/index.js';
import { floorDrop as actuatorFloorDrop } from '../src/actuators/floor.js';
import { fakeWorld } from './minefake.js';

// world: a map of "x,y,z" → name; everything else is air (or stone below y0)
function world(blocks: Record<string, string>, { floor = -100 } = {}) {
    const m = new Map(Object.entries(blocks));
    return (x: number, y: number, z: number) => {
        const name = m.get(`${x},${y},${z}`) ?? (y <= floor ? 'stone' : 'air');
        return { name, boundingBox: name === 'air' || name === 'cave_air' ? 'empty' : 'block' };
    };
}

test('floorDrop: the block under the feet over a cave is never dug from on top', () => {
    // coal at 0 56 0 under feet 0 57 0; air from 55 down to 40 (a cave)
    const cave = world({ '0,56,0': 'coal_ore' }, { floor: 40 });
    assert.equal(floorDrop(cave, { x: 0.5, y: 57, z: 0.5 }, { x: 0, y: 56, z: 0 }), true);
    assert.equal(floorDrop(cave, { x: 0, y: 57, z: 0 }, null), false, 'findBlocks asks with no position first');
    assert.equal(hollowUnder(cave, { x: 0, y: 56, z: 0 }), true);
    // standing beside it: digging it drops nobody
    assert.equal(floorDrop(cave, { x: 1.5, y: 57, z: 0.5 }, { x: 0, y: 56, z: 0 }), false);
    // solid ground under the ore: a one-block step down is fine
    const solid = world({ '0,56,0': 'coal_ore' }, { floor: 55 });
    assert.equal(floorDrop(solid, { x: 0.5, y: 57, z: 0.5 }, { x: 0, y: 56, z: 0 }), false);
    // a drop of exactly 3 is allowed, 4 is not
    assert.equal(floorDrop(world({ '0,56,0': 'coal_ore' }, { floor: 52 }), { x: 0, y: 57, z: 0 }, { x: 0, y: 56, z: 0 }), false);
    assert.equal(floorDrop(world({ '0,56,0': 'coal_ore' }, { floor: 51 }), { x: 0, y: 57, z: 0 }, { x: 0, y: 56, z: 0 }), true);
    assert.equal(actuatorFloorDrop, floorDrop, 'the actuators use the same check');
});

test('veinOf: the connected ore of one vein, capped', () => {
    const w = world({ '0,10,0': 'coal_ore', '1,10,0': 'coal_ore', '1,11,1': 'coal_ore', '5,10,0': 'coal_ore', '0,9,0': 'iron_ore' }, { floor: 0 });
    const v = veinOf(w, { x: 0, y: 10, z: 0 }, ['coal_ore']);
    assert.deepEqual(v.map(p => `${p.x},${p.y},${p.z}`), ['0,10,0', '1,10,0', '1,11,1']);
    assert.equal(veinOf(w, { x: 0, y: 10, z: 0 }, ['coal_ore'], { max: 2 }).length, 2);
    assert.deepEqual(veinOf(w, { x: 3, y: 3, z: 3 }, ['coal_ore']), [], 'no ore at the start');
});

test('exposed, openSky, moveFeet and cellsToDig', () => {
    const w = fakeWorld(20, { '3,20,0': 'iron_ore', '3,19,0': 'air' });
    assert.equal(exposed(w.blockAt, { x: 3, y: 20, z: 0 }), true);
    assert.equal(exposed(w.blockAt, { x: 5, y: 20, z: 0 }), false);
    assert.equal(openSky(w.blockAt, { x: 0, y: 20, z: 0 }), false);
    assert.equal(openSky((x, y) => ({ name: y > 20 ? 'air' : 'stone', boundingBox: y > 20 ? 'empty' : 'block' }), { x: 0, y: 20, z: 0 }), true);
    assert.deepEqual(moveFeet({ kind: 'down', dir: 'E' }, 0, 20, 0), { x: 1, y: 19, z: 0 });
    assert.deepEqual(moveFeet({ kind: 'up', dir: 'N' }, 0, 20, 0), { x: 0, y: 21, z: -1 });
    const view = readView(w.blockAt, 0, 20, 0, ORES.iron.blocks);
    // the tunnel behind (west) is open: nothing to dig going back; ahead (east) both cells
    assert.deepEqual(cellsToDig(view, { kind: 'tunnel', dir: 'W' }).dig, []);
    assert.deepEqual(cellsToDig(view, { kind: 'tunnel', dir: 'E' }), { dig: [[1, 1, 0], [2, 1, 0]], target: [2, 1, 0], dir: 'E' });
    assert.deepEqual(cellsToDig(view, { kind: 'up', dir: 'E' }).dig, [[0, 0, 0], [1, 1, 0], [0, 1, 0]]);
});

test('depositList: everything but tools, food, torches and keep throwaway blocks', () => {
    const items = depositList({ stone_pickaxe: 1, iron_sword: 1, shears: 1, torch: 5, bread: 3, cobblestone: 50, dirt: 10, raw_iron: 4, coal: 0 },
        n => n === 'bread', 32);
    assert.deepEqual(items, [{ name: 'cobblestone', count: 18 }, { name: 'dirt', count: 10 }, { name: 'raw_iron', count: 4 }]);
    assert.deepEqual(depositList({ cobblestone: 20, dirt: 20 }, () => false, 32), [{ name: 'dirt', count: 8 }]);
});
