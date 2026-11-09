import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { situation, state, questions, carried, FOODS } from '../src/agent/laya/eat_state.js';
import { LayaEater, safety, summary } from '../src/agent/laya/eat.js';
import { setSettings } from '../src/agent/settings.js';
import { taskSettings } from '../src/models/laya.js';
import rootSettings from '../settings.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-eat-v1/request.json', import.meta.url), 'utf8'));

function fakeBot({ health = 14, food = 12, saturation = 0, items = [] } = {}) {
    return { health, food, foodSaturation: saturation, inventory: { items: () => items } };
}
const item = (name, count) => ({ name, count });

test('golden state and questions', () => {
    const bot = fakeBot({ items: [item('apple', 2), item('golden_apple', 1), item('apple', 1), item('rotten_flesh', 2), item('stone', 64)] });
    const s = situation(bot, false);
    assert.equal(state(s), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(questions(s))), golden.questions);
});

test('true saturation and health rounding', () => {
    const s = situation(fakeBot({ health: 0.5, food: 3, saturation: 1.26, items: [item('cooked_beef', 5)] }), true);
    assert.equal(state(s), 'Eat.\nHealth 1 Food 3 Saturation 1.3 Danger yes\ncooked_beef x5 8 12.8');
    assert.equal(FOODS.golden_carrot.saturation, 14.4);
    assert.equal(FOODS.apple.saturation, 2.4);
    assert.equal(Object.keys(FOODS).length, 40);
});

test('at most six kinds, by priority, in inventory order', () => {
    const names = ['cookie', 'rotten_flesh', 'bread', 'golden_apple', 'melon_slice', 'cooked_beef', 'spider_eye', 'apple'];
    const c = carried(names.map(n => item(n, 1))).map(x => x.food);
    assert.deepEqual(c, ['cookie', 'bread', 'golden_apple', 'melon_slice', 'cooked_beef', 'apple']); // the two bad foods are dropped
});

test('safety rules', () => {
    const s = (over) => ({ health: 15, food: 10, saturation: 0, danger: false, carry: [{ food: 'bread', count: 1 }, { food: 'golden_apple', count: 1 }, { food: 'rotten_flesh', count: 1 }], ...over });
    assert.equal(safety(s(), 'bread'), null);
    assert.equal(safety(s(), 'golden_apple'), 'rare');
    assert.equal(safety(s({ health: 5, danger: true }), 'golden_apple'), null);
    assert.equal(safety(s({ danger: true }), 'bread'), 'danger');
    assert.equal(safety(s({ food: 20 }), 'bread'), 'full');
    assert.equal(safety(s(), 'rotten_flesh'), 'bad');
    assert.equal(safety(s({ food: 3 }), 'rotten_flesh'), null);
    assert.equal(safety(s(), 'cooked_beef'), 'not-carried');
});

function reply(eatP, food, p = 0.9) {
    return { model: 'fake', ms: 2, answers: {
        Eat: { type: 'noul', probability: eatP, top: eatP > 0.5 ? 'true' : 'false', topProbability: Math.max(eatP, 1 - eatP), confident: Math.max(eatP, 1 - eatP) >= 0.5 },
        Food: { type: 'choice', top: food, topProbability: p, confident: p >= 0.5, probabilities: { [food]: p } },
    } };
}

function setup(answer, { bot = fakeBot({ items: [item('bread', 4), item('golden_apple', 1)] }), danger = false, stepLog = null } = {}) {
    let t = 0;
    const calls = { eaten: [], auto: [] };
    const eater = new LayaEater(bot, {
        client: { decide: async () => answer },
        task: { check_ms: 2000, fallback_ms: 10000, log_steps: !!stepLog },
        danger: () => danger,
        eat: async food => { calls.eaten.push(food); return true; },
        autoEat: { enable: () => calls.auto.push('on'), disable: () => calls.auto.push('off') },
        now: () => t,
        stepLog,
    });
    return { eater, calls, advance: ms => { t += ms; } };
}

