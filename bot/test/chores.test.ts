// 5.6 chores v2 around the model: the Last line from the run lines (and after a restart), the closed reason map, the
// answer → job map for every pair, the sensors (Carry/Chest/Kit split, Made, lit on place's grid), the centre (the
// old chores_home tests), the Chores ask on a fake world, and the driver's gates (idle, on, empty stack, restore).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ageOf, lastOf, readRuns, runOf, type RunEnd } from '../src/chores/runs.js';
import { choreReason, REASON_TABLE } from '../src/chores/reasons.js';
import { choreJob, choreLabel } from '../src/chores/map.js';
import { Chores, choresOf, type ChoreRun } from '../src/chores/chores.js';
import { ChoreDriver, CHORES_HOLD_MS, PLAYER_GAP_MS } from '../src/chores/driver.js';
import { placedBy } from '../src/chores/sense.js';
import { chestToAdopt, chooseCentre, homeOnPlace, surfaceOk, type Speaker } from '../src/home/centre.js';
import { kitReserved, unreserved } from '../src/home/kit.js';
import { CHORE_PAIRS, CHORE_SKILLS, CHORE_REASONS, isChoreReason, type ChoreSkill, type ChoreTarget } from '../src/types/chores.js';
import { bestTiers, biomeWord, haveCounts, inBase, inColumns, kitLine, litOf, madeCounts, searchOf, timeWord } from '../src/sensors/chores.js';
import { placeGrid, type GridBlock } from '../src/sensors/skills.js';
import { choresGoal, choresRules, readChores, type ChoresAnswer, type ChoresSituation } from '../src/models/chores/index.js';
import { makeRunner, kitPuts, needText, type JobDeps } from '../src/jobs/index.js';
import type { JobEnd, JobSpec } from '../src/types/index.js';
import { flush, until, world } from './fakeact.js';
import type { JobRunner } from '../src/director/jobs.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'chores-'));
const MIN = 60_000;
const r = (at: number, skill: ChoreSkill, target: ChoreTarget, done: boolean, reason?: string): RunEnd =>
    ({ at, skill, target, done, ...(reason ? { reason: reason as never } : {}) });

// ---- Last ----

test('Last: age rounded down, latest per pair, latest first, at most 4, gone at 10 minutes', () => {
    const now = 100 * MIN;
    assert.equal(ageOf(now, now - 59_999), 0);
    assert.equal(ageOf(now, now - 4 * MIN - 59_000), 4);
    assert.equal(ageOf(now, now + 5000), 0, 'never below 0 (a clock step)');
    const runs = [
        r(now - 9 * MIN, 'gather', 'logs', true),
        r(now - 3 * MIN, 'gather', 'logs', false, 'no_source'),
        r(now - 10 * MIN, 'hunt', 'food', true),               // age 10: gone
        r(now - 30_000, 'craft', 'torch', false, 'missing_sticks'),
        r(now - 2 * MIN, 'mine', 'cobble', true),
        r(now - 5 * MIN, 'place', 'torch', true),
        r(now - 6 * MIN, 'cook', 'none', true),
    ];
    assert.deepEqual(lastOf(runs, now), [
        { skill: 'craft', target: 'torch', done: false, age: 0, reason: 'missing_sticks' },
        { skill: 'mine', target: 'cobble', done: true, age: 2 },
        { skill: 'gather', target: 'logs', done: false, age: 3, reason: 'no_source' },
        { skill: 'place', target: 'torch', done: true, age: 5 },
    ]);
    // the latest of a pair counts even when an older one is younger than 10
    assert.deepEqual(lastOf([r(now - 9 * MIN, 'gather', 'logs', false, 'stuck'), r(now - MIN, 'gather', 'logs', true)], now),
        [{ skill: 'gather', target: 'logs', done: true, age: 1 }]);
});

test('run lines: read from the file\'s tail; ask lines and malformed lines skipped', () => {
    const dir = tmp();
    const f = path.join(dir, 'laya-chores.jsonl');
    const t = (ms: number) => new Date(ms).toISOString();
    fs.writeFileSync(f, [
        JSON.stringify({ time: t(1000), event: 'ask', state: 'x', answer: 'gather logs' }),
        JSON.stringify({ time: t(2000), event: 'run', skill: 'gather', target: 'logs', result: 'failed', reason: 'no_source', minutes: 1 }),
        JSON.stringify({ time: t(3000), event: 'run', skill: 'gather', target: 'cobble', result: 'done', minutes: 1 }),
        JSON.stringify({ time: t(4000), event: 'run', skill: 'craft', target: 'torch', result: 'failed', reason: 'need_logs', minutes: 1 }),
        '{not json',
        JSON.stringify({ time: t(5000), event: 'run', skill: 'rest', target: 'none', result: 'done', minutes: 0.3 }),
    ].join('\n') + '\n');
    assert.deepEqual(readRuns(f).map(x => `${x.skill} ${x.target} ${x.done}`), ['gather logs false', 'rest none true']);
    assert.equal(runOf('{"event":"run"}'), null);
    // a tail that cuts a line drops the cut line only
    const tail = readRuns(f, 120);
    assert.deepEqual(tail.map(x => x.skill), ['rest']);
    assert.deepEqual(readRuns(path.join(dir, 'none.jsonl')), []);
});

