// 4.2 home/: the old test/laya_home_chest.test.js ported, and the places store (memory.json `places` in
// today's format: other keys kept, atomic, bad entries dropped, a missing file is normal).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chestsAt, depositAll, homeState, isHomeName, isSign, nearestChest, signedChest, signText, type Stack } from '../src/home/chest.js';
import { cleanPlaces, PlaceStore } from '../src/home/places.js';
import type { Vec3Like } from '../src/types/index.js';

const world = (blocks: Record<string, string>) => (x: number, y: number, z: number) => ({ name: blocks[`${x},${y},${z}`] ?? 'air' });

test('nearest chest to the speaker within 8', () => {
    const chests = [{ x: 10, y: 64, z: 0 }, { x: 3, y: 64, z: 1 }, { x: 0, y: 64, z: 20 }];
    assert.deepEqual(nearestChest(chests, { x: 0, y: 64, z: 0 }), { x: 3, y: 64, z: 1 });
    assert.equal(nearestChest([{ x: 9, y: 64, z: 0 }], { x: 0, y: 64, z: 0 }), null);
});

test('sign with the bot name next to a chest is adopted', () => {
    const blockAt = world({ '5,64,5': 'chest', '9,64,9': 'barrel' });
    const signs = [
        { x: 5, y: 65, z: 5, text: 'Bob\n' },
        { x: 9, y: 64, z: 10, text: 'ANDY stuff\n' },
        { x: 20, y: 64, z: 20, text: 'andy' },
    ];
    assert.deepEqual(signedChest(signs, blockAt, 'Andy'), { x: 9, y: 64, z: 9 });
    assert.equal(signedChest(signs.slice(0, 1), blockAt, 'andy'), null);
    assert.equal(signedChest([{ x: 20, y: 64, z: 20, text: 'andy' }], blockAt, 'andy'), null);
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
    const room = [10, 5, 100], used: number[] = [];
    const into = async (c: Vec3Like, items: Stack[]) => {
        const i = chests.findIndex(x => x.x === c.x && x.y === c.y);
        used.push(i);
        if (i === 1) throw new Error('locked');
        return items.map(it => { const k = Math.min(room[i]!, it.count); room[i]! -= k; return { ...it, count: it.count - k }; });
    };
    assert.deepEqual(await depositAll(chests, [{ name: 'wheat', count: 30 }], into), []);
    assert.deepEqual(used, [0, 1, 2]);
    used.length = 0;
    assert.deepEqual(await depositAll(chests.slice(0, 1), [{ name: 'wheat', count: 3 }], into), [{ name: 'wheat', count: 3 }]);
});

test('isHomeName and homeState: the home chest must be a chest', () => {
    assert.ok(isHomeName('home_chest'));
    assert.ok(isHomeName('Home Chest'));
    assert.ok(!isHomeName('home'));
    assert.ok(!isHomeName('mine'));
    const blocks: Record<string, { name: string }> = { '1,64,1': { name: 'chest' }, '2,64,1': { name: 'dirt' } };
    const blockAt = (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? null;
    assert.equal(homeState([1, 64, 1], blockAt), 'ok');
    assert.equal(homeState([2.4, 64.9, 1.2], blockAt), 'gone', 'a fake home chest (no chest there)');
    assert.equal(homeState([9, 64, 9], blockAt), 'unknown', 'not loaded');
    assert.equal(homeState(undefined, blockAt), 'unknown');
});

// ---- the places store ----

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'andy-places-')), 'bots', 'andy', 'memory.json');

test('places: a missing file is normal; a change writes {places} alone', () => {
    const file = tmpFile();
    const s = new PlaceStore(file);
    assert.deepEqual(s.all(), {});
    assert.equal(s.recall('home_chest'), null);
    s.remember('home_chest', { x: 3, y: 64, z: -2 });
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { places: { home_chest: [3, 64, -2] } });
    assert.deepEqual(new PlaceStore(file).recall('home_chest'), [3, 64, -2], 'round trip');
    s.forget('nothing');
    s.forget('home_chest');
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { places: {} });
});

test('places: keeps every other memory.json key (the old bot shares the file); atomic; bad entries dropped', () => {
    const file = tmpFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const old = { memory: 'talked about wheat', turns: [{ role: 'user', content: 'hi' }], self_prompting_state: 0, self_prompt: null,
        taskStart: 0, last_sender: 'tester', places: { home_chest: [1, 2, 3], bad: [1, 'x', 3], short: [1, 2], nan: [1, null, 2], spawn: [0.5, 64, 0.5] } };
    fs.writeFileSync(file, JSON.stringify(old, null, 2));
    const s = new PlaceStore(file);
    assert.deepEqual(s.all(), { home_chest: [1, 2, 3], spawn: [0.5, 64, 0.5] });
    s.remember('last_death_position', { x: 10.25, y: 63, z: -4.75 });
    const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as typeof old;
    assert.deepEqual({ ...doc, places: undefined }, { ...old, places: undefined }, 'other keys kept as they were');
    assert.deepEqual(doc.places, { home_chest: [1, 2, 3], spawn: [0.5, 64, 0.5], last_death_position: [10.25, 63, -4.75] });
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['memory.json'], 'no temp file left');
    assert.deepEqual(cleanPlaces(null), {});
    assert.deepEqual(cleanPlaces([1, 2]), {});
});

test('places: a save that fails is reported, never thrown', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-places-'));
    const file = path.join(dir, 'memory.json');
    fs.mkdirSync(file); // a directory where the file should be: the rename fails
    const s = new PlaceStore(file);
    const errors: unknown[] = [];
    s.onError = e => errors.push(e);
    s.remember('home_chest', { x: 1, y: 2, z: 3 });
    assert.equal(errors.length, 1);
    assert.deepEqual(s.recall('home_chest'), [1, 2, 3], 'kept in memory');
});