test('eats the chosen food', async () => {
    const { eater, calls } = setup(reply(0.9, 'bread'));
    assert.equal(await eater.tick(), 'ate');
    assert.deepEqual(calls.eaten, ['bread']);
    assert.equal(eater.counters.ate.bread, 1);
    assert.deepEqual(calls.auto, ['off']);
});

test("doesn't eat", async () => {
    const { eater, calls } = setup(reply(0.1, 'none'));
    assert.equal(await eater.tick(), 'no-eat');
    assert.deepEqual(calls.eaten, []);
    assert.equal(Object.values(eater.counters.fallbacks).reduce((a, b) => a + b), 0);
});

test('golden apple saved', async () => {
    const { eater, calls } = setup(reply(0.9, 'golden_apple'), { bot: fakeBot({ health: 15, items: [item('golden_apple', 1)] }) });
    assert.equal(await eater.tick(), 'veto');
    assert.deepEqual(calls.eaten, []);
    assert.equal(eater.counters.vetoes.rare, 1);
    assert.equal(eater.counters.fallbacks.veto, 1);
    assert.deepEqual(calls.auto, ['off', 'on']);
});

test('emergency golden apple in danger', async () => {
    const { eater, calls } = setup(reply(0.95, 'golden_apple'), { bot: fakeBot({ health: 5, items: [item('golden_apple', 1)] }), danger: true });
    assert.equal(await eater.tick(), 'ate');
    assert.deepEqual(calls.eaten, ['golden_apple']);
});

test('server down falls back to auto-eat, then hands back', async () => {
    const { eater, calls, advance } = setup(null);
    assert.equal(await eater.tick(), 'fallback');
    assert.equal(eater.counters.fallbacks['no-answer'], 1);
    assert.deepEqual(calls.auto, ['off', 'on']);
    advance(5000);
    assert.equal(await eater.tick(), 'wait');
    advance(6000);
    await eater.tick();
    assert.deepEqual(calls.auto.slice(0, 3), ['off', 'on', 'off']);
});

test('low confidence and disagreement fall back', async () => {
    let { eater } = setup(reply(0.9, 'bread', 0.3));
    assert.equal(await eater.tick(), 'fallback');
    assert.equal(eater.counters.fallbacks['low-confidence'], 1);
    ({ eater } = setup(reply(0.9, 'none')));
    assert.equal(await eater.tick(), 'fallback');
    assert.equal(eater.counters.fallbacks.disagree, 1);
});

test('checks no more often than check_ms', async () => {
    const { eater, advance } = setup(reply(0.1, 'none'));
    assert.equal(await eater.tick(), 'no-eat');
    advance(1000);
    assert.equal(await eater.tick(), 'wait');
    advance(1000);
    assert.equal(await eater.tick(), 'no-eat');
    assert.equal(eater.counters.asked, 2);
});

test('decisions are logged', async () => {
    const stepLog = join(mkdtempSync(join(tmpdir(), 'laya-')), 'bots', 'b', 'logs', 'laya-eat.jsonl');
    const { eater } = setup(reply(0.9, 'bread'), { stepLog });
    await eater.tick();
    const line = JSON.parse(readFileSync(stepLog, 'utf8').trim());
    assert.equal(line.outcome, 'ate');
    assert.equal(line.food, 'bread');
    assert.match(line.state, /^Eat\.\nHealth 14 Food 12/);
});

test('off by default, and summary', () => {
    setSettings(rootSettings);
    assert.equal(taskSettings('eat'), null);
    assert.equal(rootSettings.decision_models.tasks.eat.enabled, false);
    assert.equal(summary({ asked: 4, ate: { bread: 2 }, fallbacks: { veto: 1, 'no-answer': 0 }, vetoes: { rare: 1 } }),
        'Laya eat: asked 4, ate bread 2; fallbacks: veto 1; vetoes: rare 1');
});