// ---- reasons ----

test('reasons: every reason the jobs end with maps into the closed list', () => {
    const f = (reason: string): JobEnd => ({ how: 'failed', reason });
    const cases: [JobEnd, string | null][] = [
        [{ how: 'done' }, null],
        [{ how: 'cancelled' }, 'interrupted'],
        ...CHORE_REASONS.map(x => [f(x), x] as [JobEnd, string]),
        // place skill
        [f('missing_saplings'), 'missing_saplings'], [f('missing_bed'), 'stuck'], [f('missing_crafting_table'), 'stuck'],
        // craft from a chore, and the old need_<item>
        [f('missing_logs'), 'missing_logs'], [f('need_log'), 'missing_logs'], [f('need_stick'), 'missing_sticks'], [f('need_cobblestone'), 'missing_cobble'],
        [f('need_raw_iron'), 'missing_iron'], [f('need_string'), 'missing_wool'], [f('need_wheat_seeds'), 'missing_seeds'], [f('need_sand'), 'stuck'],
        // craft job
        [f('the craft task is off (settings.decision_models.tasks.craft)'), 'stuck'], [f("the craft model doesn't know bed"), 'stuck'],
        [f('max-steps'), 'timeout'], [f('no-answer'), 'stuck'], [f('craft torch failed'), 'stuck'], [f('not in game'), 'stuck'],
        // mine job
        [f('needs a stone_pickaxe'), 'no_tool'], [f('no raw_iron after 2000 steps'), 'no_source'], [f('plan: every level mined'), 'no_source'],
        [f('4 steps failed in a row'), 'stuck'], [f('trapped: every step is unsafe'), 'stuck'], [f('hurt with no food'), 'missing_food'],
        [f('the ground at 1 2 3 is unsafe (water or caves): every plan step is vetoed'), 'stuck'],
        // farm job
        [f('no hoe'), 'no_tool'], [f('no water'), 'no_source'], [f('nothing to do'), 'no_source'], [f('no answer'), 'stuck'], [f('max steps'), 'timeout'],
        // collectBlocks
        [f('No stone nearby to collect. Collected 0 stone.'), 'no_source'], [f("Don't have right tools to harvest stone."), 'no_tool'],
        [{ how: 'blocked', reason: 'full' }, 'full'],
    ];
    for (const [end, want] of cases) {
        const got = choreReason(end);
        assert.equal(got, want, JSON.stringify(end));
        if (got) assert.ok(isChoreReason(got));
    }
    assert.ok(REASON_TABLE.length > 0);
});

// ---- the map ----

test('map: every pair of Pairs has a job with a runner and a lease label', () => {
    const s = structuredClone(SAMPLE_SITUATION);
    const deps = { act: () => null, places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} }, follow: () => ({}), followLog: () => {}, note: () => {} } as unknown as JobDeps;
    let n = 0;
    for (const k of CHORE_SKILLS) for (const t of CHORE_PAIRS[k]) {
        const a = readChores({ Skill: k, Target: t })!;
        assert.ok(a, `${k} ${t}`);
        const spec = choreJob(a, choresGoal(s, a, choresRules(s)));
        assert.ok(makeRunner({ id: 'x', spec, origin: 'chore', progress: {}, status: 'running', startedAt: 0 }, deps), `${k} ${t}: ${spec.kind}`);
        assert.equal(choreLabel(a), `${k}_${t}`);
        n++;
    }
    assert.equal(n, 44);
    const g = (a: ChoresAnswer) => choreJob(a, choresGoal(s, a, choresRules(s)));
    assert.deepEqual(g({ skill: 'hunt', target: 'food' }), { kind: 'huntFood', goal: 32, chest: 6 });
    assert.deepEqual(g({ skill: 'farm', target: 'tend' }), { kind: 'farm', crop: 'any', goal: { minutes: 3 } });
    assert.deepEqual(g({ skill: 'gather', target: 'seeds' }), { kind: 'gatherSkill', target: 'seeds', goal: 16, chest: 8 });
    assert.deepEqual(g({ skill: 'mine', target: 'coal' }), { kind: 'mine', ore: 'coal', count: 8 });
    assert.deepEqual(g({ skill: 'mine', target: 'cobble' }), { kind: 'cobble', count: 1 });
    const night = structuredClone(s); night.time = 'night';
    assert.deepEqual(choreJob({ skill: 'mine', target: 'iron' }, choresGoal(night, { skill: 'mine', target: 'iron' }, choresRules(night))),
        { kind: 'mine', ore: 'iron', count: 'forever', until: 'day' });
    assert.deepEqual(g({ skill: 'craft', target: 'wooden_shovel' }), { kind: 'craft', item: 'wooden_shovel', count: 1, into: 'kit' });
    assert.deepEqual(g({ skill: 'craft', target: 'torch' }), { kind: 'craft', item: 'torch', count: 16 });
    assert.deepEqual(g({ skill: 'store', target: 'kit' }), { kind: 'kit' });
    assert.deepEqual(g({ skill: 'ask', target: 'wool' }), { kind: 'rest', seconds: 20, ask: 'wool' });
    assert.deepEqual(g({ skill: 'rest', target: 'none' }), { kind: 'rest', seconds: 20 });
    assert.equal(needText('logs'), "I need wood: there's none near enough for me to get.");
});

