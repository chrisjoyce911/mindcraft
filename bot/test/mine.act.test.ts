// 5.2 the mine's actuators and its job: Motion's safe movements (swapped for one goTo, put back after, also on an
// abort), collectOreAt (safe path, never on top of a hollow ore, the drop picked up), placeAt (a torch on a wall or
// the floor), depositAtHome (the home chest and its neighbours), the MineRun's resume (mined 3 of 8, restart: 5
// more) and abort (a step settles at once), and the runner (the end lines, left, the task-off fallback).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Motion, type MotionBot } from '../src/core/motion.js';
import { collectOreAt } from '../src/actuators/ore.js';
import { placeAt } from '../src/actuators/place.js';
import { depositAtHome } from '../src/actuators/unload.js';
import { MineRun, mineRunner, type MineProgress } from '../src/jobs/mine.js';
import { MINE_DEFAULTS, type JobDeps, type JobOf, type MineSettings } from '../src/jobs/deps.js';
import { world } from './fakeact.js';
import { answer, runMine, setup, worldOf } from './minefake.js';
import type { Goal } from '../src/actuators/bot.js';
import type { Facts, JobState } from '../src/types/index.js';

const AIR = { name: 'air', boundingBox: 'empty' };
const STONE = { name: 'stone', boundingBox: 'block' };

test('Motion: a safe goTo swaps in the safe movements and puts the old ones back (done or aborted)', async () => {
    const set: unknown[] = [];
    let finish: (() => void) | null = null;
    const pf = {
        movements: 'default' as unknown,
        goto: () => new Promise<void>(r => { finish = r; }),
        setGoal: () => {},
        setMovements(m: unknown) { set.push(m); pf.movements = m; },
    };
    const bot: MotionBot = { pathfinder: pf, stopDigging: () => {}, clearControlStates: () => {} };
    const m = new Motion(bot, 60000, () => 'safe');
    const p = m.goTo({}, new AbortController().signal, { safe: true });
    assert.equal(pf.movements, 'safe');
    finish!();
    assert.deepEqual(await p, { ok: true });
    assert.equal(pf.movements, 'default');
    const c = new AbortController();
    const q = m.goTo({}, c.signal, { safe: true });
    c.abort();
    assert.equal((await q).ok, false);
    assert.equal(pf.movements, 'default', 'restored on an abort too');
    await m.goTo({}, new AbortController().signal, { timeoutMs: 5 });
    assert.deepEqual(set, ['safe', 'default', 'safe', 'default'], 'a plain goTo leaves the movements alone');
});

/** an actuator world: andy at (0.5, 64, 0.5) on stone, air around, ore at o. */
function oreWorld(o = { x: 2, y: 64, z: 0 }, hollow = false) {
    const w = world({ items: [{ name: 'stone_pickaxe', count: 1 }] });
    for (let x = -3; x <= 4; x++) for (let z = -3; z <= 3; z++) {
        w.blocks[`${x},63,${z}`] = STONE;
        for (let y = 64; y <= 66; y++) w.blocks[`${x},${y},${z}`] = AIR;
    }
    w.blocks[`${o.x},${o.y},${o.z}`] = { name: 'iron_ore', boundingBox: 'block' };
    if (hollow) for (let y = o.y - 5; y < o.y; y++) w.blocks[`${o.x},${y},${o.z}`] = AIR;
    w.drops.iron_ore = 'raw_iron';
    const goals: Goal[] = [];
    const goTo = w.act.motion.goTo;
    w.act.motion.goTo = (g, s, opts) => { goals.push({ g, opts }); return goTo(g, s, opts); };
    return { w, goals };
}

test('collectOreAt: the safe path to it, dig, the drop in the pack', async () => {
    const { w, goals } = oreWorld();
    const r = await collectOreAt(w.act, { x: 2, y: 64, z: 0 }, ['iron_ore'], 'raw_iron', new AbortController().signal);
    assert.deepEqual(r, { ok: true, cancelled: false });
    assert.deepEqual(goals[0], { g: { lookAt: '2,64,0' }, opts: { timeoutMs: 30000, safe: true } });
    assert.equal(w.items.find(i => i.name === 'raw_iron')?.count, 1);
    // not the ore any more: nothing to do
    assert.deepEqual(await collectOreAt(w.act, { x: 2, y: 64, z: 0 }, ['iron_ore'], 'raw_iron', new AbortController().signal), { ok: false, cancelled: false });
});

