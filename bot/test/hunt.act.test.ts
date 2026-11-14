// The hunt job's actuators and wiring (5.4) on the fake actuator world: nearestMob, killEntity (fight until gone,
// the ceiling, an abort), makeRunner('hunt') through the director (the old !attack and !hunt lines), the target on
// disk before the first kill, and the jobfile round trip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HUNT_RANGE, killEntity, nearestMob } from '../src/actuators/hunt.js';
import { makeRunner, FOLLOW_DEFAULTS, type JobDeps } from '../src/jobs/index.js';
import { JobSaver, loadJobs, saveJobs, jobWords } from '../src/home/jobfile.js';
import type { PlaceBook } from '../src/home/places.js';
import type { JobFile } from '../src/types/index.js';
import { world, until, flush, type World } from './fakeact.js';

const places: PlaceBook = { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} };
const deps = (x: World, notes: string[] = [], checkpoint?: () => void): JobDeps => ({
    act: () => x.act, places, follow: () => ({ ...FOLLOW_DEFAULTS, model: null }), followLog: () => {}, note: t => notes.push(t),
    ...(checkpoint ? { checkpoint } : {}),
});
const huntWorldOf = (items: { name: string; count: number }[] = []) => {
    const notes: string[] = [];
    const w = world({ items, jobs: x => e => makeRunner(e, deps(x, notes)) });
    return { w, notes };
};
const mob = (w: World, id: number, name: string, x: number, z = 0.5) => { w.entities[id] = { id, name, position: { x, y: 64, z } }; };

test('nearestMob: the nearest of the kind within HUNT_RANGE; never another kind, a player or one too far', () => {
    const { w } = huntWorldOf();
    mob(w, 1, 'cow', 10);
    mob(w, 2, 'cow', 4);
    mob(w, 3, 'pig', 1);
    mob(w, 4, 'cow', HUNT_RANGE + 2);
    assert.equal(nearestMob(w.act, 'cow')?.id, 2);
    assert.equal(nearestMob(w.act, 'sheep'), null);
    delete w.entities[1]; delete w.entities[2];
    assert.equal(nearestMob(w.act, 'cow'), null, 'only one beyond 24 left');
    w.entities[5] = { id: 5, name: 'cow', position: { x: 2, y: 64, z: 0.5 }, isValid: false };
    assert.equal(nearestMob(w.act, 'cow'), null, 'a dead one is skipped');
});

test('killEntity: holds the best weapon and strikes until the mob is gone; OK', async () => {
    const { w } = huntWorldOf([{ name: 'wooden_sword', count: 1 }, { name: 'iron_sword', count: 1 }]);
    mob(w, 7, 'cow', 2.5);
    const o = await killEntity(w.act, w.entities[7]!, new AbortController().signal);
    assert.deepEqual(o, { ok: true });
    assert.equal(w.entities[7], undefined);
    assert.equal(w.held()?.name, 'iron_sword');
    assert.ok(w.calls.some(c => c.what === 'attack' && c.arg === 7));
});

test('killEntity: a mob it can never reach times out at the ceiling; an abort is cancelled at once', async () => {
    const { w } = huntWorldOf();
    mob(w, 8, 'cow', 12); // the fake's moveFor never moves andy
    const t0 = Date.now();
    assert.deepEqual(await killEntity(w.act, w.entities[8]!, new AbortController().signal, 150), { ok: false, reason: 'timeout', detail: 'kill' });
    assert.ok(Date.now() - t0 < 400);
    const c = new AbortController();
    const p = killEntity(w.act, w.entities[8]!, c.signal);
    await flush(30);
    const t1 = Date.now();
    c.abort();
    assert.deepEqual(await p, { ok: false, reason: 'cancelled' });
    assert.ok(Date.now() - t1 < 250, 'settles ≤ 250 ms after the abort');
});

test('makeRunner builds a hunt runner; !attack through the director kills one and says the old line', async () => {
    const { w, notes } = huntWorldOf();
    assert.ok(makeRunner({ id: 'p', spec: { kind: 'hunt', mob: 'cow', item: 'beef', count: 3 }, origin: 'player', progress: {}, status: 'running', startedAt: 0 }, deps(w)));
    mob(w, 11, 'pig', 2);
    mob(w, 12, 'pig', 3);
    const job = await w.director.startJob({ kind: 'hunt', mob: 'pig', item: null, count: 1 }, 'player', {});
    assert.ok(job);
    assert.deepEqual(await w.director.ended(job), { how: 'done' });
    assert.equal(w.said.at(-1), 'Successfully killed pig.');
    assert.equal(w.entities[11], undefined, 'the nearest one');
    assert.ok(w.entities[12], 'one kill only');
    const none = await w.director.startJob({ kind: 'hunt', mob: 'zombie', item: null, count: 1 }, 'player', {});
    assert.deepEqual(await w.director.ended(none!), { how: 'failed', reason: 'none near' });
    assert.equal(w.said.at(-1), 'Could not find any zombie to attack.');
    assert.ok(notes.some(n => n === 'hunt zombie: failed (none near)'));
    await w.director.stop();
});

test('a hunt through the director: the target is on disk before the first kill; a !stop ends it', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-hunt-'));
    const file = path.join(dir, 'laya-job.json');
    const saver = new JobSaver(file);
    let atFirstAttack: JobFile | null = null;
    const w = world({ items: [{ name: 'beef', count: 4 }], jobs: x => e => makeRunner(e, deps(x, [], () => saver.save())) });
    saver.attach(w.director.stack);
    for (let i = 0; i < 3; i++) mob(w, 20 + i, 'cow', 2 + i);
    const attack = w.act.bot.attack;
    (w.act.bot as { attack: typeof attack }).attack = e => {
        atFirstAttack ??= JSON.parse(fs.readFileSync(file, 'utf8')) as JobFile;
        attack(e);
    };
    const job = await w.director.startJob({ kind: 'hunt', mob: 'cow', item: 'beef', count: 2 }, 'player', {}, 'tester');
    assert.ok(await until(() => atFirstAttack !== null));
    assert.equal((atFirstAttack as unknown as JobFile).entries[0]?.progress && ((atFirstAttack as unknown as JobFile).entries[0]!.progress as { target: number }).target, 6);
    // the fake's kills drop nothing, so the hunt goes on until the cows run out; stop it first
    const end = w.director.ended(job!);
    await w.director.stop();
    assert.deepEqual(await end, { how: 'cancelled' });
    assert.equal(w.lease.isFree, true);
    saver.detach();
    await w.director.dispose();
});

test('jobfile: a hunt with its progress round-trips; the words are the old ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-hunt-'));
    const file = path.join(dir, 'laya-job.json');
    const entry = { spec: { kind: 'hunt', mob: 'cow', item: 'beef', count: 3 } as const, origin: 'player' as const, by: 'tester',
        progress: { target: 8, kills: 1, tries: 2 }, status: 'running' as const, startedAt: 500 };
    saveJobs(file, [entry], 1000);
    const l = loadJobs(file, 1000);
    assert.deepEqual(l?.kind === 'typed' && l.entries, [entry]);
    assert.equal(jobWords(entry.spec), 'hunt for 3 beef');
});