// the spec's sample (chores.state.test.ts SAMPLE)
const counts = (a: number[]) => Object.fromEntries(['wood', 'sticks', 'cobble', 'coal', 'iron', 'torches', 'food', 'raw', 'wool', 'seeds', 'saplings'].map((k, i) => [k, a[i]!]));
const SAMPLE_SITUATION = {
    time: 'day', home: 'chest', biome: 'forest', table: true, furnace: false, chest: true, lit: false, bedMine: false, bedPlayer: false,
    farm: true, ready: false, axe: 'stone', pickaxe: 'wooden', sword: 'none', hoe: 'none', shovel: 'none', shears: false,
    carry: counts([3, 2, 12, 0, 0, 0, 4, 2, 0, 0, 1]), inChest: counts([40, 0, 60, 12, 0, 0, 6, 0, 0, 8, 0]), free: 20,
    made: { table: 0, furnace: 0, chest: 0, bed: 0 },
    kitPickaxe: 'stone', kitAxe: 'stone', kitShovel: 'none', kitSword: 'stone', kitFood: 3, kitTorches: 16,
    trees: 49, stone: 49, coal: 97, iron: 0, grass: 49, water: 49, animals: { cow: 49, pig: 0, sheep: 97, chicken: 0, rabbit: 0 }, ground: 2,
    canPlace: true, canSmelt: true,
    last: [{ skill: 'craft', target: 'stone_sword', done: false, reason: 'missing_sticks', age: 1 }, { skill: 'hunt', target: 'food', done: true, age: 3 }],
} as unknown as ChoresSituation;

// ---- sensors ----

test('sensors: Carry kinds, the kit is not stock (Chest less the kit), Made, tools, time and biome words', () => {
    const isFood = (n: string) => ['cooked_beef', 'beef', 'bread', 'rotten_flesh', 'carrot'].includes(n);
    const chest = [{ name: 'stone_pickaxe', count: 1 }, { name: 'wooden_pickaxe', count: 1 }, { name: 'stone_axe', count: 1 },
        { name: 'cooked_beef', count: 10 }, { name: 'beef', count: 3 }, { name: 'torch', count: 20 }, { name: 'oak_planks', count: 20 }];
    const reserved = kitReserved(chest, isFood);
    assert.deepEqual(reserved, { stone_pickaxe: 1, stone_axe: 1, cooked_beef: 8, torch: 16 });
    assert.deepEqual(kitLine(reserved, isFood), { pickaxe: 'stone', axe: 'stone', shovel: 'none', sword: 'none', food: 8, torches: 16 });
    const stock = haveCounts(unreserved(chest, reserved), isFood);
    assert.deepEqual(stock, { wood: 5, sticks: 0, cobble: 0, coal: 0, iron: 0, torches: 4, food: 5, raw: 3, wool: 0, seeds: 0, saplings: 0 },
        'the kit (8 cooked beef, 16 torches, the tools) is never counted as stock');
    const carry = haveCounts([{ name: 'oak_log', count: 2 }, { name: 'birch_planks', count: 9 }, { name: 'cobbled_deepslate', count: 3 }, { name: 'cobblestone', count: 4 },
        { name: 'charcoal', count: 1 }, { name: 'coal', count: 2 }, { name: 'raw_iron', count: 2 }, { name: 'iron_ingot', count: 1 }, { name: 'string', count: 9 },
        { name: 'white_wool', count: 1 }, { name: 'oak_sapling', count: 2 }, { name: 'wheat_seeds', count: 5 }, { name: 'carrot', count: 2 },
        { name: 'rotten_flesh', count: 4 }, { name: 'stick', count: 3 }], isFood);
    assert.deepEqual(carry, { wood: 4, sticks: 3, cobble: 7, coal: 3, iron: 3, torches: 0, food: 2, raw: 0, wool: 3, seeds: 7, saplings: 2 });
    assert.equal(haveCounts([{ name: 'cobblestone', count: 5000 }], isFood).cobble, 999, 'capped at 999');
    assert.deepEqual(madeCounts([{ name: 'crafting_table', count: 1 }, { name: 'red_bed', count: 1 }, { name: 'white_bed', count: 1 }, { name: 'chest', count: 12 }]),
        { table: 1, furnace: 0, chest: 9, bed: 2 });
    assert.deepEqual(bestTiers(['wooden_pickaxe', 'stone_pickaxe', 'golden_axe', 'netherite_sword', 'dirt']),
        { axe: 'wooden', pickaxe: 'stone', sword: 'diamond', hoe: 'none', shovel: 'none' });
    assert.deepEqual([6000, 10142, 12541, 12542, 23459, 23460, 37000].map(timeWord), ['day', 'dusk', 'dusk', 'night', 'night', 'day', 'night']);
    assert.deepEqual(['snowy_taiga', 'dark_forest', 'sunflower_plains', 'badlands', 'river', 'swamp', null].map(biomeWord),
        ['snowy', 'forest', 'plains', 'desert', 'beach', 'other', 'other']);
});

