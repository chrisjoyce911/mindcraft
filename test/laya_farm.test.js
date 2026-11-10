import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFarm, state, questions, targetOptions, cellName, parseCellName, carried, herds } from '../src/agent/laya/farm_state.js';
import { farmWithLaya, veto, needed, summary } from '../src/agent/laya/farm.js';
import { floods } from '../src/agent/laya/farm_actions.js';
import { setSettings } from '../src/agent/settings.js';
import { taskSettings } from '../src/models/laya.js';
import rootSettings from '../settings.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-farm-v1/request.json', import.meta.url), 'utf8'));

// The golden farm (laya-go games/farm/prompt sampleRows), ground at Y0.
const ROWS = ['GGGGGXGGL', 'G111211GL', 'G11W1F1GL', 'G121113GL', 'GGGGX33GL', 'XXXXXXXXX', 'GGGGGGGGL', 'OOOOOOOOO', 'LLLLLLLLL'];
const Y0 = 64;
const CROP_BLOCKS = { 1: ['wheat', 3], 2: ['wheat', 7], 3: ['carrots', 2], 4: ['carrots', 7], 5: ['potatoes', 1], 6: ['potatoes', 7], 7: ['beetroots', 1], 8: ['beetroots', 3] };

// worldFromRows builds blockAt for rows whose top-left cell is world (0, 0);
// outside them is grass with no water.
function worldFromRows(rows) {
    const block = (name, extra = {}) => ({ name, boundingBox: name === 'air' || name === 'water' || CROP_NAMES.has(name) ? 'empty' : 'block', ...extra });
    const CROP_NAMES = new Set(['wheat', 'carrots', 'potatoes', 'beetroots']);
    return (x, y, z) => {
        const code = rows[z]?.[x] ?? 'L';
        if (y > Y0 + 1) return block('air');
        if (y < Y0) return block('stone');
        if (y === Y0) {
            if (code === 'W') return block('water');
            if (code === 'X') return block('stone');
            if ('GLO'.includes(code)) return block('grass_block');
            return block('farmland');
        }
        if (code === 'O') return block('oak_fence');
        const crop = CROP_BLOCKS[code];
        if (crop) return block(crop[0], { getProperties: () => ({ age: crop[1] }) });
        return block('air');
    };
}

const items = [{ name: 'iron_hoe', count: 1 }, { name: 'stone', count: 64 }, { name: 'bone_meal', count: 3 }, { name: 'carrot', count: 5 }, { name: 'wheat_seeds', count: 12 }];
const animals = [
    { kind: 'cow', x: 2, z: 7 }, { kind: 'cow', x: 3, z: 8 }, { kind: 'cow', x: 3, z: 9, baby: true },
    { kind: 'pig', x: 6, z: 8 }, { kind: 'pig', x: 7, z: 8 }, { kind: 'pig', x: 8, z: 9 },
    { kind: 'sheep', x: 40, z: 40 }, { kind: 'zombie', x: 4, z: 6 },
];

test('golden v1 state and questions: match laya-go byte for byte', () => {
    const s = readFarm(worldFromRows(ROWS), 4, Y0 + 1, 4, items, animals);
    assert.equal(state(s), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(questions(s))), golden.questions);
    assert.equal(s.ys[4][4], Y0);
    assert.equal(s.ys[1][1], Y0, 'a crop cell is its farmland');
});

test('cell names, carry and herds', () => {
    assert.equal(cellName(2, 3), 'W2 N1');
    assert.equal(cellName(4, 4), 'E0 S0');
    assert.deepEqual(parseCellName('W2 N1'), { x: 2, z: 3 });
    assert.equal(parseCellName('E5 S0'), null);
    assert.deepEqual(carried([{ name: 'wooden_hoe', count: 1 }, { name: 'stone_hoe', count: 1 }, { name: 'wheat', count: 2 }]),
        [{ item: 'hoe', count: 2 }, { item: 'wheat', count: 2 }]);
    assert.deepEqual(herds(animals, 4, 4), [{ kind: 'cow', count: 2 }, { kind: 'pig', count: 3 }]);
});

const sample = () => readFarm(worldFromRows(ROWS), 4, Y0 + 1, 4, items, animals);