test('collectOreAt: over a hollow it never stands on the ore, and never digs it from on top', async () => {
    const { w, goals } = oreWorld({ x: 0, y: 63, z: 0 }, true);
    const r = await collectOreAt(w.act, { x: 0, y: 63, z: 0 }, ['iron_ore'], 'raw_iron', new AbortController().signal);
    assert.deepEqual((goals[0] as { g: unknown }).g, { lookAtNotOn: '0,63,0' });
    assert.equal(r.ok, false);
    assert.match(r.message ?? '', /Not digging the iron_ore under my feet at 0 63 0: there is a drop under it/);
    assert.ok(w.blocks['0,63,0'], 'still there');
});

test('collectOreAt: a drop that never reaches the pack is a failure, and says so', async () => {
    const { w } = oreWorld();
    w.drops.iron_ore = 'cobblestone'; // the pack never sees raw_iron
    const r = await collectOreAt(w.act, { x: 2, y: 64, z: 0 }, ['iron_ore'], 'raw_iron', new AbortController().signal);
    assert.equal(r.ok, false);
    assert.equal(r.message, "Broke iron_ore but couldn't pick up the raw_iron.");
});

test('collectOreAt: every goTo it makes is safe, the drop fetch too', async () => {
    const { w, goals } = oreWorld();
    // the drop is left lying out of the pickup's reach: the pack only gets it when andy walks to it (the fetch)
    w.act.bot.dig = async p => {
        delete w.blocks[`${p.x},${p.y},${p.z}`];
        w.entities.drop = { id: 9001, name: 'item', position: { x: 3.5, y: 64, z: 0.5 } };
    };
    const goTo = w.act.motion.goTo;
    w.act.motion.goTo = async (g, s, opts) => {
        const o = await goTo(g, s, opts);
        if (goals.length > 1 && w.entities.drop) { delete w.entities.drop; w.items.push({ name: 'raw_iron', count: 1 }); }
        return o;
    };
    const r = await collectOreAt(w.act, { x: 2, y: 64, z: 0 }, ['iron_ore'], 'raw_iron', new AbortController().signal);
    assert.deepEqual(r, { ok: true, cancelled: false });
    assert.equal(goals.length, 2, 'the reach and the fetch');
    for (const g of goals as { opts?: { safe?: boolean } }[]) assert.equal(g.opts?.safe, true, `safe: ${JSON.stringify(g)}`);
});

test('placeAt: a block into a seagrass or bubble column cell (replaced), and into kelp or leaf litter (dug first)', async () => {
    const { w } = oreWorld();
    w.items.push({ name: 'cobblestone', count: 3 });
    w.blocks['0,64,1'] = { name: 'seagrass', boundingBox: 'empty' };
    assert.equal(await placeAt(w.act, 'cobblestone', { x: 0, y: 64, z: 1 }, 'bottom', new AbortController().signal), true);
    assert.equal(w.blocks['0,64,1']?.name, 'cobblestone');
    w.blocks['1,64,1'] = { name: 'bubble_column', boundingBox: 'empty' };
    assert.equal(await placeAt(w.act, 'cobblestone', { x: 1, y: 64, z: 1 }, 'bottom', new AbortController().signal), true);
    assert.equal(w.blocks['1,64,1']?.name, 'cobblestone');
    // kelp isn't replaceable: dug first, the water stays, then the block goes in
    w.blocks['-1,64,1'] = { name: 'kelp_plant', boundingBox: 'empty' };
    const dig = w.act.bot.dig;
    w.act.bot.dig = async p => { await dig(p); w.blocks[`${p.x},${p.y},${p.z}`] = { name: 'water', boundingBox: 'empty' }; };
    assert.equal(await placeAt(w.act, 'cobblestone', { x: -1, y: 64, z: 1 }, 'bottom', new AbortController().signal), true);
    assert.ok(w.calls.some(c => c.what === 'dig' && c.arg === '-1,64,1'), 'the kelp dug');
    assert.equal(w.blocks['-1,64,1']?.name, 'cobblestone');
    // leaf litter on a floor cell (5.5 place skill): vanilla won't place over it, so it is dug first
    w.act.bot.dig = async p => { await dig(p); w.blocks[`${p.x},${p.y},${p.z}`] = { name: 'air', boundingBox: 'empty' }; };
    w.items.push({ name: 'cobblestone', count: 1 });
    w.blocks['0,64,1'] = { name: 'leaf_litter', boundingBox: 'empty' };
    assert.equal(await placeAt(w.act, 'cobblestone', { x: 0, y: 64, z: 1 }, 'bottom', new AbortController().signal), true);
    assert.ok(w.calls.some(c => c.what === 'dig' && c.arg === '0,64,1'), 'the leaf litter dug');
});