test('sensors: lit agrees with the place skill\'s torch grid', () => {
    const c = { x: 100, y: 64, z: 100 };
    const blocks = new Map<string, GridBlock>();
    const k = (x: number, y: number, z: number) => `${x},${y},${z}`;
    for (let x = 85; x <= 115; x++) for (let z = 85; z <= 115; z++) {
        blocks.set(k(x, 63, z), { name: 'grass_block', boundingBox: 'block' });
        blocks.set(k(x, 64, z), { name: 'air', boundingBox: 'empty', light: 12 });
        blocks.set(k(x, 65, z), { name: 'air', boundingBox: 'empty', light: 12 });
        blocks.set(k(x, 66, z), { name: 'air', boundingBox: 'empty', light: 12 });
    }
    const at = (x: number, y: number, z: number) => blocks.get(k(x, y, z)) ?? null;
    const dark = (g: string[]) => g.join('').includes(',') || g.join('').includes(';');
    assert.equal(litOf(at, c), true);
    assert.equal(dark(placeGrid(at, c, 'torch')), false);
    // one grid point dark: both say so; a dark block off the grid: neither does
    blocks.set(k(103, 64, 109), { name: 'air', boundingBox: 'empty', light: 3 });
    assert.equal(litOf(at, c), false);
    assert.equal(dark(placeGrid(at, c, 'torch')), true);
    blocks.set(k(103, 64, 109), { name: 'air', boundingBox: 'empty', light: 12 });
    blocks.set(k(101, 64, 101), { name: 'air', boundingBox: 'empty', light: 0 });
    assert.equal(litOf(at, c), true);
    assert.equal(dark(placeGrid(at, c, 'torch')), false);
});

// ---- the centre (the old test/laya_chores_home.test.js) ----

const self = { x: 0, y: 64, z: 0 };
const surface: Speaker = { name: 'chrisjoyce911', pos: { x: 10, y: 64, z: 0 }, dist: 10, overworld: true, onGround: true, inFluid: false, openSky: true };
const seen = (o: Partial<Parameters<typeof chooseCentre>[0]> = {}) => ({ homeBed: null, homeChest: null, homeTable: null, playerPlaced: [], nearby: [], speaker: null, saved: null, self, ...o });

test('centre: the bed first, then the saved home, then a player-placed block', () => {
    assert.deepEqual(chooseCentre(seen({ homeBed: [5, 64, 5], homeChest: [1, 64, 1] })), { home: 'bed', pos: { x: 5, y: 64, z: 5 } });
    assert.equal(chooseCentre(seen({ homeChest: [1, 64, 1] })).home, 'chest');
    assert.equal(chooseCentre(seen({ homeChest: [1, 64, 1], homeTable: [2, 64, 2] })).home, 'table', 'a table home keeps the centre at the table');
    const c = chooseCentre(seen({ playerPlaced: [{ kind: 'chest', pos: { x: 6, y: 64, z: 0 } }], speaker: surface }));
    assert.equal(c.home, 'chest');
    assert.equal(c.save?.place, 'home_chest');
    assert.equal(c.save?.say, "I'll use your chest at 6 64 0 as home.");
});

test('centre: a table already there (within 49×49), else the player on the surface, else himself', () => {
    const t = chooseCentre(seen({ nearby: [{ kind: 'table', pos: { x: 15, y: 63, z: 0 } }], speaker: surface }));
    assert.deepEqual([t.home, t.save?.place, t.save?.say], ['table', 'home_table', "I'll use the crafting table at 15 63 0 as home."]);
    assert.equal(chooseCentre(seen({ nearby: [{ kind: 'table', pos: { x: 30, y: 63, z: 0 } }], speaker: surface })).home, 'player', 'beyond 49×49');
    const p = chooseCentre(seen({ speaker: surface }));
    assert.deepEqual([p.home, p.pos, p.save?.place, p.save?.kind], ['player', { x: 10, y: 64, z: 0 }, 'chores_centre', 'player']);
    assert.equal(chooseCentre(seen({ speaker: { ...surface, openSky: false } })).home, 'self', 'player in a cave');
    assert.equal(chooseCentre(seen({ speaker: { ...surface, dist: 40 } })).home, 'self');
    assert.equal(chooseCentre(seen({ speaker: { ...surface, overworld: false } })).home, 'self');
    assert.ok(!surfaceOk({ ...surface, inFluid: true }));
    assert.deepEqual(chooseCentre(seen({ saved: { kind: 'player', pos: { x: 3, y: 64, z: 3 } }, speaker: surface })), { home: 'player', pos: { x: 3, y: 64, z: 3 } }, 'a saved centre is kept');
});

