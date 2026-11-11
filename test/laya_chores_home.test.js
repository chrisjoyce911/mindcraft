import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { chooseCentre, homeOnPlace, chestToAdopt, placedBy, inColumns, inBase, searchOf, surfaceOk } from '../src/agent/laya/chores_home.js';
import { Chores, CHORE_JOB, loadChoresState, saveChoresState, parseOnOff } from '../src/agent/laya/chores.js';
import { CHORES } from '../src/agent/laya/chores_state.js';
import { Director, JOB_KINDS } from '../src/agent/laya/director.js';

const self = { x: 0, y: 64, z: 0 };
const surface = { name: 'chrisjoyce911', x: 10, y: 64, z: 0, dist: 10, dimension: 'overworld', onGround: true, inFluid: false, openSky: true };

test('home: the bed first, then the saved home, then a player-placed block', () => {
    assert.deepEqual(chooseCentre({ homeBed: [5, 64, 5], homeChest: [1, 64, 1], self }), { home: 'bed', pos: { x: 5, y: 64, z: 5 } });
    assert.equal(chooseCentre({ homeChest: [1, 64, 1], self }).home, 'chest');
    assert.equal(chooseCentre({ homeChest: [1, 64, 1], homeTable: [2, 64, 2], self }).home, 'table', 'a table home keeps the centre at the table');
    const c = chooseCentre({ playerPlaced: [{ kind: 'chest', pos: { x: 6, y: 64, z: 0 }, player: 'chrisjoyce911' }], self, speaker: surface });
    assert.equal(c.home, 'chest');
    assert.equal(c.save.place, 'home_chest');
    assert.equal(c.save.say, "I'll use your chest at 6 64 0 as home.");
});

test('home: a table already there (within 49×49), else the player on the surface, else himself', () => {
    const t = chooseCentre({ nearby: [{ kind: 'table', pos: { x: 15, y: 63, z: 0 } }], self, speaker: surface });
    assert.deepEqual([t.home, t.save.place, t.save.say], ['table', 'home_table', "I'll use the crafting table at 15 63 0 as home."]);
    assert.equal(chooseCentre({ nearby: [{ kind: 'table', pos: { x: 30, y: 63, z: 0 } }], self, speaker: surface }).home, 'player', 'beyond 49×49');
    const p = chooseCentre({ self, speaker: surface });
    assert.deepEqual([p.home, p.pos, p.save.place, p.save.kind], ['player', { x: 10, y: 64, z: 0 }, 'chores_centre', 'player']);
    assert.equal(chooseCentre({ self, speaker: { ...surface, openSky: false } }).home, 'self', 'player in a cave');
    assert.equal(chooseCentre({ self, speaker: { ...surface, dist: 40 } }).home, 'self');
    assert.equal(chooseCentre({ self, speaker: { ...surface, dimension: 'the_nether' } }).home, 'self');
    assert.ok(!surfaceOk({ ...surface, inFluid: true }));
    assert.deepEqual(chooseCentre({ self, saved: { kind: 'player', pos: { x: 3, y: 64, z: 3 } }, speaker: surface }), { home: 'player', pos: { x: 3, y: 64, z: 3 } }, 'a saved centre is kept');
});

test('home: the first chest or table he places becomes the home; a chest in the base for a table home', () => {
    assert.deepEqual(homeOnPlace('chest', { x: 2, y: 64, z: 2 }, 'me', {}), [{ place: 'home_chest', pos: { x: 2, y: 64, z: 2 } }, { place: 'chores_centre', pos: null }]);
    assert.deepEqual(homeOnPlace('table', { x: 2, y: 64, z: 2 }, 'me', {})[0], { place: 'home_table', pos: { x: 2, y: 64, z: 2 } });
    const tableHome = { homeTable: [0, 64, 0], centre: { home: 'table', pos: { x: 0, y: 64, z: 0 } } };
    assert.deepEqual(homeOnPlace('chest', { x: 3, y: 64, z: 1 }, 'me', tableHome), [{ place: 'home_chest', pos: { x: 3, y: 64, z: 1 } }]);
    assert.deepEqual(homeOnPlace('chest', { x: 30, y: 64, z: 1 }, 'me', tableHome), [], 'outside the base');
    // moved bed: the new base adopts a chest there, the old chest stays until then
    const bedHome = { homeBed: [60, 64, 0], homeChest: [0, 64, 0], centre: { home: 'bed', pos: { x: 60, y: 64, z: 0 } } };
    assert.deepEqual(homeOnPlace('chest', { x: 62, y: 64, z: 0 }, 'me', bedHome), [{ place: 'home_chest', pos: { x: 62, y: 64, z: 0 } }]);
    assert.deepEqual(chestToAdopt(bedHome.centre, bedHome.homeChest, [{ x: 58, y: 64, z: 3 }]), { x: 58, y: 64, z: 3 });
    assert.equal(chestToAdopt(bedHome.centre, [61, 64, 0], [{ x: 58, y: 64, z: 3 }]), null, 'home chest already in the base');
    assert.equal(chestToAdopt({ home: 'chest', pos: self }, null, [{ x: 1, y: 64, z: 1 }]), null);
});