test('veto', () => {
    const s = sample();
    assert.equal(veto(s, 'harvest', 'W2 N1', 'none'), null);
    assert.equal(veto(s, 'harvest', 'W1 N1', 'none'), 'not-ripe');
    assert.equal(veto(s, 'plant', 'E1 N2', 'wheat_seeds'), null);
    assert.equal(veto(s, 'plant', 'E1 N2', 'hoe'), 'not-a-seed');
    assert.equal(veto(s, 'till', 'W1 S0', 'hoe'), null);
    assert.equal(veto(s, 'till', 'E0 S0', 'hoe'), 'not-tillable');
    assert.equal(veto(s, 'water', 'E1 N2', 'water_bucket'), 'not-dry-farmland');
    assert.equal(veto(s, 'bone_meal', 'W1 N1', 'bone_meal'), null);
    assert.equal(veto(s, 'breed', 'pig', 'carrot'), null);
    assert.equal(veto(s, 'breed', 'pig', 'wheat'), 'wrong-food');
    assert.equal(veto(s, 'breed', 'sheep', 'wheat'), 'no-pair');
    assert.equal(veto(s, 'harvest', 'nowhere', 'none'), 'no-cell');
    assert.ok(targetOptions(s).includes('W2 N1'));
});

test('needed items', () => {
    const s = sample();
    assert.equal(needed(s, 'till', 'none'), null);
    assert.equal(needed(s, 'water', 'none'), 'water_bucket');
    assert.equal(needed(s, 'plant', 'potato'), 'potato');
    assert.equal(needed(s, 'harvest', 'none'), null);
});

test('flooding check', () => {
    const solid = { boundingBox: 'block' }, open = { boundingBox: 'empty' };
    assert.equal(floods(() => solid, { x: 0, y: 64, z: 0 }), false);
    assert.equal(floods((x) => (x === 1 ? open : solid), { x: 0, y: 64, z: 0 }), true);
});

function reply(action, target, item, p = 0.9) {
    const ans = (top, q) => ({ type: 'choice', top, topProbability: p, confident: p >= 0.5, probabilities: { [top]: p } });
    return { model: 'fake', ms: 3, answers: { Action: ans(action), Target: ans(target), Item: ans(item) } };
}

function setup(answers, { situation = sample(), craftOk = true } = {}) {
    let t = 0, i = 0;
    const calls = { act: [], craft: [], asked: 0 };
    let s = situation;
    const deps = {
        client: { decide: async () => { calls.asked++; const a = answers[Math.min(i++, answers.length - 1)]; return typeof a === 'function' ? a() : a; } },
        task: { step_ms: 10, max_steps: answers.length, max_misses: 2 },
        read: () => s,
        act: async (action, target, item) => { calls.act.push([action, target, item]); return true; },
        craft: async (item, count) => {
            calls.craft.push([item, count]);
            if (craftOk) s = { ...s, carry: [...s.carry, { item, count }] };
            return craftOk;
        },
        now: () => t, sleep: async ms => { t += ms; }, log: () => {}, stepLog: null,
    };
    return { deps, calls, bot: {} };
}

test('loop: harvest, then plant, vetoes refused', async () => {
    const { deps, calls, bot } = setup([reply('harvest', 'W2 N1', 'none'), reply('plant', 'E1 N2', 'carrot'), reply('till', 'E0 S0', 'hoe'), reply('wait', 'none', 'none')]);
    const c = await farmWithLaya(bot, 60000, deps);
    assert.deepEqual(calls.act, [['harvest', 'W2 N1', 'none'], ['plant', 'E1 N2', 'carrot']]);
    assert.deepEqual(c.vetoes, { 'not-tillable': 1 });
    assert.deepEqual(calls.craft, []);
    assert.match(summary(c), /did harvest 1, plant 1/);
});

test('loop: crafts the starter kit and missing items, then carries on', async () => {
    const bare = { ...sample(), carry: [] };
    const { deps, calls, bot } = setup([reply('water', 'E1 N2', 'none'), reply('bone_meal', 'W1 N1', 'bone_meal')], { situation: bare });
    await farmWithLaya(bot, 60000, deps);
    assert.deepEqual(calls.craft.slice(0, 2), [['hoe', 1], ['wheat_seeds', 4]], 'starter kit');
    assert.deepEqual(calls.craft[2], ['water_bucket', 1], 'water needs a bucket');
    assert.deepEqual(calls.craft[3], ['bone_meal', 1]);
});

