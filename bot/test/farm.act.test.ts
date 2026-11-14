// 5.3 the farm acts (a port of test/laya_farm.test.js's farm_actions tests, and the fixes they pin): floods, until,
// pourInto (an item use aimed at the top of the block below, then checked: fix 2a35a90), till and plant checked in
// the world (fix a6baaa3), water and pond refused where water would run off, the farm movements on every walk,
// breeding the two nearest adults, and the home chest adopted from a sign with andy's name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Act, ActBlock, ActBot, ActEntity, ActItem } from '../src/actuators/bot.js';
import type { Outcome, Vec3Like } from '../src/types/index.js';
import { floods, until, pourInto, farmAct, breed, waterSource, isBaby } from '../src/actuators/farm.js';
import { findSignedChest } from '../src/actuators/unload.js';
import { homeAdopter, adoptedText, ADOPT_EVERY_MS } from '../src/home/adopt.js';
import type { GoToOptions } from '../src/core/motion.js';

const solid = { boundingBox: 'block' }, open = { boundingBox: 'empty' };

test('flooding check', () => {
    assert.equal(floods(() => solid, { x: 0, y: 64, z: 0 }), false);
    assert.equal(floods(x => (x === 1 ? open : solid), { x: 0, y: 64, z: 0 }), true);
    assert.equal(floods(() => null, { x: 0, y: 64, z: 0 }), true, 'not loaded: it could');
});

test('until: polls until the condition holds or time runs out; an abort ends it', async () => {
    let n = 0;
    const sleep = async () => { n++; return true; };
    assert.equal(await until(() => n >= 3, 1500, undefined, sleep), true);
    assert.equal(await until(() => false, 300, undefined, sleep), false);
    const ac = new AbortController();
    ac.abort();
    assert.equal(await until(() => false, 1500, ac.signal, sleep), false);
});

interface FakeFarm { act: Act; calls: string[]; blocks: Map<string, ActBlock>; items: ActItem[]; entities: Record<string, ActEntity>; goTos: GoToOptions[] }

/** fakeFarm: blocks by "x,y,z" (else air), items, entities; activateBlock / activateItem / dig change the world as the game would. */
function fakeFarm(o: { blocks?: Record<string, string>; items?: ActItem[]; at?: Vec3Like; reach?: boolean; pour?: boolean; till?: boolean; plant?: boolean } = {}): FakeFarm {
    const blocks = new Map<string, ActBlock>(Object.entries(o.blocks ?? {}).map(([k, name]) => [k, { name, boundingBox: ['air', 'water', 'wheat', 'short_grass'].includes(name) ? 'empty' : 'block' }]));
    const key = (p: Vec3Like) => `${p.x},${p.y},${p.z}`;
    const calls: string[] = [];
    const items: ActItem[] = [...(o.items ?? [])];
    const entities: Record<string, ActEntity> = {};
    const goTos: GoToOptions[] = [];
    let held: ActItem | null = null;
    let look: Vec3Like | null = null;
    const set = (p: Vec3Like, name: string) => blocks.set(key(p), { name, boundingBox: name === 'air' || name === 'water' || name === 'wheat' ? 'empty' : 'block' });
    const bot = {
        entity: { position: o.at ?? { x: 0.5, y: 65, z: 0.5 } },
        get entities() { return entities; },
        health: 20, get heldItem() { return held; }, username: 'andy',
        items: () => items,
        equip: async (it: ActItem) => { calls.push(`equip ${it.name}`); held = it; },
        lookAt: async (p: Vec3Like) => { look = p; calls.push(`look ${p.x} ${p.y} ${p.z}`); },
        activateItem: () => {
            calls.push(`use ${held?.name}`);
            if (o.pour === false || !look) return;
            const p = { x: Math.floor(look.x), y: Math.floor(look.y), z: Math.floor(look.z) };
            if (held?.name === 'water_bucket') set(p, 'water');
            if (held?.name === 'bucket') items.push({ name: 'water_bucket', count: 1 });
        },
        activateBlock: async (p: Vec3Like) => {
            calls.push(`activate ${key(p)} ${held?.name}`);
            if (held?.name.endsWith('_hoe') && o.till !== false) set(p, 'farmland');
            if (held?.name === 'wheat_seeds' && o.plant !== false) set({ ...p, y: p.y + 1 }, 'wheat');
        },
        activateEntity: async (e: ActEntity) => { calls.push(`feed ${e.id} ${held?.name}`); },
        blockAt: (x: number, y: number, z: number) => blocks.get(`${x},${y},${z}`) ?? { name: 'air', boundingBox: 'empty' },
        dig: async (p: Vec3Like) => { calls.push(`dig ${key(p)}`); set(p, 'air'); },
        stopDigging: () => {},
        findBlocks: (names: readonly string[], point: Vec3Like, max: number) => [...blocks.entries()].filter(([, b]) => names.includes(b.name))
            .map(([k]) => { const [x, y, z] = k.split(',').map(Number) as [number, number, number]; return { x, y, z }; })
            .filter(p => Math.hypot(p.x - point.x, p.y - point.y, p.z - point.z) <= max),
        blockNames: (t: (n: string) => boolean) => ['oak_sign', 'oak_wall_sign', 'stone', 'chest'].filter(t),
    } as unknown as ActBot;
    const motion = {
        goTo: async (_g: unknown, _s: AbortSignal, opts: GoToOptions = {}): Promise<Outcome> => { goTos.push(opts); return o.reach === false ? { ok: false, reason: 'no-path' } : { ok: true }; },
        moveFor: async (): Promise<Outcome> => ({ ok: true }), moveUntil: async (): Promise<Outcome> => ({ ok: true }), stop: () => {},
    };
    const goals = { near: (p: Vec3Like) => p, follow: (e: ActEntity) => e } as unknown as Act['goals'];
    return { act: { bot, motion, goals }, calls, blocks, items, entities, goTos };
}

