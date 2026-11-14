// 5.1 the craft actuators and the craft job through the director, on the fake act world: a recipe at a placed
// table (picked up again), aborts that settle ≤ 250 ms though the craft or the dig never does, a collect that stops
// on an abort, the player kit never taken from the home chest, and a craft job run to its end by the director.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { craftRecipe } from '../src/actuators/craft.js';
import { collectBlocks } from '../src/actuators/collect.js';
import { floorDrop } from '../src/actuators/floor.js';
import { craftWorld } from '../src/jobs/craftWorld.js';
import { makeRunner, CRAFT_DEFAULTS, FOLLOW_DEFAULTS, type JobDeps } from '../src/jobs/index.js';
import { kitReserved, chestItemsForUse } from '../src/home/kit.js';
import type { CraftLine } from '../src/log/jsonl.js';
import type { ModelDecider, Places } from '../src/types/index.js';
import { world, flush, until, type World } from './fakeact.js';

const RECIPES = {
    oak_planks: { result: 4, needs: [{ name: 'oak_log', count: 1 }] },
    stick: { result: 4, needs: [{ name: 'oak_planks', count: 2 }] },
    crafting_table: { result: 1, needs: [{ name: 'oak_planks', count: 4 }] },
    wooden_pickaxe: { result: 1, needs: [{ name: 'oak_planks', count: 3 }, { name: 'stick', count: 2 }], table: true },
};
const count = (w: World, name: string) => w.items.filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

function craftWorldFake(items: { name: string; count: number }[]) {
    const w = world({ items });
    w.recipeBook = RECIPES;
    // a floor of stone at y 63 and air above it, x -3..3, z -3..3
    for (let x = -3; x <= 3; x++) for (let z = -3; z <= 3; z++) {
        w.blocks[`${x},63,${z}`] = { name: 'stone', boundingBox: 'block' };
        w.blocks[`${x},64,${z}`] = { name: 'air', boundingBox: 'empty' };
    }
    return w;
}

test('craftRecipe: in the inventory grid, one craft at a time; the old messages', async () => {
    const w = craftWorldFake([{ name: 'oak_log', count: 3 }]);
    const r = await craftRecipe(w.act, 'oak_planks', 3, new AbortController().signal);
    assert.deepEqual(r, { ok: true, message: 'Successfully crafted oak_planks, you now have 12 oak_planks.' });
    assert.equal(w.calls.filter(c => c.what === 'craft').length, 3);
    const short = await craftRecipe(w.act, 'stick', 10, new AbortController().signal);
    assert.equal(short.message, 'Not enough oak_planks to craft 10, crafted 6. You now have 24 stick.');
    assert.equal((await craftRecipe(w.act, 'cake', 1, new AbortController().signal)).message, 'cake is either not an item, or it does not have a crafting recipe!');
});

test('craftRecipe: a table recipe places the carried table, crafts at it and picks it up again', async () => {
    const w = craftWorldFake([{ name: 'oak_planks', count: 3 }, { name: 'stick', count: 2 }, { name: 'crafting_table', count: 1 }]);
    const r = await craftRecipe(w.act, 'wooden_pickaxe', 1, new AbortController().signal);
    assert.equal(r.ok, true, r.message);
    assert.equal(count(w, 'wooden_pickaxe'), 1);
    assert.equal(count(w, 'crafting_table'), 1, 'the table is back in the pack');
    assert.ok(w.calls.some(c => c.what === 'place'));
    assert.ok(w.calls.some(c => c.what === 'craft' && c.arg === 'wooden_pickaxe at table'));
    assert.ok(!Object.values(w.blocks).some(b => b.name === 'crafting_table'), 'no table left in the world');
    // no table near and none carried
    const none = craftWorldFake([{ name: 'oak_planks', count: 3 }, { name: 'stick', count: 2 }]);
    assert.equal((await craftRecipe(none.act, 'wooden_pickaxe', 1, new AbortController().signal)).message, 'Crafting wooden_pickaxe requires a crafting table.');
});

test('craftRecipe: an abort settles ≤ 250 ms though the craft never does', async () => {
    const w = craftWorldFake([{ name: 'oak_log', count: 3 }]);
    w.craftMs = Infinity;
    const c = new AbortController();
    const run = craftRecipe(w.act, 'oak_planks', 3, c.signal);
    await flush(30);
    const t0 = Date.now();
    c.abort();
    const r = await run;
    assert.ok(Date.now() - t0 < 250, `settled in ${Date.now() - t0} ms`);
    assert.equal(r.cancelled, true);
});