test('loop: low confidence waits, no answers stop', async () => {
    const { deps, calls, bot } = setup([reply('harvest', 'W2 N1', 'none', 0.3), null, null, null]);
    const c = await farmWithLaya(bot, 60000, deps);
    assert.deepEqual(calls.act, []);
    assert.equal(c.misses, 2);
    assert.equal(calls.asked, 3, 'stopped after max_misses');
});

test('loop: stops at the time limit and on interrupt', async () => {
    const { deps, calls, bot } = setup(Array(50).fill(reply('wait', 'none', 'none')));
    await farmWithLaya(bot, 100, deps);
    assert.ok(calls.asked <= 3, `asked ${calls.asked}`);
    const stopped = setup([reply('harvest', 'W2 N1', 'none')]);
    await farmWithLaya({ interrupt_code: true }, 60000, stopped.deps);
    assert.equal(stopped.calls.asked, 0);
});

test('farm task is off by default', () => {
    setSettings(rootSettings);
    assert.equal(rootSettings.decision_models.tasks.farm.enabled, false);
    assert.equal(taskSettings('farm'), null);
});

test('loop: no hoe to be had stops farming instead of waiting', async () => {
    const bare = { ...sample(), carry: [] };
    const { deps, calls, bot } = setup(Array(20).fill(reply('wait', 'none', 'none')), { situation: bare, craftOk: false });
    await farmWithLaya(bot, 60000, deps);
    assert.deepEqual(calls.craft, [['hoe', 1]]);
    assert.equal(calls.asked, 0);
});

// ---- v2: goals, no water, waits, unload, crop.
import { parseGoal, farmKeep, NO_WATER } from '../src/agent/laya/farm.js';
import { decide, stateV2, questionsV2, farmValuables, hasWater } from '../src/agent/laya/farm_state.js';
import { pack } from '../src/agent/laya/pack.js';
import { parseCommandMessage, commandArity } from '../src/agent/commands/index.js';

// The trial's savanna plateau (bots/andy/logs/laya-farm.jsonl): all dry.
const PLATEAU = ['XXLLLLLLL', 'XXLLLLLLL', 'XLLLLLLLL', 'LLLLLLLXL', 'LLLLLLLLL', 'LLLLLLLXL', 'LLLLLLLLL', 'LLLLLLLLL', 'LLLLLLLLL'];
const plateau = carry => ({ grid: PLATEAU.map(r => [...r]), ys: PLATEAU.map(() => Array(9).fill(Y0)), carry, animals: [] });

test('goal: crop and count, open-ended, old minutes', () => {
    assert.deepEqual(parseGoal(), { crop: 'any', count: null, minutes: null });
    assert.deepEqual(parseGoal('wheat'), { crop: 'wheat', count: null, minutes: null });
    assert.deepEqual(parseGoal('carrot', '12'), { crop: 'carrots', count: 12, minutes: null });
    assert.deepEqual(parseGoal('potatoes', 'any'), { crop: 'potatoes', count: null, minutes: null });
    assert.deepEqual(parseGoal('3'), { crop: 'any', count: null, minutes: 3 });
    assert.deepEqual(parseGoal(2.5), { crop: 'any', count: null, minutes: 2.5 });
    assert.ok(parseGoal('melons').error);
    assert.ok(parseGoal('wheat', 'lots').error);
    assert.ok(parseGoal('wheat', '0').error);
});

test('!layaFarm takes 0, 1 or 2 arguments', () => {
    assert.deepEqual(parseCommandMessage('!layaFarm').args, []);
    assert.deepEqual(parseCommandMessage('!layaFarm(3)').args, ['3']);
    assert.deepEqual(parseCommandMessage('!layaFarm("wheat", 10)').args, ['wheat', '10']);
    assert.deepEqual(parseCommandMessage('!layaFarm("wheat", "any")').args, ['wheat', 'any']);
    assert.match(parseCommandMessage('!layaFarm("wheat", 1, 2)'), /requires 0 to 2 args/);
    assert.deepEqual(commandArity('!layaFarm'), { min: 0, max: 2 });
    assert.match(parseCommandMessage('!goToPlayer("bob")'), /requires 2 args/, 'required params still required');
});

