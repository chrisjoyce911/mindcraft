// 6.1 review: gatherItem on the fake act world. A dig that collected a log whose slot update comes late is still a
// gather that worked (run a of 6.1: "Collected 1 oak_log", gather failed, the log in the pack); with no update at
// all, or with nothing dug, it fails as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gatherItem } from '../src/actuators/gather.js';
import { world, type World } from './fakeact.js';

const logs = (w: World) => w.items.filter(i => i.name.endsWith('_log')).reduce((n, i) => n + i.count, 0);

function treeWorld() {
    const w = world({ items: [] });
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
        w.blocks[`${x},63,${z}`] = { name: 'stone', boundingBox: 'block' };
        w.blocks[`${x},64,${z}`] = { name: 'air', boundingBox: 'empty' };
    }
    w.blocks['2,64,0'] = { name: 'oak_log', boundingBox: 'block' };
    // the dig gives nothing at once (the drop's slot update is on the way)
    w.drops = { oak_log: 'nothing_yet' };
    return w;
}
const dropNothingYet = (w: World) => { w.items = w.items.filter(i => i.name !== 'nothing_yet'); };

test('gatherItem: the dig collected a log the pack shows late: the gather is ok', async () => {
    const w = treeWorld();
    const late = setInterval(() => {
        if (w.items.some(i => i.name === 'nothing_yet')) { dropNothingYet(w); w.items.push({ name: 'oak_log', count: 1 }); clearInterval(late); }
    }, 300);
    const r = await gatherItem(w.act, 'log', 1, new AbortController().signal, 2000);
    clearInterval(late);
    assert.deepEqual(r, { ok: true, message: 'Collected 1 oak_log.', cancelled: false });
    assert.equal(logs(w), 1);
});

test('gatherItem: the dig collected a log that never shows: failed after the wait', async () => {
    const w = treeWorld();
    const t0 = Date.now();
    const r = await gatherItem(w.act, 'log', 1, new AbortController().signal, 200);
    assert.equal(r.ok, false);
    assert.equal(r.message, 'Collected 1 oak_log.');
    assert.ok(Date.now() - t0 >= 200);
});

test('gatherItem: nothing dug: failed at once, no wait', async () => {
    const w = treeWorld();
    delete w.blocks['2,64,0'];
    const r = await gatherItem(w.act, 'raw_iron', 1, new AbortController().signal, 5000);
    assert.equal(r.ok, false);
    assert.match(r.message, /No iron_ore nearby/);
});

test('gatherItem: an abort during the wait ends it at once', async () => {
    const w = treeWorld();
    const c = new AbortController();
    setTimeout(() => c.abort(), 100);
    const t0 = Date.now();
    const r = await gatherItem(w.act, 'log', 1, c.signal, 5000);
    assert.equal(r.ok, false);
    assert.equal(r.cancelled, true);
    assert.ok(Date.now() - t0 < 1000);
});

// ---- 6.2b: the gather search widens 49 → 97 → 193 for every target ----

function openWorld() {
    const w = world({ items: [] });
    w.drops = { short_grass: 'wheat_seeds', tall_grass: 'wheat_seeds' };
    return w;
}
const digs = (w: World) => w.calls.filter(c => c.what === 'dig').map(c => c.arg);
const seeds = (w: World) => w.items.filter(i => i.name === 'wheat_seeds').reduce((n, i) => n + i.count, 0);

test('gather widening: grass only ~40 blocks off (outside ring 49) is found in ring 97', async () => {
    const w = openWorld();
    w.blocks['40,64,0'] = { name: 'short_grass', boundingBox: 'empty' };
    const r = await gatherItem(w.act, 'wheat_seeds', 1, new AbortController().signal, 100);
    assert.equal(r.ok, true);
    assert.deepEqual(digs(w), ['40,64,0']);
    assert.equal(seeds(w), 1);
});

test('gather widening: grass only ~90 blocks off is found in ring 193 (beyond the old 64)', async () => {
    const w = openWorld();
    w.blocks['90,64,-30'] = { name: 'tall_grass', boundingBox: 'empty' };
    const r = await gatherItem(w.act, 'wheat_seeds', 1, new AbortController().signal, 100);
    assert.equal(r.ok, true);
    assert.deepEqual(digs(w), ['90,64,-30']);
});

