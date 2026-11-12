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