test('keep and valuables when unloading', () => {
    const keep = farmKeep(n => ['bread', 'carrot', 'potato', 'beetroot'].includes(n), 16);
    assert.equal(keep('iron_hoe', 1), 1);
    assert.equal(keep('water_bucket', 1), 1);
    assert.equal(keep('bucket', 1), 1);
    assert.equal(keep('bread', 5), 5);
    assert.equal(keep('wheat_seeds', 40), 16);
    assert.equal(keep('carrot', 40), 16, 'carrots are seeds: keep 16 though they are food');
    assert.equal(keep('wheat', 40), 0);
    assert.equal(keep('beetroot', 9), 0, 'produce goes even when it is food');
    assert.equal(keep('cobblestone', 9), 0);
    assert.equal(farmValuables({ wheat: 10, carrot: 20, wheat_seeds: 30, bread: 2 }, keep), 14);
});

test('v2 state: Crop and Pack after Farm., Unload asked', () => {
    const s = { ...sample(), crop: 'wheat', pack: pack({ free: 5, home: 12 }) };
    const lines = stateV2(s).split('\n');
    assert.deepEqual(lines.slice(0, 3), ['Farm.', 'Crop wheat', 'Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0']);
    assert.equal(lines.length, 14);
    const q = questionsV2(s);
    assert.deepEqual(q.Action.criteria, ['harvest', 'plant', 'till', 'water', 'pond', 'bone_meal', 'breed', 'find_water', 'wait']);
    assert.equal(q.Unload.type, 'noul');
});

test('rules: the golden farm harvests first; the plateau has no water', () => {
    assert.equal(decide(sample()).action, 'harvest');
    assert.equal(hasWater(plateau([]).grid), false);
});

function setupV2(answers, { situation, inv = {}, water = null, home = null, free = () => 20, task = {} } = {}) {
    const { deps, calls, bot } = setup(answers, { situation });
    const said = [];
    calls.walked = []; calls.deposited = []; calls.home = 0;
    const inventory = { ...inv };
    Object.assign(deps, {
        task: { ...deps.task, prompt: 'v2', wait_limit: 3, ...task },
        inventory: () => ({ ...inventory }),
        say: m => said.push(m),
        position: () => ({ x: 0, y: Y0 + 1, z: 0 }),
        goTo: async p => { calls.walked.push(p); return true; },
        findWater: async () => water,
        pack: {
            freeSlots: () => free(), hostiles: () => 0, health: () => 20, food: () => 20,
            home: () => home, goHome: async () => { calls.home++; return true; },
            deposit: async items => { calls.deposited.push(items); for (const i of items) inventory[i.name] -= i.count; return true; },
            isFood: n => n === 'bread',
        },
    });
    const act = deps.act;
    deps.act = async (action, target, item) => {
        if (action === 'harvest') inventory.wheat = (inventory.wheat || 0) + 6;
        return act(action, target, item);
    };
    return { deps, calls, bot, said };
}

test('trial plateau, no water near: says so and stops (never waits forever)', async () => {
    const { deps, calls, bot, said } = setupV2(Array(80).fill(reply('wait', 'none', 'none', 1)),
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]) });
    const c = await farmWithLaya(bot, { crop: 'any' }, deps);
    assert.equal(calls.asked, 1);
    assert.deepEqual(said, [NO_WATER]);
    assert.equal(c.reason, 'no water');
});

test('trial plateau with v1 too: stops instead of 73 waits', async () => {
    const { deps, calls, bot, said } = setupV2(Array(80).fill(reply('wait', 'none', 'none', 1)),
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]), task: { prompt: 'v1' } });
    await farmWithLaya(bot, 180000, deps);
    assert.equal(calls.asked, 1);
    assert.deepEqual(said, [NO_WATER]);
});

test('find_water: walks to water and carries on, once', async () => {
    const { deps, calls, bot, said } = setupV2([reply('find_water', 'none', 'none'), reply('find_water', 'none', 'none')],
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]), water: { x: 30, y: 63, z: 4 } });
    const c = await farmWithLaya(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.walked, [{ x: 30, y: 63, z: 4 }]);
    assert.equal(c.water_trips, 1);
    assert.deepEqual(said, [NO_WATER], 'still dry after walking there: stops');
});

test('plateau with a water bucket: a wait becomes a pond', async () => {
    const { deps, calls, bot } = setupV2([reply('wait', 'none', 'none')],
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'water_bucket', count: 1 }, { item: 'wheat_seeds', count: 3 }]), task: { max_steps_open: 1 } });
    await farmWithLaya(bot, { crop: 'any' }, deps);
    assert.equal(calls.act[0][0], 'pond');
    assert.equal(calls.act[0][2], 'water_bucket');
});