test('placeAt: a torch on the wall (against it) or on the floor; a block into lava', async () => {
    const { w } = oreWorld();
    w.items.push({ name: 'torch', count: 3 }, { name: 'cobblestone', count: 2 });
    w.blocks['-1,65,0'] = STONE;
    assert.equal(await placeAt(w.act, 'torch', { x: 0, y: 65, z: 0 }, 'west', new AbortController().signal), true);
    assert.equal(w.calls.find(c => c.what === 'place')?.arg, '-1,65,0 1,0,0', 'against the west wall, its east face');
    assert.equal(await placeAt(w.act, 'torch', { x: 1, y: 64, z: 0 }, 'bottom', new AbortController().signal), true);
    assert.equal(w.calls.filter(c => c.what === 'place')[1]?.arg, '1,63,0 0,1,0');
    w.blocks['0,64,1'] = { name: 'lava', boundingBox: 'empty' };
    assert.equal(await placeAt(w.act, 'cobblestone', { x: 0, y: 64, z: 1 }, 'bottom', new AbortController().signal), true);
    assert.equal(w.blocks['0,64,1']?.name, 'cobblestone');
    assert.equal(await placeAt(w.act, 'torch', { x: 2, y: 64, z: 0 }, 'bottom', new AbortController().signal), false, 'ore in the way: never dug for a torch');
});

test('depositAtHome: the home chest first, then the chest touching it; none: null', async () => {
    const { w } = oreWorld();
    w.items.push({ name: 'raw_iron', count: 5 }, { name: 'dirt', count: 10 });
    w.blocks['3,64,0'] = { name: 'chest', boundingBox: 'block' };
    w.blocks['3,64,1'] = { name: 'chest', boundingBox: 'block' };
    const left = await depositAtHome(w.act, { x: 3, y: 64, z: 0 }, [{ name: 'raw_iron', count: 5 }, { name: 'dirt', count: 10 }], new AbortController().signal);
    assert.deepEqual(left, []);
    assert.deepEqual(w.chests['3,64,0'], { raw_iron: 5, dirt: 10 });
    assert.equal(await depositAtHome(w.act, { x: 9, y: 64, z: 9 }, [{ name: 'dirt', count: 1 }], new AbortController().signal), null);
});

test('resume: mined 3 of 8 iron, restart: it mines 5 more (the count is the progress)', async () => {
    const blocks: Record<string, string> = {};
    for (let x = 2; x <= 40; x += 2) blocks[`${x},16,0`] = 'iron_ore';
    const seenOrTunnel = (st: string) => answer(st.includes('\nSeen none\n') ? 'tunnel E' : 'collect');
    const s = setup({ blocks, decide: seenOrTunnel });
    s.deps.task.max_steps = 200;
    const progress: MineProgress = {};
    s.deps.progress = progress;
    const c = new AbortController();
    const collect = s.deps.collect;
    s.deps.collect = async (names, n, o) => { const ok = await collect(names, n, o); if (s.calls.collected === 3) c.abort(); return ok; };
    const r1 = await runMine(s.bot, 'iron', 8, s.deps, { signal: c.signal });
    assert.equal(r1.reason, 'interrupted');
    assert.equal(progress.done, 3, 'the paused run counted its 3');
    s.deps.collect = collect;
    const r2 = await runMine(s.bot, 'iron', 8, s.deps);
    assert.equal(r2.ok, true, r2.reason);
    assert.equal(r2.collected, 5, '5 more this run');
    assert.equal(progress.done, 8);
    assert.equal(s.inventory.raw_iron, 8);
});