test('home bed: a bed placed when the home bed is gone becomes the home', () => {
    assert.deepEqual(homeOnPlace('bed', { x: 60, y: 64, z: 0 }, 'player', {}), [{ place: 'home_bed', pos: { x: 60, y: 64, z: 0 }, say: 'My home is now at 60 64 0.' }]);
    assert.deepEqual(homeOnPlace('bed', { x: 60, y: 64, z: 0 }, 'player', { homeBed: [1, 64, 1] }), [], 'he has one');
    assert.equal(homeOnPlace('bed', { x: 1, y: 64, z: 1 }, 'me', {}, true)[0].place, 'home_bed');
});

test('who placed it: the nearest player within 5, unless someone is nearer', () => {
    const players = [{ name: 'a', x: 4, y: 64, z: 0 }, { name: 'b', x: 2, y: 64, z: 0 }];
    assert.equal(placedBy({ x: 0, y: 64, z: 0 }, players, { x: 30, y: 64, z: 0 }), 'b');
    assert.equal(placedBy({ x: 0, y: 64, z: 0 }, players, { x: 1, y: 64, z: 0 }), null, 'the bot is nearer');
    assert.equal(placedBy({ x: 0, y: 64, z: 0 }, [{ name: 'a', x: 9, y: 64, z: 0 }], null), null);
});

test('areas: base 21×21 (±16 high), work 49×49, search 49 → 97 → 193', () => {
    assert.ok(inColumns(self, { x: 24, y: 0, z: -24 }, 49));
    assert.ok(!inColumns(self, { x: 25, y: 64, z: 0 }, 49));
    assert.ok(inBase(self, { x: 10, y: 80, z: -10 }));
    assert.ok(!inBase(self, { x: 10, y: 81, z: 0 }));
    assert.ok(!inBase(self, { x: 11, y: 64, z: 0 }));
    assert.equal(searchOf(self, [{ x: 40, y: 64, z: 0 }]), 97);
    assert.equal(searchOf(self, [{ x: 90, y: 64, z: 0 }, { x: 60, y: 64, z: 0 }]), 193);
    assert.equal(searchOf(self, [{ x: 90, y: 64, z: 0 }, { x: 48, y: 64, z: 0 }]), 97);
    assert.equal(searchOf(self, [{ x: 96, y: 64, z: 96 }]), 193);
    assert.equal(searchOf(self, [{ x: 97, y: 64, z: 0 }]), null);
});

test('every chore has a director job kind', () => {
    for (const c of CHORES) assert.ok(JOB_KINDS.includes(CHORE_JOB[c]?.[0]), c);
});