test('pond veto: only dry ground', () => {
    assert.equal(veto(sample(), 'pond', 'E4 N4', 'water_bucket'), null);
    assert.equal(veto(sample(), 'pond', 'W3 N3', 'water_bucket'), 'not-dry-ground');
});

test('wait limit: stops after waits with nothing growing, not while crops grow', async () => {
    const grass = ['GGGGWGGGG', ...Array(8).fill('GGGGGGGGG')];
    const s0 = { grid: grass.map(r => [...r]), ys: grass.map(() => Array(9).fill(Y0)), carry: [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }], animals: [] };
    const idle = setupV2(Array(50).fill(reply('wait', 'none', 'none')), { situation: s0 });
    const c = await farmWithLaya(idle.bot, { crop: 'any' }, idle.deps);
    assert.equal(idle.calls.asked, 3);
    assert.equal(c.reason, 'nothing to do');
    const busy = setupV2(Array(10).fill(reply('wait', 'none', 'none')), { task: { max_steps_open: 10 } });
    const c2 = await farmWithLaya(busy.bot, { crop: 'any' }, busy.deps);
    assert.equal(busy.calls.asked, 10, 'the golden farm has growing crops: keeps waiting');
    assert.equal(c2.reason, 'max steps');
});

test('count goal: stops once enough is harvested, across resumes', async () => {
    const progress = { harvested: 0 };
    const a = setupV2(Array(10).fill(reply('harvest', 'W2 N1', 'none')));
    const c = await farmWithLaya(a.bot, { crop: 'wheat', count: 10, progress }, a.deps);
    assert.equal(a.calls.act.length, 2);
    assert.equal(c.harvested, 12);
    assert.match(a.said.at(-1), /Harvested 12 wheat/);
    const b = setupV2(Array(10).fill(reply('harvest', 'W2 N1', 'none')));
    progress.harvested = 6;
    await farmWithLaya(b.bot, { crop: 'wheat', count: 10, progress }, b.deps);
    assert.equal(b.calls.act.length, 1, 'a resume counts what was harvested before');
});

test('unload: full pack goes home, keeps tools and seeds, walks back', async () => {
    let free = 0;
    const u = setupV2([reply('wait', 'none', 'none'), reply('harvest', 'W2 N1', 'none')], {
        home: { x: 10, y: Y0 + 1, z: 10 }, free: () => free,
        inv: { iron_hoe: 1, wheat: 60, wheat_seeds: 40, bread: 2, bucket: 1, dirt: 5 }, task: { max_steps_open: 2 },
    });
    u.deps.pack.goHome = async () => { u.calls.home++; free = 20; return true; };
    await farmWithLaya(u.bot, { crop: 'any' }, u.deps);
    assert.equal(u.calls.home, 1);
    assert.deepEqual(u.calls.deposited[0], [{ name: 'wheat', count: 60 }, { name: 'wheat_seeds', count: 24 }, { name: 'dirt', count: 5 }]);
    assert.deepEqual(u.calls.walked, [{ x: 0, y: Y0 + 1, z: 0 }], 'walked back to the farm');
    assert.deepEqual(u.calls.act, [['harvest', 'W2 N1', 'none']]);
});

test('unload: the model when sure; never without a home chest', async () => {
    const yes = r => ({ ...r, answers: { ...r.answers, Unload: { type: 'noul', probability: 0.9, confident: true } } });
    const m = setupV2([yes(reply('wait', 'none', 'none'))], { home: { x: 5, y: 65, z: 5 }, task: { max_steps_open: 1 } });
    await farmWithLaya(m.bot, { crop: 'any' }, m.deps);
    assert.equal(m.calls.home, 1);
    const n = setupV2([yes(reply('harvest', 'W2 N1', 'none'))], { free: () => 0, task: { max_steps_open: 1 } });
    await farmWithLaya(n.bot, { crop: 'any' }, n.deps);
    assert.equal(n.calls.home, 0);
    assert.match(n.said[0], /pack is full/);
});

test('a crop asked for: plants its seed', async () => {
    const s0 = { ...sample(), carry: [...sample().carry] };
    const { deps, calls, bot } = setupV2([reply('plant', 'E1 N2', 'wheat_seeds')], { situation: s0, task: { max_steps_open: 1 } });
    await farmWithLaya(bot, { crop: 'carrots' }, deps);
    assert.deepEqual(calls.act, [['plant', 'E1 N2', 'carrot']]);
});