test('centre (6.2a): a found chest or table is adopted only near the base, never one underground far away', () => {
    const chest = (x: number, y: number, z: number) => ({ kind: 'chest' as const, pos: { x, y, z } });
    // a fresh start (no saved centre): within 49×49 of andy and ±16 of him
    assert.equal(chooseCentre(seen({ nearby: [chest(5, 64, 5)] })).home, 'chest');
    assert.equal(chooseCentre(seen({ nearby: [chest(5, 80, 5)] })).home, 'chest', '16 up');
    assert.equal(chooseCentre(seen({ nearby: [chest(5, 40, 5)] })).home, 'self', '24 below him');
    // a saved centre: only in its base area (21×21, ±16), nearest the centre
    const saved = { kind: 'self' as const, pos: { x: 100, y: 64, z: 100 } };
    assert.deepEqual(chooseCentre(seen({ saved, nearby: [chest(105, 63, 98)] })).save?.pos, { x: 105, y: 63, z: 98 }, 'in the base area');
    assert.deepEqual(chooseCentre(seen({ saved, nearby: [chest(100, 30, 100)] })), { home: 'self', pos: { x: 100, y: 64, z: 100 } }, 'under the base');
    assert.deepEqual(chooseCentre(seen({ saved, nearby: [chest(0, 64, 0)] })).pos, { x: 100, y: 64, z: 100 }, 'by andy, far from the base');
    assert.deepEqual(chooseCentre(seen({ saved, nearby: [chest(109, 64, 100), chest(102, 64, 100)] })).save?.pos, { x: 102, y: 64, z: 100 }, 'nearest the centre');
});

test('centre (6.2a): a dug table home leaves chores_centre at its spot, and a chest far below is not adopted', async () => {
    const dir = tmp();
    const w = world({ items: [{ name: 'oak_log', count: 2 }] });
    const me = w.facts.pos;
    const home = { x: Math.floor(me.x) + 3, y: Math.floor(me.y), z: Math.floor(me.z) + 3 };
    w.blocks[`${home.x},${home.y},${home.z}`] = { name: 'air' } as never;
    w.blocks[`${home.x},${home.y - 30},${home.z}`] = { name: 'chest' } as never;
    const t = choresOn(dir, w);
    t.places.home_table = [home.x, home.y, home.z];
    await t.c.next();
    assert.equal(t.places.home_table, undefined, 'the gone table is forgotten');
    assert.deepEqual(t.places.chores_centre, [home.x, home.y, home.z], 'the base stays at its spot');
    assert.equal(t.places.home_chest, undefined, 'the chest 30 below is not the home');
    assert.ok(!t.said.some(s => /as home/.test(s)), t.said.join(' | '));
});