test('collectBlocks: an abort mid-dig stops digging and settles ≤ 250 ms; it never goes on to the next block', async () => {
    const w = craftWorldFake([]);
    w.blocks['2,64,0'] = { name: 'oak_log', boundingBox: 'block' };
    w.blocks['3,64,0'] = { name: 'oak_log', boundingBox: 'block' };
    w.digMs = Infinity;
    const c = new AbortController();
    const run = collectBlocks(w.act, 'oak_log', 2, c.signal);
    await until(() => w.calls.some(x => x.what === 'dig'));
    const t0 = Date.now();
    c.abort();
    const r = await run;
    assert.ok(Date.now() - t0 < 250, `settled in ${Date.now() - t0} ms`);
    assert.equal(r.cancelled, true);
    assert.ok(w.calls.some(x => x.what === 'stopDigging'));
    assert.equal(w.calls.filter(x => x.what === 'dig').length, 1, 'no second block');
});

test('collectBlocks: collects the nearest first; floorDrop keeps andy off a floor over a cave', async () => {
    const w = craftWorldFake([]);
    w.blocks['2,64,0'] = { name: 'oak_log', boundingBox: 'block' };
    w.blocks['1,64,1'] = { name: 'oak_log', boundingBox: 'block' };
    const r = await collectBlocks(w.act, 'oak_log', 5, new AbortController().signal);
    assert.equal(r.collected, 2);
    assert.equal(r.message, 'No more oak_log nearby to collect. Collected 2 oak_log.');
    assert.deepEqual(w.calls.filter(x => x.what === 'dig').map(x => x.arg), ['1,64,1', '2,64,0']);
    // the block under andy with 5 air under it: never dug
    const air = { name: 'air', boundingBox: 'empty' };
    const at = (x: number, y: number, z: number) => (x === 0 && z === 0 && y < 63 && y > 57 ? air : y === 63 ? { name: 'stone', boundingBox: 'block' } : y < 58 ? { name: 'stone', boundingBox: 'block' } : air);
    assert.equal(floorDrop(at, { x: 0.5, y: 64, z: 0.5 }, { x: 0, y: 63, z: 0 }), true);
    assert.equal(floorDrop(at, { x: 0.5, y: 64, z: 0.5 }, { x: 1, y: 63, z: 0 }), false, 'not the block under the feet');
});

test('the player kit: the home chest keeps the best of each tool, 8 cooked food and 16 torches', () => {
    const chest = [{ name: 'iron_pickaxe', count: 1 }, { name: 'stone_pickaxe', count: 1 }, { name: 'wooden_sword', count: 1 },
        { name: 'bread', count: 10 }, { name: 'beef', count: 5 }, { name: 'torch', count: 20 }, { name: 'oak_planks', count: 12 }];
    const isFood = (n: string) => ['bread', 'beef'].includes(n);
    assert.deepEqual(kitReserved(chest, isFood), { iron_pickaxe: 1, wooden_sword: 1, bread: 8, torch: 16 });
    assert.deepEqual(chestItemsForUse(chest, true, isFood), [{ name: 'stone_pickaxe', count: 1 }, { name: 'bread', count: 2 },
        { name: 'beef', count: 5 }, { name: 'torch', count: 4 }, { name: 'oak_planks', count: 12 }]);
    assert.equal(chestItemsForUse(chest, false, isFood).length, chest.length, 'any other chest: all of it');
});

function deps(w: World, places: Places, lines: CraftLine[] = [], model: ModelDecider | null = null): JobDeps {
    return {
        act: () => w.act, follow: () => ({ ...FOLLOW_DEFAULTS, model: null }), followLog: () => {}, note: () => {},
        places: { all: () => places, recall: n => places[n] ?? null, remember: () => {}, forget: () => {} },
        craft: () => ({ ...CRAFT_DEFAULTS, enabled: true, model }),
        craftLog: l => lines.push(l),
    };
}

