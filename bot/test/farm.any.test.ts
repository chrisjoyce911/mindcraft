// 6.2b play findings: !layaFarm("any") asked 408 times with 407 trips to the same water and never planted. "any" is
// resolved before the loop (resolveCrop), seeds come through the gather skill, a find_water answer with water in
// view isn't a water problem, and the same answer on the same state 3 times with nothing changing ends the job.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_SEEDS, noSeedsSay, decideFarmStep, deadEndSay, readFarmAnswer, resolveCrop, type FarmView } from '../src/models/farm/index.js';
import { reply, runFarm, sample, setupV2, Y0 } from './farmfake.js';

// the play run's view by the lake: water, no crops, andy with only a hoe
const LAKE = ['XXWWXXXXX', 'XXWWWXXXX', 'XXXWWXXXX', 'XXXWWXXXX', 'XXXXXXXXX', 'XXXXWXXXX', 'XXXXXXXXX', 'XXXXXXXXX', 'XXXXXXLXX'];
const lake = (carry: FarmView['carry']): FarmView =>
    ({ grid: LAKE.map(r => [...r] as FarmView['grid'][number]), ys: LAKE.map(() => Array<number>(9).fill(Y0)), carry, animals: [] });

test('resolveCrop: the crop andy carries the most seed for, else wheat; a named crop stays', () => {
    assert.equal(resolveCrop('any', {}), 'wheat');
    assert.equal(resolveCrop('any', { carrot: 3 }), 'carrots');
    assert.equal(resolveCrop('any', { carrot: 3, potato: 5, wheat_seeds: 1 }), 'potatoes');
    assert.equal(resolveCrop('any', { carrot: 2, potato: 2 }), 'carrots', 'ties in CROP_INFO order');
    assert.equal(resolveCrop('any', { beetroot_seeds: 4, wheat: 9 }), 'beetroot', 'produce is not a seed (wheat)');
    assert.equal(resolveCrop('potatoes', { carrot: 9 }), 'potatoes');
});

test('play run: any, only a hoe, no grass to be had: ends with the clear no-seeds message, no water trips', async () => {
    const { deps, calls, bot, said } = setupV2(Array(500).fill(reply('find_water', 'none', 'none', 1)),
        { situation: lake([{ item: 'hoe', count: 1 }]), inv: { iron_hoe: 1 }, water: { x: 3, y: 63, z: 1 }, task: { max_steps_open: 500 } });
    const notes: string[] = [];
    deps.log = m => notes.push(m);
    deps.craft = async (item, n) => { calls.craft.push([item, n]); return false; };
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.craft, [['wheat_seeds', 4]]);
    assert.equal(calls.asked, 0);
    assert.deepEqual(calls.walked, []);
    assert.equal(c.reason, 'no seeds');
    assert.deepEqual(said, [NO_SEEDS]);
    assert.ok(notes.includes('farm: crop any → wheat'));
});

test('any with no seeds: wheat seeds are got first (the gather path), then it farms', async () => {
    const s = { ...sample(), carry: [{ item: 'hoe' as const, count: 1 }] };
    const { deps, calls, bot } = setupV2([reply('harvest', 'W2 N1', 'none', 1), reply('plant', 'E1 N2', 'wheat_seeds', 1)],
        { situation: s, inv: { iron_hoe: 1 }, task: { max_steps_open: 2 } });
    await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.craft[0], ['wheat_seeds', 4]);
    assert.deepEqual(calls.act.map(a => a[0]), ['harvest', 'plant']);
});

test('any carrying carrots: resolves to carrots, no seeds gathered; the state still says Crop any', async () => {
    const s = { ...sample(), carry: [{ item: 'hoe' as const, count: 1 }, { item: 'carrot' as const, count: 3 }] };
    const states: string[] = [];
    const { deps, calls, bot } = setupV2([reply('wait', 'none', 'none', 1)], { situation: s, inv: { iron_hoe: 1, carrot: 3 }, task: { max_steps_open: 1 } });
    const notes: string[] = [];
    deps.log = m => notes.push(m);
    const decide = deps.client.decide;
    deps.client.decide = async (t, st, q) => { states.push(st); return decide(t, st, q); };
    await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.craft, []);
    assert.ok(notes.includes('farm: crop any → carrots'));
    assert.match(states[0]!, /^Crop any$/m);
});

