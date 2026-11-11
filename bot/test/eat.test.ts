// The eat model (3.2): golden request byte for byte, laya-go's rules on 1000 situations, and the pure
// parts of the old bot's test/laya_eat.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    carried, decide, decideEat, eatQuestions, eatState, FOODS, isFood, RULES, safety,
    type EatSituation, type FoodStack,
} from '../src/models/eat/index.js';
import type { DecideResult, ModelDecider } from '../src/types/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (rel: string): string => fs.readFileSync(path.join(REPO, 'test/fixtures', rel), 'utf8');
const item = (name: string, count: number): { name: string; count: number } => ({ name, count });

test('golden: the eat request matches laya-go v1_sample_request.json byte for byte', () => {
    const golden = JSON.parse(fixture('laya-eat-v1/request.json'));
    const sit: EatSituation = { health: 14, food: 12, saturation: 0, danger: false,
        carry: carried([item('apple', 2), item('golden_apple', 1), item('apple', 1), item('rotten_flesh', 2), item('stone', 64)]) };
    assert.equal(eatState(sit), golden.state);
    assert.equal(JSON.stringify({ questions: eatQuestions(sit), state: eatState(sit) }), JSON.stringify(golden));
});

test('true saturation', () => {
    const sit: EatSituation = { health: 1, food: 3, saturation: 1.3, danger: true, carry: carried([item('cooked_beef', 5)]) };
    assert.equal(eatState(sit), 'Eat.\nHealth 1 Food 3 Saturation 1.3 Danger yes\ncooked_beef x5 8 12.8');
    assert.equal(FOODS.golden_carrot.saturation, 14.4);
    assert.equal(FOODS.apple.saturation, 2.4);
    assert.equal(Object.keys(FOODS).length, 40);
});

test('at most six kinds, by priority, in inventory order', () => {
    const names = ['cookie', 'rotten_flesh', 'bread', 'golden_apple', 'melon_slice', 'cooked_beef', 'spider_eye', 'apple'];
    assert.deepEqual(carried(names.map(n => item(n, 1))).map(x => x.food), ['cookie', 'bread', 'golden_apple', 'melon_slice', 'cooked_beef', 'apple']);
});

const base = (over: Partial<EatSituation> = {}): EatSituation => ({ health: 15, food: 10, saturation: 0, danger: false,
    carry: [{ food: 'bread', count: 1 }, { food: 'golden_apple', count: 1 }, { food: 'rotten_flesh', count: 1 }], ...over });

test('safety rules', () => {
    assert.equal(safety(base(), 'bread'), null);
    assert.equal(safety(base(), 'golden_apple'), 'rare');
    assert.equal(safety(base({ health: 5, danger: true }), 'golden_apple'), null);
    assert.equal(safety(base({ danger: true }), 'bread'), 'danger');
    assert.equal(safety(base({ food: 20 }), 'bread'), 'full');
    assert.equal(safety(base(), 'rotten_flesh'), 'bad');
    assert.equal(safety(base({ food: 3 }), 'rotten_flesh'), null);
    assert.equal(safety(base(), 'cooked_beef'), 'not-carried');
});

function reply(eatP: number, food: string, p = 0.9): DecideResult {
    const top = eatP > 0.5 ? 'true' : 'false', tp = Math.max(eatP, 1 - eatP);
    return { model: 'eat-a', ms: 2, answers: {
        Eat: { type: 'noul', probability: eatP, top, topProbability: tp, confident: tp >= 0.5 },
        Food: { type: 'choice', top: food, topProbability: p, confident: p >= 0.5, probabilities: { [food]: p } },
    } };
}
const fake = (r: DecideResult | null): ModelDecider => ({ decide: async () => r });
const breadApple = (over: Partial<EatSituation> = {}): EatSituation => ({ health: 14, food: 12, saturation: 0, danger: false,
    carry: [{ food: 'bread', count: 4 }, { food: 'golden_apple', count: 1 }], ...over });

test('eats the chosen food', async () => {
    const d = await decideEat(breadApple(), fake(reply(0.9, 'bread')));
    assert.deepEqual([d.eat, d.food, d.answer, d.source, d.rule], [true, 'bread', 'bread', 'model', 'fits']);
    assert.deepEqual(d.asked, { eatP: 0.9, food: 'bread', p: 0.9, ms: 2, model: 'eat-a' });
});

test("doesn't eat", async () => {
    const d = await decideEat(breadApple(), fake(reply(0.1, 'none')));
    assert.deepEqual([d.eat, d.food, d.answer, d.source, d.why], [false, null, 'none', 'model', undefined]);
});

test('golden apple saved: vetoed, the rules decide', async () => {
    const d = await decideEat(breadApple({ health: 15, carry: [{ food: 'golden_apple', count: 1 }] }), fake(reply(0.9, 'golden_apple')));
    assert.deepEqual([d.eat, d.source, d.why, d.veto, d.rule, d.model], [false, 'rules', 'veto', 'rare', 'no-good-food', 'golden_apple']);
});