test('centre: the first chest or table he places becomes the home; a chest in the base for a table home; beds', () => {
    const none = { homeBed: null, playerBed: null, homeChest: null, homeTable: null, centre: null };
    assert.deepEqual(homeOnPlace('chest', { x: 2, y: 64, z: 2 }, 'me', none), [{ place: 'home_chest', pos: { x: 2, y: 64, z: 2 } }, { place: 'chores_centre', pos: null }]);
    assert.deepEqual(homeOnPlace('table', { x: 2, y: 64, z: 2 }, 'me', none)[0], { place: 'home_table', pos: { x: 2, y: 64, z: 2 } });
    const tableHome = { ...none, homeTable: [0, 64, 0] as const, centre: { x: 0, y: 64, z: 0 } };
    assert.deepEqual(homeOnPlace('chest', { x: 3, y: 64, z: 1 }, 'me', tableHome), [{ place: 'home_chest', pos: { x: 3, y: 64, z: 1 } }]);
    assert.deepEqual(homeOnPlace('chest', { x: 30, y: 64, z: 1 }, 'me', tableHome), [], 'outside the base');
    assert.deepEqual(chestToAdopt({ home: 'bed', pos: { x: 60, y: 64, z: 0 } }, [0, 64, 0], [{ x: 58, y: 64, z: 3 }]), { x: 58, y: 64, z: 3 });
    assert.equal(chestToAdopt({ home: 'bed', pos: { x: 60, y: 64, z: 0 } }, [61, 64, 0], [{ x: 58, y: 64, z: 3 }]), null, 'home chest already in the base');
    assert.equal(chestToAdopt({ home: 'chest', pos: self }, null, [{ x: 1, y: 64, z: 1 }]), null);
    assert.deepEqual(homeOnPlace('bed', { x: 60, y: 64, z: 0 }, 'player', none), [{ place: 'home_bed', pos: { x: 60, y: 64, z: 0 }, say: 'My home is now at 60 64 0.' }]);
    assert.deepEqual(homeOnPlace('bed', { x: 60, y: 64, z: 0 }, 'player', { ...none, homeBed: [1, 64, 1] }), [], 'he has one');
    assert.equal(homeOnPlace('bed', { x: 3, y: 64, z: 1 }, 'me', { ...none, homeBed: [1, 64, 1] })[0]?.place, 'player_bed', 'his second bed is the player\'s');
    const players = [{ name: 'a', pos: { x: 4, y: 64, z: 0 } }, { name: 'b', pos: { x: 2, y: 64, z: 0 } }];
    assert.equal(placedBy({ x: 0, y: 64, z: 0 }, players, { x: 30, y: 64, z: 0 }), 'b');
    assert.equal(placedBy({ x: 0, y: 64, z: 0 }, players, { x: 1, y: 64, z: 0 }), null, 'andy is nearer');
    assert.ok(inColumns(self, { x: 24, y: 0, z: -24 }, 49) && !inColumns(self, { x: 25, y: 64, z: 0 }, 49));
    assert.ok(inBase(self, { x: 10, y: 80, z: -10 }) && !inBase(self, { x: 10, y: 81, z: 0 }) && !inBase(self, { x: 11, y: 64, z: 0 }));
    assert.deepEqual([[40], [90, 60], [90, 48], [97]].map(xs => searchOf(self, xs.map(x => ({ x, y: 64, z: 0 })))), [97, 193, 97, 0]);
});

test('kit: cooked food up to 8 and torches up to 16, keeping 8 torches carried', () => {
    const isFood = (n: string) => ['cooked_beef', 'beef', 'bread'].includes(n);
    assert.deepEqual(kitPuts([{ name: 'cooked_beef', count: 5 }, { name: 'beef', count: 9 }, { name: 'bread', count: 9 }, { name: 'torch', count: 30 }], { cooked_beef: 2, torch: 4 }, isFood),
        [{ name: 'cooked_beef', count: 5 }, { name: 'bread', count: 1 }, { name: 'torch', count: 12 }]);
    assert.deepEqual(kitPuts([{ name: 'torch', count: 19 }], {}, isFood), [], '16 would leave 3 carried');
});

// ---- Chores on a fake world ----

function choresOn(dir: string, w: ReturnType<typeof world>, over: Partial<ConstructorParameters<typeof Chores>[0]> = {}) {
    const lines: Record<string, unknown>[] = [];
    const places: Record<string, [number, number, number]> = {};
    const said: string[] = [];
    const runsFile = path.join(dir, 'laya-chores.jsonl');
    let now = Date.parse('2026-11-12T00:00:00Z');
    const c = new Chores({
        stateFile: path.join(dir, 'laya-chores.json'), runsFile, settingOn: true,
        settings: () => choresOf({}), client: () => null, served: () => undefined, act: () => w.act,
        sense: {
            places: { all: () => ({ ...places }), recall: n => places[n] ?? null, remember: (n, p) => { places[n] = [p.x, p.y, p.z]; }, forget: n => { delete places[n]; } },
            say: t => said.push(t), speaker: () => null, placed: () => [], clearPlaced: () => {},
        },
        canRun: () => true,
        log: line => { lines.push(line as never); fs.appendFileSync(runsFile, JSON.stringify({ time: new Date(now).toISOString(), ...line }) + '\n'); },
        note: () => {},
        now: () => now,
        ...over,
    });
    return { c, lines, places, said, tick: (ms: number) => { now += ms; } };
}

test('Chores: the ask is logged with the state, and Last is rebuilt from the run lines after a restart', async () => {
    const dir = tmp();
    const w = world({ items: [{ name: 'oak_log', count: 2 }] });
    const t = choresOn(dir, w);
    const run = (await t.c.next())!;
    assert.ok(run);
    const ask = t.lines.find(l => l.event === 'ask')!;
    assert.match(String(ask.state), /^Chores\.\nTime day Home self Biome other\n/);
    assert.match(String(ask.state), /\nCarry wood 2 /);
    assert.match(String(ask.state), /\nLast none$/);
    assert.equal(ask.source, 'rules');
    assert.equal(ask.why, 'rules');
    assert.equal(ask.answer, `${run.answer.skill} ${run.answer.target}`);
    assert.equal(t.places.chores_centre?.length, 3, 'the centre (himself) is saved');
    // the run fails: its line is written; a new Chores on the same files (a restart) sees it in Last
    t.c.ended(run, { how: 'failed', reason: 'No stone nearby to collect.' });
    t.tick(2 * MIN + 5000);
    const again = choresOn(dir, w, { now: () => Date.parse('2026-11-12T00:02:05Z') });
    assert.deepEqual(again.c.last(), [{ skill: run.answer.skill, target: run.answer.target, done: false, reason: 'no_source', age: 2 }]);
    await again.c.next();
    const ask2 = again.lines.find(l => l.event === 'ask')!;
    assert.match(String(ask2.state), new RegExp(`\\nLast ${run.answer.skill} ${run.answer.target} failed:no_source 2$`));
});

