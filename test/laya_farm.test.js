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
