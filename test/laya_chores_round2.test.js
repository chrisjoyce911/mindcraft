// Chores round 2 (openspec/changes/laya-chores-round2): the mine never digs
// the block under itself over a drop, veins, saplings where a felled tree
// stood, wool from string, the director's nothing-to-defend check and a
// chore that stops when it is given up on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { floorDrop, hollowUnder, veinOf } from '../src/agent/laya/mine.js';
import { haveCounts, saplingOf, decideChore } from '../src/agent/laya/chores_state.js';
import { nextActivity } from '../src/agent/laya/director.js';
import { trunkBase, felledOf, runChore, ACTUATORS } from '../src/agent/laya/chores_actions.js';

// world: a map of "x,y,z" → name; everything else is air (or stone below y0).
function world(blocks, { floor = -100 } = {}) {
    const m = new Map(Object.entries(blocks));
    return (x, y, z) => {
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
});

test('veinOf: the connected ore of one vein, capped', () => {
    const w = world({ '0,10,0': 'coal_ore', '1,10,0': 'coal_ore', '1,11,1': 'coal_ore', '5,10,0': 'coal_ore', '0,9,0': 'iron_ore' }, { floor: 0 });
    const v = veinOf(w, { x: 0, y: 10, z: 0 }, ['coal_ore']);
    assert.deepEqual(v.map(p => `${p.x},${p.y},${p.z}`), ['0,10,0', '1,10,0', '1,11,1']);
    assert.equal(veinOf(w, { x: 0, y: 10, z: 0 }, ['coal_ore'], { max: 2 }).length, 2);
    assert.deepEqual(veinOf(w, { x: 3, y: 3, z: 3 }, ['coal_ore']), [], 'no ore at the start');
});

test('wool: 4 string count as 1 white wool, and the bed rules see it', () => {
    const none = () => false;
    assert.equal(haveCounts([{ name: 'string', count: 9 }], none).wool, 2);
    assert.equal(haveCounts([{ name: 'white_wool', count: 1 }, { name: 'string', count: 8 }], none).wool, 3);
    assert.equal(haveCounts([{ name: 'string', count: 3 }], none).wool, 0);
});

test('saplingOf: a log names its sapling', () => {
    assert.equal(saplingOf('oak_log'), 'oak_sapling');
    assert.equal(saplingOf('dark_oak_log'), 'dark_oak_sapling');
    assert.equal(saplingOf('mangrove_log'), 'mangrove_propagule');
    assert.equal(saplingOf('crimson_stem'), null);
});

test('trunkBase and felledOf: a cut tree leaves a stump for its sapling, in the work area only', () => {
    const blocks = { '0,69,0': 'grass_block', '0,70,0': 'oak_log', '0,71,0': 'oak_log', '0,72,0': 'oak_log', '5,69,5': 'stone', '5,70,5': 'birch_log' };
    const at = world(blocks);
    assert.deepEqual(trunkBase(at, { x: 0, y: 72, z: 0 }), { x: 0, y: 70, z: 0, log: 'oak_log' });
    assert.equal(trunkBase(at, { x: 5, y: 70, z: 5 }), null, 'on stone: a beam, not a tree');
    const before = new Map([['0,70,0', trunkBase(at, { x: 0, y: 71, z: 0 })]]);
    assert.deepEqual(felledOf(before, at, () => true), [], 'still standing');
    delete blocks['0,70,0']; delete blocks['0,71,0']; delete blocks['0,72,0'];
    const cut = world(blocks);
    assert.deepEqual(felledOf(before, cut, () => true), [{ x: 0, y: 70, z: 0, sapling: 'oak_sapling' }]);
    assert.deepEqual(felledOf(before, cut, () => false), [], 'outside the work area');
});