test('Chores: not served at v2: the rules decide (why not-v2); a model answer with no runner is impossible', async () => {
    const dir = tmp();
    const w = world({ items: [{ name: 'oak_log', count: 2 }] });
    const client = { decide: async () => ({ ms: 3, answers: { Skill: { type: 'choice', top: 'cook', topProbability: 0.9, probabilities: {}, confident: true }, Target: { type: 'choice', top: 'none', topProbability: 0.9, probabilities: {}, confident: true } } }) } as never;
    const t = choresOn(dir, w, { client: () => client, served: () => 'v1.1' });
    await t.c.next();
    assert.equal(t.lines.at(-1)!.why, 'not-v2');
    const u = choresOn(tmp(), w, { client: () => client, served: () => 'v2', canRun: s => s.kind !== 'cook' });
    const r2 = (await u.c.next())!;
    assert.deepEqual(u.lines.map(l => l.event), ['impossible', 'run', 'ask']);
    assert.equal(u.lines[1]!.reason, 'stuck');
    assert.equal(r2.source, 'rules');
});

test('Chores: chestSeen keeps the home chest\'s items (only the home chest); on/off is saved', () => {
    const dir = tmp();
    const t = choresOn(dir, world());
    t.c.chestSeen({ x: 1, y: 64, z: 1 }, [{ name: 'oak_log', count: 3 }], [5, 64, 5]);
    assert.deepEqual(t.c.state.chestItems, []);
    t.c.chestSeen({ x: 5, y: 64, z: 5 }, [{ name: 'oak_log', count: 3 }], [5.5, 64, 5.5]);
    assert.deepEqual(t.c.state.chestItems, [{ name: 'oak_log', count: 3 }]);
    t.c.setOn(false);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, 'laya-chores.json'), 'utf8'));
    assert.equal(saved.on, false);
    assert.deepEqual(saved.chestItems, [{ name: 'oak_log', count: 3 }]);
    assert.equal(choresOn(dir, world()).c.on, false, 'off survives a restart');
});

// ---- the driver ----

function fakeSource(spec: JobSpec = { kind: 'rest', seconds: 600 }) {
    const ended: { run: ChoreRun; end: JobEnd }[] = [];
    let asks = 0;
    const src = {
        on: true,
        next: async (): Promise<ChoreRun> => { asks++; return { answer: { skill: 'rest', target: 'none' }, goal: null, spec, label: 'rest_none', source: 'rules', startedAt: 0 }; },
        ended: (run: ChoreRun, end: JobEnd) => { ended.push({ run, end }); },
        get asks() { return asks; },
    };
    return { src, ended };
}
/** A runner that runs until aborted. */
const forever = (): JobRunner => ({ step: async (_f, signal) => { await new Promise(r => { const t = setTimeout(r, 10_000); signal.addEventListener('abort', () => { clearTimeout(t); r(null); }, { once: true }); }); return { how: 'more' }; } });

test('driver: a chore starts only when idle, on, the stack empty and the restore done; a player\'s command interrupts it', async () => {
    const w = world({ runners: () => forever() });
    const { src, ended } = fakeSource();
    let now = 1_000_000;
    const d = new ChoreDriver({ chores: src, free: () => w.lease.isFree, note: () => {}, now: () => now });
    await d.idle(w.director);
    assert.equal(src.asks, 0, 'not before the restore');
    d.restored = true;
    src.on = false;
    await d.idle(w.director);
    assert.equal(src.asks, 0, 'not while off');
    src.on = true;
    d.playerCommand(true);
    await d.idle(w.director);
    assert.equal(src.asks, 0, 'a player\'s stop holds chores');
    now += CHORES_HOLD_MS;
    d.playerCommand();
    await d.idle(w.director);
    assert.equal(src.asks, 0, 'not right after a player\'s command');
    now += PLAYER_GAP_MS;
    void d.idle(w.director);
    assert.ok(await until(() => w.lease.holderName === 'action:chore:rest_none'), w.lease.holderName ?? 'free');
    assert.equal(w.director.stack.job()?.origin, 'chore');
    await d.idle(w.director);
    assert.equal(src.asks, 1, 'one run at a time');
    // a player's command replaces it: the run ends interrupted
    await w.director.startJob({ kind: 'stay', seconds: -1 }, 'player', {});
    assert.ok(await until(() => ended.length === 1));
    assert.equal(choreReason(ended[0]!.end), 'interrupted');
    await d.idle(w.director);
    assert.equal(src.asks, 1, 'not while the player\'s job is on the stack');
    await w.director.stop();
    await flush();
});