test('v2 unsure: the rules decide', async () => {
    const { deps, calls, bot } = setupV2([reply('wait', 'none', 'none', 0.2)], { task: { max_steps_open: 1 } });
    const c = await farmWithLaya(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.act, [['harvest', 'W2 N1', 'none']]);
    assert.equal(c.rules, 1);
});

const goldenV2 = JSON.parse(readFileSync(new URL('./fixtures/laya-farm-v2/request.json', import.meta.url), 'utf8'));
const barrenV2 = JSON.parse(readFileSync(new URL('./fixtures/laya-farm-v2/barren_request.json', import.meta.url), 'utf8'));

test('golden v2 state and questions: match laya-go byte for byte', () => {
    const s = { ...sample(), crop: 'carrots', pack: pack({ free: 5, home: 12, health: 20, food: 18, hostiles: 0, valuables: 6 }) };
    assert.equal(stateV2(s), goldenV2.state);
    assert.deepEqual(JSON.parse(JSON.stringify(questionsV2(s))), goldenV2.questions);
    assert.equal(decide(s).rule, 'harvest');
});

test('golden v2 barren plateau (the trial): find_water, by the rules too', () => {
    const s = { ...plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]), crop: 'wheat', pack: pack({ free: 30 }) };
    assert.equal(stateV2(s), barrenV2.state);
    assert.deepEqual(JSON.parse(JSON.stringify(questionsV2(s))), barrenV2.questions);
    assert.deepEqual(decide(s), { action: 'find_water', target: 'none', item: 'none', rule: 'find_water' });
    const wet = { ...s, carry: [...s.carry, { item: 'water_bucket', count: 1 }] };
    assert.deepEqual(decide(wet), { action: 'pond', target: 'E0 N1', item: 'water_bucket', rule: 'pond' });
});

// parseFarmState reads a v1 or v2 state text back to a situation (as laya-go
// prompt.ParseState does).
function parseFarmState(text) {
    const L = text.split('\n'), s = { carry: [], animals: [] };
    let i = 1;
    if (L[1].startsWith('Crop ')) {
        const f = L[2].split(' ');
        s.crop = L[1].slice(5);
        s.pack = pack({ free: +f[1], home: f[3] === 'none' ? null : +f[3], health: +f[5], food: +f[7], hostiles: +f[9], valuables: +f[11] });
        i = 3;
    }
    const c = L[i].split(' ').slice(1), a = L[i + 1].split(' ').slice(1);
    if (c[0] !== 'none') for (let k = 0; k < c.length; k += 2) s.carry.push({ item: c[k], count: +c[k + 1].slice(1) });
    if (a[0] !== 'none') for (let k = 0; k < a.length; k += 2) s.animals.push({ kind: a[k], count: +a[k + 1] });
    s.grid = L.slice(i + 2).map(r => [...r]);
    return s;
}

test('rules port agrees with laya-go on 400 generated v1 and v2 situations', () => {
    const cases = readFileSync(new URL('./fixtures/laya-farm-v2/decisions.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(cases.length, 400);
    const seen = new Set();
    for (const d of cases) {
        const s = parseFarmState(d.state);
        assert.equal(s.crop ? stateV2(s) : state(s), d.state);
        assert.deepEqual(decide(s), { action: d.action, target: d.target, item: d.item, rule: d.rule }, d.state);
        assert.deepEqual(targetOptions(s), d.targets, d.state);
        assert.deepEqual(questions(s).Item.criteria, d.items);
        seen.add(d.rule);
    }
    for (const r of ['harvest', 'water', 'plant-crop', 'replant', 'plant', 'till', 'pond', 'find_water', 'breed', 'bone_meal', 'wait']) assert.ok(seen.has(r), r);
});

import { loadSample } from '../src/models/laya_check.js';

test('laya:check asks the farm sample of the task prompt', () => {
    assert.equal(loadSample('farm', 'v2').state, goldenV2.state);
    assert.ok(loadSample('farm', 'v2').questions.Unload);
    assert.equal(loadSample('farm', 'v1').state, golden.state);
    assert.equal(rootSettings.decision_models.tasks.farm.prompt, 'v2');
});