test('craftWorld take: planks from the home chest by their real name, never the kit; a kit-only item is refused', async () => {
    const w = craftWorldFake([]);
    w.blocks['2,64,0'] = { name: 'chest', boundingBox: 'block' };
    w.chests['2,64,0'] = { iron_pickaxe: 1, spruce_planks: 3, bread: 4 };
    const cw = craftWorld(w.act, deps(w, { home_chest: [2, 64, 0] }));
    assert.deepEqual(await cw.readChest(new AbortController().signal), { planks: 3 }, 'the kit is left out');
    assert.equal(await cw.act.take('planks', 2, new AbortController().signal), true);
    assert.equal(count(w, 'spruce_planks'), 3, 'a bulk take is capped at what the chest may give');
    assert.equal(await cw.act.take('iron_pickaxe', 1, new AbortController().signal), false);
    assert.equal(w.chests['2,64,0']!.iron_pickaxe, 1, 'the kit pickaxe stays');
    assert.equal(w.chests['2,64,0']!.bread, 4, 'the kit food stays');
});

test('a craft job through the director: rules only, logs → planks → sticks; the Job line counts what is left', async () => {
    const lines: CraftLine[] = [];
    const w = world({ items: [{ name: 'oak_log', count: 1 }], jobs: x => e => makeRunner(e, deps(x, {}, lines)) });
    w.recipeBook = RECIPES;
    const job = await w.director.startJob({ kind: 'craft', item: 'stick', count: 4 }, 'player', {}, 'tester');
    assert.ok(job);
    assert.equal(w.director.holder, 'action:layaCraft');
    assert.deepEqual(await w.director.ended(job), { how: 'done' });
    assert.equal(count(w, 'stick'), 4);
    assert.equal(w.said.at(-1), 'Laya craft: made stick in 2 steps.');
    assert.deepEqual(lines.map(l => [l.outcome, l.rule?.item ?? l.item]), [['fallback', 'planks'], ['did', 'none'], ['fallback', 'stick'], ['did', 'none'], ['done', 'none']]);
    assert.equal(job.left?.(), 0, 'left: target − carried');
    // an unknown item fails with the old words
    const cake = await w.director.startJob({ kind: 'craft', item: 'cake', count: 1 }, 'player', {});
    assert.deepEqual(await w.director.ended(cake!), { how: 'failed', reason: "the craft model doesn't know cake" });
    assert.equal(w.said.at(-1), "I couldn't make 1 cake: the craft model doesn't know cake.");
    await w.director.stop();
});

test('the legacy forms: !craftRecipe crafts a recipe n times, !collectBlocks collects n blocks, with the old messages', async () => {
    const runners = (x: World) => (e: Parameters<typeof makeRunner>[0]) => makeRunner(e, deps(x, {}));
    const w = world({ items: [{ name: 'oak_log', count: 2 }], jobs: runners });
    w.recipeBook = RECIPES;
    w.blocks['2,64,0'] = { name: 'birch_log', boundingBox: 'block' };
    const craft = await w.director.startJob({ kind: 'craft', item: 'oak_planks', count: 2, legacy: 'craftRecipe' }, 'player', {});
    assert.equal(w.director.holder, 'action:craftRecipe');
    assert.deepEqual(await w.director.ended(craft!), { how: 'done' });
    assert.equal(w.said.at(-1), 'Successfully crafted oak_planks, you now have 8 oak_planks.');
    const collect = await w.director.startJob({ kind: 'gather', item: 'birch_log', count: 1, legacy: 'collectBlocks' }, 'player', {});
    assert.equal(w.director.holder, 'action:collectBlocks');
    assert.deepEqual(await w.director.ended(collect!), { how: 'done' });
    assert.equal(w.said.at(-1), 'Collected 1 birch_log.');
    assert.equal(count(w, 'birch_log'), 1);
    await w.director.stop();
});

test('makeItem: the craft loop run to its end for another job (rules only), and cancelled by an abort', async () => {
    const { makeItem } = await import('../src/jobs/index.js');
    const w = craftWorldFake([{ name: 'oak_log', count: 1 }]);
    const d = deps(w, {});
    assert.deepEqual(await makeItem(d, 'stick', 4, new AbortController().signal), { ok: true, reason: 'done', steps: 2 });
    assert.equal(count(w, 'stick'), 4);
    const c = new AbortController();
    c.abort();
    assert.deepEqual(await makeItem(d, 'stick', 4, c.signal), { ok: false, reason: 'cancelled', steps: 0 });
});