test('Chores: logs each decision with its source; a model answer it cannot start is impossible, asked again', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'chores-'));
    const log = join(dir, 'laya-chores.jsonl');
    const base = { home: 'self', time: 'day', biome: 'forest', axe: 'none', pickaxe: 'none', sword: 'none', hoe: 'none', shovel: 'none',
        wood: 0, sticks: 0, cobble: 0, coal: 0, torches: 0, food: 10, raw: 0, wool: 0, seeds: 0, saplings: 0, pack: 30,
        kitPickaxe: 'none', kitAxe: 'none', kitShovel: 'none', kitSword: 'none', kitFood: 0, kitTorches: 0,
        near: { trees: 97 }, animals: {}, ground: 0, canPlace: false, canSmelt: false };
    let t = 1000;
    const r = new Chores({ sense: async () => ({ ...base }), stepLog: log, now: () => t });
    assert.deepEqual([(await r.next()).chore, (await r.next()).source], ['gather_logs', 'rules']);
    r.ended('gather_logs', 'failed', 'no log I could reach');
    const d = await r.next();
    assert.notEqual(d.chore, 'gather_logs', 'gather_logs failed lately: its rule falls through');
    assert.match(d.state, /Failed gather_logs$/);
    t += 5 * 60_000 + 1;
    assert.equal((await r.next()).chore, 'gather_logs', 'forgotten after 5 minutes');
    const model = { decide: async () => ({ answers: { Chore: { top: 'place_table', topProbability: 0.9, confident: true } } }) };
    const m = new Chores({ sense: async () => ({ ...base }), client: model, task: {}, stepLog: log, now: () => t });
    const g = await m.next();
    assert.equal(g.chore, 'rest', 'masked every time: gives up to rest, never a rule pick');
    assert.equal(m.counters.impossible, 3);
    const lines = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.ok(lines.some(l => l.event === 'impossible' && l.answer === 'place_table' && l.source === 'model'));
    assert.ok(lines.filter(l => l.event === 'ask').every(l => l.source === 'rules' || l.source === 'model'));
});

test('chores state file and on/off words', () => {
    const dir = mkdtempSync(join(tmpdir(), 'chores-'));
    const p = join(dir, 'laya-chores.json');
    assert.equal(loadChoresState(p, true).on, true, 'default from the setting');
    saveChoresState(p, { on: false, centreKind: 'player', chestItems: [{ name: 'torch', count: 3 }] });
    assert.deepEqual(loadChoresState(p, true), { on: false, centreKind: 'player', chestItems: [{ name: 'torch', count: 3 }], chestAt: null, stumps: [] });
    assert.equal(parseOnOff('"on"'), true);
    assert.equal(parseOnOff('off'), false);
    assert.equal(parseOnOff('maybe'), null);
});

test('Director: idle with nothing on the stack starts a chore; not while something runs or chores are off', async () => {
    let started = 0, on = true, idle = true;
    const calm = { health: 20, food: 20, armed: 'sword', armor: 0, hostiles: 0, nearest: null, light: 15, night: false, under: false,
        free: 20, home: null, valuables: 0, foodItems: 0, danger: 'none', player: null };
    const d = new Director({ read: () => calm, idle: () => idle, now: () => 0, chore: async () => { started++; }, choresOn: () => on,
        resume: async () => {}, perform: async () => {} });
    const flush = () => new Promise(r => setTimeout(r, 5));
    await d.tick('idle'); await flush();
    assert.equal(started, 1);
    on = false; await d.tick(); await flush();
    assert.equal(started, 1, 'chores off');
    on = true; idle = false; await d.tick(); await flush();
    assert.equal(started, 1, 'something runs');
    idle = true; d.stack.start('layaMine', ['iron', 2]); await d.tick(); await flush();
    assert.equal(started, 1, 'a job on the stack');
});

test('Director: a player attacked pauses the chore for defend; flee-ranged is performed', async () => {
    const performed = [];
    let sit = { health: 20, food: 20, armed: 'sword', armor: 0, hostiles: 0, nearest: null, light: 15, night: false, under: false,
        free: 20, home: null, valuables: 0, foodItems: 0, danger: 'none', player: null };
    const d = new Director({ read: () => sit, idle: () => false, now: () => 0, choresOn: () => true, chore: async () => {},
        resume: async () => {}, perform: async a => { performed.push([a, d.stack.pausedKind()]); } });
    d.stack.start('chore', ['gather_logs'], { kind: 'gather', item: 'log', chore: 'gather_logs' });
    sit = { ...sit, player: { name: 'tester', attacked: true, by: 'zombie', dist: 12 } };
    assert.equal((await d.tick()).rule, 'defend-player');
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(performed[0], ['defend', 'gather'], 'the chore is paused under defend');
    sit = { ...sit, player: null };
    await new Promise(r => setTimeout(r, 5));
    const f = new Director({ read: () => ({ ...sit, player: null, health: 5, hostiles: 1, nearest: { kind: 'skeleton', dist: 14 } }),
        idle: () => true, now: () => 0, resume: async () => {}, perform: async a => { performed.push([a]); f.deps.read = () => sit; } });
    assert.equal((await f.tick()).rule, 'flee-ranged');
    await new Promise(r => setTimeout(r, 5));
    assert.equal(performed[1][0], 'flee');
});