test('emergency golden apple in danger', async () => {
    const d = await decideEat(breadApple({ health: 5, danger: true, carry: [{ food: 'golden_apple', count: 1 }] }), fake(reply(0.95, 'golden_apple')));
    assert.deepEqual([d.eat, d.food, d.source], [true, 'golden_apple', 'model']);
});

test('no answer, low confidence and disagreement fall back to the rules (not auto-eat)', async () => {
    let d = await decideEat(breadApple(), fake(null));
    assert.deepEqual([d.source, d.why, d.eat, d.food, d.rule], ['rules', 'no-answer', true, 'bread', 'fits']);
    d = await decideEat(breadApple(), fake(reply(0.9, 'bread', 0.3)));
    assert.deepEqual([d.source, d.why], ['rules', 'low-confidence']);
    d = await decideEat(breadApple(), fake(reply(0.9, 'none')));
    assert.deepEqual([d.source, d.why], ['rules', 'disagree']);
    d = await decideEat(breadApple(), fake(reply(0.9, 'cake')));
    assert.deepEqual([d.source, d.why], ['rules', 'malformed']);
    d = await decideEat(breadApple(), null);
    assert.deepEqual([d.source, d.why, d.asked], ['rules', undefined, undefined]);
});

test('rules: laya-go rules_test cases', () => {
    const st = (food: string, count = 1): FoodStack => ({ food: food as FoodStack['food'], count });
    const sit = (health: number, food: number, saturation: number, danger: boolean, ...carry: FoodStack[]): EatSituation => ({ health, food, saturation, danger, carry });
    assert.deepEqual(decide(sit(20, 10, 0, false)), { eat: false, food: null, rule: 'no-food' });
    assert.deepEqual(decide(sit(4, 20, 5, true, st('bread'), st('enchanted_golden_apple'))), { eat: true, food: 'enchanted_golden_apple', rule: 'emergency' });
    assert.deepEqual(decide(sit(5, 10, 5, false, st('enchanted_golden_apple'))), { eat: false, food: null, rule: 'no-good-food' }, 'enchanted only at 4');
    assert.deepEqual(decide(sit(15, 10, 0, true, st('bread'))), { eat: false, food: null, rule: 'danger' });
    assert.deepEqual(decide(sit(15, 20, 0, false, st('bread'))), { eat: false, food: null, rule: 'full' });
    assert.deepEqual(decide(sit(20, 18, 3, false, st('bread'))), { eat: false, food: null, rule: 'no-need' });
    assert.deepEqual(decide(sit(15, 12, 3, false, st('bread'), st('cooked_beef'), st('apple'))), { eat: true, food: 'cooked_beef', rule: 'fits' });
    assert.deepEqual(decide(sit(15, 17, 3, false, st('cooked_beef'), st('rabbit_stew'))), { eat: true, food: 'cooked_beef', rule: 'least-waste' });
    assert.deepEqual(decide(sit(15, 5, 3, false, st('pufferfish'), st('rotten_flesh'))), { eat: true, food: 'rotten_flesh', rule: 'bad' });
});

interface EatRow { state: string; questions: unknown; eat: boolean; food: string; rule: string }

// parseEat reads an eat state back to a situation (laya-go prompt.ParseState).
function parseEat(text: string): EatSituation {
    const [, status = '', ...foods] = text.split('\n');
    const m = /^Health (\d+) Food (\d+) Saturation ([\d.]+) Danger (yes|no)$/.exec(status);
    assert.ok(m, status);
    return {
        health: Number(m[1]), food: Number(m[2]), saturation: Number(m[3]), danger: m[4] === 'yes',
        carry: foods.map(l => {
            const [name = '', count = ''] = l.split(' ');
            assert.ok(isFood(name), name);
            return { food: name, count: Number(count.slice(1)) };
        }),
    };
}

test('renderer, questions and rules agree with laya-go on 1000 generated situations (3a8fe4c, seed 7)', () => {
    const rows = fixture('laya-eat-v1/decisions.jsonl').trim().split('\n').map(l => JSON.parse(l) as EatRow);
    assert.equal(rows.length, 1000);
    const seen = new Set<string>();
    for (const r of rows) {
        const sit = parseEat(r.state);
        assert.equal(eatState(sit), r.state, 'state round trip');
        assert.equal(JSON.stringify(eatQuestions(sit)), JSON.stringify(r.questions), r.state);
        const d = decide(sit);
        assert.deepEqual({ eat: d.eat, food: d.food ?? 'none', rule: d.rule }, { eat: r.eat, food: r.food, rule: r.rule }, r.state);
        seen.add(r.rule);
    }
    assert.deepEqual([...seen].sort(), [...RULES].sort(), 'every rule is exercised');
});