test('abort: a step whose dig waits settles at once, and the run is not counted as a step', async () => {
    const s = setup({ decide: () => answer('tunnel E') });
    const w = worldOf(s.bot, s.deps);
    w.dig = (_p, signal) => new Promise(r => signal.addEventListener('abort', () => r(false), { once: true }));
    const run = new MineRun({
        ore: 'iron', count: 1, progress: {}, settings: () => ({ ...MINE_DEFAULTS, prompt: 'v1', log_steps: false, enabled: true, model: s.deps.client } as MineSettings),
        world: () => w, mines: null, log: () => {}, note: () => {}, chat: () => {}, checkpoint: () => {},
    });
    const c = new AbortController();
    const p = run.step(c.signal);
    await new Promise(r => setTimeout(r, 30));
    const t0 = Date.now();
    c.abort();
    assert.deepEqual(await p, { how: 'more' });
    assert.ok(Date.now() - t0 < 250);
    assert.equal(s.calls.moves.length, 0, 'no move after the cut-short dig');
});

function runnerDeps(over: Partial<JobDeps> = {}): JobDeps {
    return { act: () => null, places: { recall: () => null } as unknown as JobDeps['places'], follow: () => { throw new Error('no'); }, followLog: () => {}, note: () => {}, ...over };
}
const job = (count: number | 'forever', progress: MineProgress = {}): JobOf<'mine'> =>
    ({ id: 'j', spec: { kind: 'mine', ore: 'iron', count }, origin: 'player', progress, status: 'running', startedAt: 0 } as JobState as JobOf<'mine'>);
const facts = {} as Facts;

test('runner: left is count less the progress; the task off is the old fallback (collect the nearest ore)', async () => {
    const on = runnerDeps({ mine: () => ({ ...MINE_DEFAULTS, enabled: true, model: null }) });
    const r = mineRunner(job(8, { done: 3 }), on);
    assert.equal(r.left?.(), 5);
    assert.equal(mineRunner(job('forever'), on).left?.(), null);
    assert.deepEqual(await r.step(facts, new AbortController().signal), { how: 'end', end: { how: 'failed', reason: 'not in game' }, say: "I couldn't mine 8 iron: not in game." });
    // the task off: one collect of the nearest iron ore blocks (one here)
    const { w } = oreWorld();
    const off = mineRunner(job(2), runnerDeps({ act: () => w.act }));
    const end = await off.step(facts, new AbortController().signal);
    assert.deepEqual(end, { how: 'end', end: { how: 'done' }, say: 'No more iron_ore nearby to collect. Collected 1 iron_ore.' });
    assert.deepEqual(await off.step(facts, new AbortController().signal), { how: 'end', end: { how: 'cancelled' } }, 'never run twice');
});

test('mine memory: the record is on disk as soon as its 3 dug marks are (a kill -9 then still finds the mine)', async () => {
    const { v2 } = await import('./minefake.js');
    const saves: { dug?: unknown[] }[] = [];
    const s = v2({ y: 60, steps: 2 });
    s.deps.mines = { find: () => null, save: rec => { saves.push(JSON.parse(JSON.stringify(rec))); }, forget: () => {} };
    let seen = -1;
    const dig = s.deps.dig;
    // the first stair step digs 3 blocks: the save comes right after the third, before the step ends
    s.deps.dig = async (x, y, z) => { const ok = await dig(x, y, z); if (s.calls.dug.length === 3) seen = saves.length; return ok; };
    const moveTo = s.deps.moveTo;
    s.deps.moveTo = async (x, y, z, ms) => { if (seen >= 0 && seen === saves.length - 1) seen = -2; return moveTo(x, y, z, ms); };
    await runMine(s.bot, 'iron', 1, s.deps);
    assert.equal(saves[0]?.dug, undefined, 'the start save: nothing dug yet');
    assert.equal(saves[1]?.dug?.length, 3, 'saved with its 3 marks during the first step');
    assert.equal(seen, -2, 'before the step moved on');
});