test('gather widening: the nearer of short and tall grass; the ring is kept between blocks', async () => {
    const w = openWorld();
    w.blocks['60,64,0'] = { name: 'tall_grass', boundingBox: 'empty' };
    w.blocks['70,64,0'] = { name: 'short_grass', boundingBox: 'empty' };
    w.blocks['5,64,0'] = { name: 'short_grass', boundingBox: 'empty' };
    const r = await gatherItem(w.act, 'wheat_seeds', 3, new AbortController().signal, 100);
    assert.equal(r.ok, true);
    assert.deepEqual(digs(w), ['5,64,0', '60,64,0', '70,64,0']);
    assert.equal(seeds(w), 3);
});

test('gather widening: no grass anywhere: the message names 96 blocks, nothing dug', async () => {
    const w = openWorld();
    w.blocks['120,64,0'] = { name: 'short_grass', boundingBox: 'empty' }; // outside the widest square
    const r = await gatherItem(w.act, 'wheat_seeds', 2, new AbortController().signal, 100);
    assert.equal(r.ok, false);
    assert.equal(r.message, 'No grass nearby (none within 96 blocks).');
    assert.deepEqual(digs(w), []);
});

test('gather widening: a log 80 blocks off (beyond the old LOG_RANGE 64) is found', async () => {
    const w = world({ items: [] });
    w.blocks['80,64,10'] = { name: 'birch_log', boundingBox: 'block' };
    const r = await gatherItem(w.act, 'log', 1, new AbortController().signal, 100);
    assert.equal(r.ok, true);
    assert.deepEqual(digs(w), ['80,64,10']);
    assert.equal(r.message, 'Collected 1 birch_log.');
});

test('gather widening: no trees: the message names 96 blocks', async () => {
    const w = world({ items: [] });
    const r = await gatherItem(w.act, 'log', 1, new AbortController().signal, 100);
    assert.deepEqual(r, { ok: false, message: 'No trees nearby (none within 96 blocks).', cancelled: false });
});

test('gather widening: ores and other blocks widen too (iron ore 70 off)', async () => {
    const w = world({ items: [] });
    w.drops = { iron_ore: 'raw_iron' };
    w.blocks['0,64,70'] = { name: 'iron_ore', boundingBox: 'block' };
    const r = await gatherItem(w.act, 'raw_iron', 1, new AbortController().signal, 100);
    assert.equal(r.ok, true);
    assert.deepEqual(digs(w), ['0,64,70']);
    const none = world({ items: [] });
    const n = await gatherItem(none.act, 'raw_iron', 1, new AbortController().signal, 100);
    assert.match(n.message, /No iron_ore nearby to collect within 96 blocks/);
});

test('gather widening: grass andy can\'t reach is left out and the next one tried', async () => {
    const w = openWorld();
    w.blocks['3,64,0'] = { name: 'short_grass', boundingBox: 'empty' };
    w.blocks['8,64,0'] = { name: 'short_grass', boundingBox: 'empty' };
    let n = 0;
    const goTo = w.act.motion.goTo;
    w.act.motion.goTo = async (g, sig, o) => (n++ === 0 ? { ok: false, reason: 'stuck' } : goTo(g, sig, o));
    const r = await gatherItem(w.act, 'wheat_seeds', 1, new AbortController().signal, 100);
    assert.equal(r.ok, true);
    assert.deepEqual(digs(w), ['8,64,0']);
});

test('collect: a plant (no collision box) is walked near, a solid block looked at (6.2b live: grass never "in sight")', async () => {
    const w = openWorld();
    w.blocks['40,64,0'] = { name: 'short_grass', boundingBox: 'empty' };
    await gatherItem(w.act, 'wheat_seeds', 1, new AbortController().signal, 100);
    assert.deepEqual(w.calls.find(c => c.what === 'goTo')?.arg, { near: 40, range: 3 });
    const t = world({ items: [] });
    t.blocks['10,64,0'] = { name: 'oak_log', boundingBox: 'block' };
    await gatherItem(t.act, 'log', 1, new AbortController().signal, 100);
    assert.deepEqual(t.calls.find(c => c.what === 'goTo')?.arg, { lookAt: '10,64,0' });
});
