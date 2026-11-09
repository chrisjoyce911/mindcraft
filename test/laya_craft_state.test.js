import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { state, questions, itemOptions, situation, generic, countOption, closure, relevant, keep, stack, others } from '../src/agent/laya/craft_state.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-craft-v2/request.json', import.meta.url), 'utf8'));
const cases = JSON.parse(readFileSync(new URL('./fixtures/laya-craft-v2/situations.json', import.meta.url), 'utf8'));

const fromGo = s => ({ goal: s.Goal, count: s.Count, have: s.Have || {}, chest: s.Chest || {}, tableNear: s.TableNear, furnaceNear: s.FurnaceNear, chestNear: s.ChestNear, hidden: s.Hidden });

test('golden v2 request: matches laya-go byte for byte', () => {
    const s = { goal: 'iron_pickaxe', count: 1, have: { planks: 3, stick: 2, wooden_pickaxe: 1, dirt: 12 }, chest: { raw_iron: 5 }, tableNear: true, furnaceNear: false, chestNear: false, hidden: 0 };
    assert.equal(state(s), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(questions(s))), golden.questions);
});

test('300 laya-go situations: same state and item options', () => {
    for (const [i, c] of cases.entries()) {
        const s = fromGo(c.situation);
        assert.equal(state(s), c.state, `situation ${i}`);
        assert.deepEqual(itemOptions(s), c.items, `situation ${i} items`);
    }
});

test('real inventory to a situation', () => {
    const items = [{ name: 'oak_log', count: 3 }, { name: 'birch_log', count: 2 }, { name: 'spruce_planks', count: 4 }, { name: 'dirt', count: 64 }, { name: 'dirt', count: 10 }, { name: 'iron_sword', count: 1 }];
    const s = situation(items, 'wooden_pickaxe', 1, { table: true }, {});
    assert.deepEqual(s.have, { log: 5, planks: 4, dirt: 74, iron_sword: 1 });
    // two log stacks, one planks, two dirt, one sword: 6 slots, generic count says 5
    assert.equal(s.hidden, 1);
    assert.match(state(s), /\nOther dirt x74\n/);
    assert.match(state(s), /\nInventory 6\/36$/);
});

test('helpers', () => {
    assert.equal(generic('crimson_stem'), 'log');
    assert.equal(generic('dark_oak_planks'), 'planks');
    assert.equal(countOption(5), '6');
    assert.equal(countOption(500), '64');
    assert.ok(closure('bread').includes('wheat'));
    assert.ok(relevant('stick').includes('chest'));
    assert.ok(keep('iron_sword') && keep('bread') && !keep('rotten_flesh') && !keep('dirt'));
    assert.equal(stack('egg'), 16);
    assert.deepEqual(others({ goal: 'stick', have: { dirt: 3, gravel: 70, bread: 64 } }), ['gravel', 'dirt']);
});
