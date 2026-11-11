// 5.5 the skill sensors (sensors/skills.ts) on hand-built inputs: directions and ties, distances, the search
// square, babies and mooshrooms, drops, tree clustering, what counts toward a goal, and the place grid's cells.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CELL_TABLE, LIT_OFFSETS, columnCell, dirOf, dropsSeen, gatherCount, gridOffsets, huntAnimals, inSearch, litPoints, placeGrid,
    seenOf, treesOf, type Creature, type GridBlock,
} from '../src/sensors/skills.js';

test('directions: the larger axis; a tie goes to N/S; N is −z', () => {
    assert.equal(dirOf(5, 1), 'E');
    assert.equal(dirOf(-5, 1), 'W');
    assert.equal(dirOf(1, -5), 'N');
    assert.equal(dirOf(1, 5), 'S');
    assert.equal(dirOf(3, 3), 'S');
    assert.equal(dirOf(-3, -3), 'N');
    assert.equal(dirOf(0, 0), 'N');
});

test('seen: count capped at 9, ⌊horizontal distance⌋ to the nearest capped at 99, its direction', () => {
    const me = { x: 0.5, z: 0.5 };
    assert.deepEqual(seenOf(me, []), { count: 0, dist: -1, dir: null });
    assert.deepEqual(seenOf(me, [{ x: 3.9, z: 0.5 }, { x: 0.5, z: -9 }]), { count: 2, dist: 3, dir: 'E' });
    assert.deepEqual(seenOf(me, Array.from({ length: 12 }, (_, i) => ({ x: 200 + i, z: 0 }))), { count: 9, dist: 99, dir: 'E' });
});

test('search square: 49 is ±24 columns around the start, 97 ±48, 193 ±96', () => {
    const o = { x: 10, z: 10 };
    assert.ok(inSearch(o, { x: 34.9, z: -14 }, 49));
    assert.ok(!inSearch(o, { x: 35, z: 10 }, 49));
    assert.ok(inSearch(o, { x: 35, z: 10 }, 97));
    assert.ok(inSearch(o, { x: 106, z: 10 }, 193) && !inSearch(o, { x: 107, z: 10 }, 193));
});

test('hunt animals: adults inside the search; babies left out; a mooshroom is a cow', () => {
    const c = (id: number, name: string, x: number, z: number, baby = false): Creature => ({ id, name, position: { x, y: 64, z }, baby });
    const a = huntAnimals({ x: 0, z: 0 }, { x: 0, z: 0 }, 49, [c(1, 'cow', 5, 0), c(2, 'cow', 0, -3, true), c(3, 'mooshroom', -2, 0), c(4, 'pig', 30, 0), c(5, 'zombie', 1, 1)]);
    assert.deepEqual(a.cow, { count: 2, dist: 2, dir: 'W' });
    assert.deepEqual(a.pig, { count: 0, dist: -1, dir: null });
});

test('drops: the test items within 16 of andy', () => {
    const g = [{ id: 1, item: 'beef', position: { x: 3, y: 64, z: 0 } }, { id: 2, item: 'dirt', position: { x: 1, y: 64, z: 0 } }, { id: 3, item: 'porkchop', position: { x: 20, y: 64, z: 0 } }];
    assert.deepEqual(dropsSeen({ x: 0, y: 64, z: 0 }, g, n => n === 'beef' || n === 'porkchop'), { count: 1, dist: 3, dir: 'E' });
});

test('trees: logs clustered by column; a tree needs leaves beside a log; a 2×2 trunk is one tree', () => {
    const trunk = [0, 1, 2, 3, 4].map(y => ({ x: 0, y: 64 + y, z: 0 }));
    const stump = [{ x: 10, y: 64, z: 0 }];
    const big = [[20, 0], [21, 0], [20, 1], [21, 1]].flatMap(([x, z]) => [64, 65, 66].map(y => ({ x: x!, y, z: z! })));
    const leaves = (p: { x: number; y: number }) => p.y === 68 || (p.x >= 20 && p.y === 66);
    const trees = treesOf([...trunk, ...stump, ...big], leaves);
    assert.equal(trees.length, 2);
    assert.deepEqual(trees[0]!.base, { x: 0, y: 64, z: 0 });
    assert.equal(trees[0]!.logs.length, 5);
    assert.equal(trees[1]!.logs.length, 12);
});