test('decide: find_water with water in view and no seed is a missing seed; with seeds it is the rules\' answer', () => {
    const asked = readFarmAnswer(reply('find_water', 'none', 'none', 1));
    const noSeed = decideFarmStep({ s: lake([{ item: 'hoe', count: 1 }]), asked, v2: true, crop: 'any', isBanned: () => false });
    assert.equal(noSeed.kind, 'act');
    assert.equal(noSeed.missing, 'wheat_seeds');
    assert.equal(noSeed.source, 'water-near');
    const carrots = decideFarmStep({ s: lake([{ item: 'hoe', count: 1 }]), asked, v2: true, crop: 'carrots', isBanned: () => false });
    assert.equal(carrots.missing, 'carrot');
    const g = sample();
    const withSeeds = decideFarmStep({ s: g, asked, v2: true, crop: 'any', isBanned: () => false });
    assert.notEqual(withSeeds.kind, 'find_water');
    assert.notEqual(withSeeds.action, 'find_water');
    assert.equal(withSeeds.source, 'water-near');
});

test('play run with seeds: find_water by the water never walks there again and again', async () => {
    const { calls, deps, bot } = setupV2(Array(30).fill(reply('find_water', 'none', 'none', 1)),
        { situation: sample(), water: { x: 3, y: 63, z: 2 }, task: { max_steps_open: 30 } });
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.walked, []);
    assert.equal(c.water_trips, 0);
});

test('dead end: the same answer on the same state 3 times with nothing changing ends the job (a get-item answer)', async () => {
    // water asked for again and again, no water bucket to be had, water in view: today's loop never ended
    const { deps, calls, bot, said } = setupV2(Array(50).fill(reply('water', 'W1 N1', 'water_bucket', 1)),
        { situation: sample(), task: { max_steps_open: 50 } });
    deps.craft = async (item, n) => { calls.craft.push([item, n]); return false; };
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.equal(calls.asked, 3);
    assert.equal(c.reason, 'stuck');
    assert.deepEqual(said, [deadEndSay('water')]);
    assert.equal(deadEndSay('find_water'), "I keep going for water and nothing changes, so I'm stopping. Give me seeds or take me to farmland.");
});

test('farm seeds through the gather skill: grass 60 blocks off is found by its widening search (rules v1)', async () => {
    const { world } = await import('./fakeact.js');
    const { gatherSeeds } = await import('../src/jobs/farmWorld.js');
    const w = world({ items: [] });
    w.drops = { short_grass: 'wheat_seeds' };
    (w.act.bot as { emptySlots?: () => number }).emptySlots = () => 30;
    for (let z = 0; z < 4; z++) w.blocks[`60,64,${z}`] = { name: 'short_grass', boundingBox: 'empty' };
    // walking there: andy stands by the grass
    w.onGoTo = () => { w.act.bot.entity.position.x = 59.5; w.act.bot.entity.position.z = 1.5; };
    const notes: string[] = [];
    const deps = {
        act: () => w.act, places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} },
        follow: () => { throw new Error('no follow'); }, followLog: () => {}, note: (t: string) => notes.push(t),
    } as unknown as Parameters<typeof gatherSeeds>[1];
    const r = await gatherSeeds(w.act, deps, 2, new AbortController().signal);
    assert.equal(r, null, notes.join('\n'));
    assert.ok(w.items.filter(i => i.name === 'wheat_seeds').reduce((n, i) => n + i.count, 0) >= 2);
});

test('no seeds for a named crop: its own message', () => {
    assert.equal(noSeedsSay('carrot'), "I have no carrot to plant and couldn't get any — give me some.");
    assert.equal(noSeedsSay('wheat_seeds'), NO_SEEDS);
});

test('the starter kit took andy away (seeds from far grass): he walks back to where the farm started', async () => {
    const s = { ...sample(), carry: [{ item: 'hoe' as const, count: 1 }] };
    const { deps, calls, bot } = setupV2([reply('wait', 'none', 'none', 1)], { situation: s, inv: { iron_hoe: 1 }, task: { max_steps_open: 1 } });
    let pos = { x: 0, y: Y0 + 1, z: 0 };
    deps.position = () => pos;
    const craft = deps.craft;
    deps.craft = async (item, n) => { pos = { x: 70, y: Y0 + 1, z: 5 }; return craft(item, n); };
    await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.walked, [{ x: 0, y: Y0 + 1, z: 0 }]);
});