const sig = () => new AbortController().signal;
const G = { x: 2, y: 64, z: 2 };

test('pourInto: looks at the hole and uses the bucket as an item, then checks for water', async () => {
    const f = fakeFarm({ items: [{ name: 'water_bucket', count: 1 }] });
    await f.act.bot.equip({ name: 'water_bucket', count: 1 }, 'hand');
    assert.equal(await pourInto(f.act, { x: 5, y: 63, z: 7 }, sig()), true);
    assert.deepEqual(f.calls.slice(1), ['look 5.5 63.05 7.5', 'use water_bucket']);
    const dry = fakeFarm({ pour: false });
    assert.equal(await pourInto(dry.act, { x: 5, y: 63, z: 7 }, sig()), false, 'nothing placed: not done');
});

test('till: clears the grass on top, uses the hoe, done only when farmland is there', async () => {
    const f = fakeFarm({ blocks: { '2,64,2': 'grass_block', '2,65,2': 'short_grass' }, items: [{ name: 'stone_hoe', count: 1 }] });
    assert.equal(await farmAct(f.act, 'till', G, 'hoe', sig()), true);
    assert.deepEqual(f.calls, ['dig 2,65,2', 'equip stone_hoe', 'activate 2,64,2 stone_hoe']);
    assert.ok(f.goTos.every(g => g.farm), 'the farm movements');
    const nothing = fakeFarm({ blocks: { '2,64,2': 'grass_block' }, items: [{ name: 'stone_hoe', count: 1 }], till: false });
    assert.equal(await farmAct(nothing.act, 'till', G, 'hoe', sig()), false, 'nothing changed: not done (fix a6baaa3)');
    const crop = fakeFarm({ blocks: { '2,64,2': 'farmland', '2,65,2': 'wheat' }, items: [{ name: 'stone_hoe', count: 1 }] });
    assert.equal(await farmAct(crop.act, 'till', G, 'hoe', sig()), false, 'a crop on top (a misread cell) is never dug by a till');
    assert.deepEqual(crop.calls, []);
    const noHoe = fakeFarm({ blocks: { '2,64,2': 'grass_block' } });
    assert.equal(await farmAct(noHoe.act, 'till', G, 'hoe', sig()), false);
});

test('plant: the seed on the farmland, done only when the crop is there', async () => {
    const f = fakeFarm({ blocks: { '2,64,2': 'farmland' }, items: [{ name: 'wheat_seeds', count: 3 }] });
    assert.equal(await farmAct(f.act, 'plant', G, 'wheat_seeds', sig()), true);
    const nothing = fakeFarm({ blocks: { '2,64,2': 'farmland' }, items: [{ name: 'wheat_seeds', count: 3 }], plant: false });
    assert.equal(await farmAct(nothing.act, 'plant', G, 'wheat_seeds', sig()), false);
});

test('water and pond: refused where water would run off; else dig the hole and pour', async () => {
    const walls = { '3,64,2': 'dirt', '1,64,2': 'dirt', '2,64,3': 'dirt', '2,64,1': 'dirt' };
    const f = fakeFarm({ blocks: { ...walls, '2,64,2': 'grass_block', '2,65,2': 'short_grass' }, items: [{ name: 'water_bucket', count: 1 }] });
    assert.equal(await farmAct(f.act, 'pond', G, 'water_bucket', sig()), true);
    assert.deepEqual(f.calls, ['dig 2,65,2', 'dig 2,64,2', 'equip water_bucket', 'look 2.5 64.05 2.5', 'use water_bucket']);
    const leak = fakeFarm({ blocks: { ...walls, '1,64,2': 'air', '2,64,2': 'farmland' }, items: [{ name: 'water_bucket', count: 1 }] });
    assert.equal(await farmAct(leak.act, 'water', G, 'water_bucket', sig()), false);
    assert.deepEqual(leak.calls, [], 'nothing dug');
});