test('driver: chores off mid-chore stops it, with no run line; a pause and resume keeps the same run', async () => {
    const w = world({ runners: () => forever() });
    const { src, ended } = fakeSource();
    const d = new ChoreDriver({ chores: src, free: () => w.lease.isFree, note: () => {} });
    d.restored = true;
    void d.idle(w.director);
    assert.ok(await until(() => w.director.stack.job()?.origin === 'chore'));
    const job = w.director.stack.job()!;
    w.director.stack.paused(job as never);
    w.director.stack.resumed(job as never);
    assert.equal(ended.length, 0, 'a pause is not an end');
    await d.off(w.director);
    assert.ok(await until(() => w.director.stack.depth === 0 && !d.busy));
    assert.equal(ended.length, 0, 'withdrawn: no result');
    // the next run (chores on again) ends normally
    void d.idle(w.director);
    assert.ok(await until(() => w.director.stack.job()?.origin === 'chore'));
    await w.director.stop();
    assert.ok(await until(() => ended.length === 1));
    assert.equal(choreReason(ended[0]!.end), 'interrupted', 'a stop is an interrupt');
    await w.director.stop();
});

test('settings: the chores task defaults when keys are missing', () => {
    assert.deepEqual(choresOf({}), { enabled: false, min_confidence: 0.5, can_place: true, can_smelt: true, log_steps: true });
    assert.deepEqual(choresOf({ decision_models: { tasks: { chores: { enabled: true, min_confidence: 0.3, can_place: false } } } }),
        { enabled: true, min_confidence: 0.3, can_place: false, can_smelt: true, log_steps: true });
    assert.ok(CHORE_REASONS.length === 16);
});

// ---- the chores jobs ----

test('rest with ask: "I need …" once per item per 5 minutes, then stay', async () => {
    const w = world();
    const said: string[] = [];
    let now = 1_000_000;
    const deps = {
        act: () => w.act, places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} },
        follow: () => ({}), followLog: () => {}, note: () => {}, chat: (t: string) => said.push(t), needSaid: new Map(), now: () => now,
    } as unknown as JobDeps;
    const job = (ask?: 'wool' | 'logs') => ({ id: 'r', spec: { kind: 'rest' as const, seconds: 0, ...(ask ? { ask } : {}) }, origin: 'chore' as const, progress: {}, status: 'running' as const, startedAt: now });
    const signal = new AbortController().signal;
    const f = {} as never;
    assert.deepEqual(await makeRunner(job('wool'), deps)!.step(f, signal), { how: 'end', end: { how: 'done' } });
    now += 4 * MIN;
    await makeRunner(job('wool'), deps)!.step(f, signal);
    await makeRunner(job('logs'), deps)!.step(f, signal);
    now += MIN;
    await makeRunner(job('wool'), deps)!.step(f, signal);
    assert.deepEqual(said, ["I need wool: there's none near enough for me to get.", "I need wood: there's none near enough for me to get.",
        "I need wool: there's none near enough for me to get."]);
});

test('farm: a minutes goal ends done when the time is up', async () => {
    const { FarmRun } = await import('../src/jobs/farm.js');
    const { FARM_DEFAULTS } = await import('../src/jobs/deps.js');
    const { reply, setupV2, worldOf } = await import('./farmfake.js');
    const { deps } = setupV2(Array(20).fill(reply('harvest', 'W2 N1', 'none')));
    let now = 0;
    const run = new FarmRun({
        crop: 'any', count: 'forever', progress: {},
        settings: () => ({ ...FARM_DEFAULTS, prompt: 'v2', enabled: true, model: { decide: (t, s, q) => deps.client.decide(t, s, q) } }),
        world: () => worldOf(deps), log: () => {}, note: () => {}, chat: () => {}, checkpoint: () => {}, until: 3 * MIN, now: () => now,
    });
    const signal = new AbortController().signal;
    assert.equal((await run.step(signal)).how, 'more');
    now = 3 * MIN;
    const r = await run.step(signal);
    assert.equal(r.how, 'end');
    assert.ok(r.how === 'end' && r.end.ok && r.end.reason === 'time up', JSON.stringify(r));
});

test('run lines: a forget line (a world reset) drops the runs before it', () => {
    const f = path.join(tmp(), 'laya-chores.jsonl');
    const t = new Date(1000).toISOString();
    fs.writeFileSync(f, [
        JSON.stringify({ time: t, event: 'run', skill: 'gather', target: 'logs', result: 'failed', reason: 'interrupted', minutes: 1 }),
        JSON.stringify({ time: t, event: 'forget' }),
        JSON.stringify({ time: t, event: 'run', skill: 'hunt', target: 'food', result: 'done', minutes: 1 }),
    ].join('\n') + '\n');
    assert.deepEqual(readRuns(f).map(x => x.skill), ['hunt']);
});