test('director: a model "defend" with nothing to defend is the rules\' answer', async () => {
    const client = { decide: () => Promise.resolve({ answers: { Activity: { top: 'defend', topProbability: 0.87, confident: true } } }) };
    const calm = { job: null, paused: null, health: 20, food: 20, armed: 'axe', armor: 0, hostiles: 0, nearest: null, light: 15, night: false,
        under: false, free: 22, home: 5, valuables: 4, foodItems: 19, danger: 'none', last: 'done', player: null };
    let d = await nextActivity(calm, { client, task: { prompt: 'v1.2' } });
    assert.deepEqual([d.activity, d.source, d.why], ['idle', 'rules', 'nothing-to-defend']);
    // v1.3: a zombie 6 off attacking nobody is not defended; a v1.2 model
    // (no Me line) is held to the v1.3 rule there
    d = await nextActivity({ ...calm, hostiles: 1, nearest: { kind: 'zombie', dist: 6 } }, { client, task: { prompt: 'v1.2' } });
    assert.deepEqual([d.activity, d.source], ['idle', 'rules']);
    d = await nextActivity({ ...calm, hostiles: 1, nearest: { kind: 'zombie', dist: 6 } }, { client, task: { prompt: 'v1.3' } });
    assert.deepEqual([d.activity, d.source, d.why], ['idle', 'rules', 'nothing-to-defend']);
    d = await nextActivity({ ...calm, hostiles: 1, nearest: { kind: 'zombie', dist: 2 }, me: { attacked: true, by: 'zombie', dist: 2 } }, { client, task: { prompt: 'v1.3' } });
    assert.deepEqual([d.activity, d.source], ['defend', 'model']);
    d = await nextActivity({ ...calm, player: { name: 'tester', attacked: true, by: 'zombie', dist: 10 } }, { client, task: { prompt: 'v1.2' } });
    assert.deepEqual([d.activity, d.source], ['defend', 'model']);
    const eats = { decide: () => Promise.resolve({ answers: { Activity: { top: 'eat', topProbability: 0.99, confident: true } } }) };
    d = await nextActivity(calm, { client: eats, task: { prompt: 'v1.2' } });
    assert.deepEqual([d.activity, d.source, d.why], ['idle', 'rules', 'not-hungry'], 'eat at food 20');
    d = await nextActivity({ ...calm, food: 12 }, { client: eats, task: { prompt: 'v1.2' } });
    assert.deepEqual([d.activity, d.source], ['eat', 'model']);
});

test('runChore: a chore given up on by an interrupt does nothing more after it', async () => {
    const bot = { interrupt_code: false };
    const did = [];
    ACTUATORS.__test = async () => {
        did.push('start');
        await new Promise(r => setTimeout(r, 300)); // a skill that doesn't stop
        // the interrupt has cleared by now; the chore must still see it was stopped
        await ACTUATORS.__check();
        return { ok: true, reason: 'done' };
    };
    let seen = null;
    const { stoppedForTest } = await import('../src/agent/laya/chores_actions.js');
    ACTUATORS.__check = () => { seen = stoppedForTest(bot); if (!seen) did.push('went on'); return Promise.resolve(); };
    const p = runChore({ bot }, '__test');
    setTimeout(() => { bot.interrupt_code = true; }, 50);
    setTimeout(() => { bot.interrupt_code = false; }, 200);
    const r = await p;
    assert.deepEqual(r, { ok: false, reason: 'stopped' });
    await new Promise(res => setTimeout(res, 400));
    assert.equal(seen, true, 'the actuator sees it was stopped');
    assert.deepEqual(did, ['start']);
    delete ACTUATORS.__test; delete ACTUATORS.__check;
});

test('chores rules: with string and no sheep, beds come from string wool', () => {
    // situation from the first day: chest, no sheep, 6 wool worth of string
    const s = {
        home: 'chest', time: 'day', biome: 'forest', table: true, furnace: true, chest: true, lit: true, bedMine: false, bedPlayer: false,
        axe: 'stone', pickaxe: 'stone', sword: 'stone', hoe: 'none', shovel: 'none', wood: 8, sticks: 4, cobble: 30, coal: 4, torches: 20,
        food: 20, raw: 0, wool: haveCounts([{ name: 'string', count: 24 }], () => false).wool, seeds: 0, saplings: 0, pack: 20, farm: false, ready: false,
        kitPickaxe: 'none', kitAxe: 'none', kitShovel: 'none', kitSword: 'none', kitFood: 0, kitTorches: 0,
        near: { trees: 49, stone: 49, coal: 49, sand: null, water: null, grass: 49 },
        animals: { cow: 0, pig: 0, sheep: 0, chicken: 0, rabbit: 0 }, ground: 0, canPlace: true, canSmelt: true, failed: [],
    };
    assert.equal(decideChore(s).chore, 'make_beds');
});