test('harvest: digs the crop and picks up with the farm movements; reach: a failed path near enough still acts', async () => {
    const f = fakeFarm({ blocks: { '2,64,2': 'farmland', '2,65,2': 'wheat' }, reach: false, at: { x: 2.5, y: 65, z: 4.5 } });
    f.entities['9'] = { id: 9, name: 'item', position: { x: 2.5, y: 65, z: 2.5 } };
    assert.equal(await farmAct(f.act, 'harvest', G, 'none', sig()), true);
    assert.equal(f.calls[0], 'dig 2,65,2');
    assert.ok(f.goTos.length >= 2 && f.goTos.every(g => g.farm), 'reach and pickup with the farm movements');
    const far = fakeFarm({ blocks: { '2,65,2': 'wheat' }, reach: false, at: { x: 20, y: 65, z: 20 } });
    assert.equal(await farmAct(far.act, 'harvest', G, 'none', sig()), false);
});

test('breed: feeds the two nearest adults; a baby is not one', async () => {
    const f = fakeFarm({ items: [{ name: 'wheat', count: 4 }] });
    f.entities['1'] = { id: 1, name: 'cow', position: { x: 3, y: 65, z: 0 }, height: 1.4 };
    f.entities['2'] = { id: 2, name: 'cow', position: { x: 9, y: 65, z: 0 }, height: 1.4 };
    f.entities['3'] = { id: 3, name: 'cow', position: { x: 1, y: 65, z: 0 }, height: 0.7 };
    f.entities['4'] = { id: 4, name: 'cow', position: { x: 20, y: 65, z: 0 }, height: 1.4 };
    assert.equal(isBaby(f.entities['3']!), true);
    assert.equal(await breed(f.act, 'cow', 'wheat', sig()), true);
    assert.deepEqual(f.calls.filter(c => c.startsWith('feed')), ['feed 1 wheat', 'feed 2 wheat']);
    const one = fakeFarm({ items: [{ name: 'wheat', count: 4 }] });
    one.entities['1'] = { id: 1, name: 'pig', position: { x: 3, y: 65, z: 0 }, height: 0.9 };
    assert.equal(await breed(one.act, 'pig', 'wheat', sig()), false);
});

test('waterSource: the nearest source block (metadata 0) in range', () => {
    const f = fakeFarm({ blocks: { '5,64,0': 'water', '2,64,0': 'water' } });
    f.blocks.get('2,64,0')!.metadata = 3; // flowing
    f.blocks.get('5,64,0')!.metadata = 0;
    assert.deepEqual(waterSource(f.act, 64), { x: 5, y: 64, z: 0 });
    assert.equal(waterSource(f.act, 2), null);
});

test('home chest by sign: found with andy\'s name, saved and said once; looked for at most every 30 s', () => {
    const f = fakeFarm({ blocks: { '3,65,0': 'oak_sign', '4,65,0': 'chest', '-8,65,0': 'oak_sign', '-9,65,0': 'chest' } });
    f.blocks.get('3,65,0')!.getSignText = () => ['', 'ANDY\'s chest'];
    f.blocks.get('-8,65,0')!.getSignText = () => ['bob'];
    assert.deepEqual(findSignedChest(f.act), { x: 4, y: 65, z: 0 });
    let t = 0, finds = 0;
    let saved: Vec3Like | null = null;
    const said: string[] = [];
    const home = homeAdopter({ recall: () => saved, remember: c => { saved = c; }, find: () => { finds++; return t > 0 ? { x: 4, y: 65, z: 0 } : null; },
        say: m => said.push(m), now: () => t });
    assert.equal(home(), null);
    t = ADOPT_EVERY_MS - 1;
    assert.equal(home(), null);
    assert.equal(finds, 1, 'not again within 30 s');
    t = ADOPT_EVERY_MS;
    assert.deepEqual(home(), { x: 4, y: 65, z: 0 });
    assert.deepEqual(home(), { x: 4, y: 65, z: 0 }, 'saved now');
    assert.equal(finds, 2);
    assert.deepEqual(said, [adoptedText({ x: 4, y: 65, z: 0 })]);
    assert.match(said[0]!, /chest at 4 65 0 is my home chest/);
});