test('goal counts: logs are wood (logs + ⌊planks/4⌋), wool any colour, saplings any kind', () => {
    const items = [{ name: 'oak_log', count: 3 }, { name: 'birch_planks', count: 9 }, { name: 'white_wool', count: 2 }, { name: 'red_wool', count: 1 },
        { name: 'oak_sapling', count: 2 }, { name: 'wheat_seeds', count: 5 }, { name: 'crimson_stem', count: 1 }];
    assert.equal(gatherCount('logs', items), 6);
    assert.equal(gatherCount('wool', items), 3);
    assert.equal(gatherCount('saplings', items), 2);
    assert.equal(gatherCount('seeds', items), 5);
});

// A flat world: floor at y 63 (grass), air above (light 15) from 64; blocks set by "x,y,z".
function flat(over: Record<string, GridBlock>, light = 15) {
    return (x: number, y: number, z: number): GridBlock | null => {
        const k = `${x},${y},${z}`;
        if (over[k] !== undefined) return over[k]!;
        if (Math.abs(x) > 40 || Math.abs(z) > 40) return null;
        if (y < 63) return { name: 'stone', boundingBox: 'block' };
        if (y === 63) return { name: 'grass_block', boundingBox: 'block' };
        return { name: 'air', boundingBox: 'empty', light };
    };
}
const B = (name: string, boundingBox = 'block', light?: number): GridBlock => ({ name, boundingBox, ...(light !== undefined ? { light } : {}) });

test('grid cells: floors by surface and light, the CELL_TABLE things, walls, drops and unloaded columns', () => {
    const at = flat({
        '1,63,0': B('stone'), '2,64,0': B('air', 'empty', 3), '3,63,0': B('stone'), '3,64,0': B('air', 'empty', 2),
        '4,63,0': B('water', 'empty'), '5,63,0': B('farmland'), '5,64,0': B('wheat', 'empty'), '6,63,0': B('dirt_path'),
        '7,64,0': B('chest'), '8,64,0': B('crafting_table'), '9,64,0': B('furnace'), '10,64,0': B('red_bed'), '11,64,0': B('torch', 'empty'),
        '12,64,0': B('oak_sapling', 'empty'), '13,64,0': B('oak_log'), '13,65,0': B('oak_log'), '13,66,0': B('oak_log'),
        '14,64,0': B('oak_leaves'), '15,64,0': B('stone'), '15,65,0': B('stone'), '15,66,0': B('stone'),
        '16,64,0': B('short_grass', 'empty'), '17,63,0': B('air', 'empty'), '17,62,0': B('air', 'empty'), '17,61,0': B('air', 'empty'), '17,60,0': B('air', 'empty'),
        '18,64,0': B('stone'), '19,64,0': B('oak_fence'),
    });
    const cell = (x: number) => columnCell(at, x, 0, 64).cell;
    assert.deepEqual(columnCell(at, 0, 0, 64), { cell: '.', feet: 64 });
    assert.equal(cell(1), ':');
    assert.equal(cell(2), ',');
    assert.equal(cell(3), ';');
    assert.deepEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map(cell).join(''), '~f=CTFBtss##'); // a trunk is s, leaves and a wall #
    assert.equal(cell(16), '.'); // looked through the grass
    assert.equal(cell(17), '#'); // a drop: no floor within 2 below
    assert.deepEqual(columnCell(at, 18, 0, 64), { cell: ':', feet: 65 }); // a step up
    assert.equal(cell(19), '#');
    assert.equal(columnCell(at, 99, 0, 64).cell, '#'); // not loaded
    assert.ok(CELL_TABLE.every(r => '~f=CTFBts#'.includes(r.cell)));
});

test('the place grid: 9×9 step 1 north first, @ in the middle; torches 7×7 at step 3 on the lit points', () => {
    const g = placeGrid(flat({ '1,64,-2': B('chest'), '-4,63,4': B('water', 'empty') }), { x: 0.4, y: 64, z: 0.7 }, 'furnace');
    assert.equal(g.length, 9);
    assert.equal(g[4], '....@....');
    assert.equal(g[2], '.....C...');
    assert.equal(g[8], '~........');
    assert.deepEqual(gridOffsets('torch'), [...LIT_OFFSETS]);
    assert.deepEqual(gridOffsets('bed'), [-4, -3, -2, -1, 0, 1, 2, 3, 4]);
    const t = placeGrid(flat({ '9,64,-9': B('air', 'empty', 4) }), { x: 0, y: 64, z: 0 }, 'torch');
    assert.deepEqual(t, ['......,', '.......', '.......', '...@...', '.......', '.......', '.......']);
    assert.equal(litPoints({ x: 0, z: 0 }).length, 49);
    assert.deepEqual(litPoints({ x: 0.5, z: 0.5 })[0], { x: -9, z: -9 });
});
