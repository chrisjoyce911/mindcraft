// 5.1 the craft state (a port of test/laya_craft_state.test.js): laya-go's golden v2 request and 300 of its
// generated situations, a real inventory to a situation, the helpers, the item names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    craftState, craftQuestions, itemOptions, situation, generic, countOption, closure, relevant, keep, stack, others,
    layaItem, realName, type CraftItem, type CraftSituation,
} from '../src/models/craft/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/laya-craft-v2', f), 'utf8'));
const golden = fixture('request.json') as { state: string; questions: unknown };
interface GoSituation { Goal: CraftItem; Count: number; Have?: Record<string, number>; Chest?: Record<string, number>; TableNear: boolean; FurnaceNear: boolean; ChestNear: boolean; Hidden: number }
const cases = fixture('situations.json') as { situation: GoSituation; state: string; items: string[] }[];

const fromGo = (s: GoSituation): CraftSituation => ({ goal: s.Goal, count: s.Count, have: s.Have || {}, chest: s.Chest || {},
    tableNear: s.TableNear, furnaceNear: s.FurnaceNear, chestNear: s.ChestNear, hidden: s.Hidden });

test('golden v2 request: matches laya-go byte for byte', () => {
    const s: CraftSituation = { goal: 'iron_pickaxe', count: 1, have: { planks: 3, stick: 2, wooden_pickaxe: 1, dirt: 12 }, chest: { raw_iron: 5 },
        tableNear: true, furnaceNear: false, chestNear: false, hidden: 0 };
    assert.equal(craftState(s), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(craftQuestions(s))), golden.questions);
});

test('300 laya-go situations: same state and item options', () => {
    assert.equal(cases.length, 300);
    for (const [i, c] of cases.entries()) {
        const s = fromGo(c.situation);
        assert.equal(craftState(s), c.state, `situation ${i}`);
        assert.deepEqual(itemOptions(s), c.items, `situation ${i} items`);
    }
});

test('real inventory to a situation', () => {
    const items = [{ name: 'oak_log', count: 3 }, { name: 'birch_log', count: 2 }, { name: 'spruce_planks', count: 4 }, { name: 'dirt', count: 64 },
        { name: 'dirt', count: 10 }, { name: 'iron_sword', count: 1 }];
    const s = situation(items, 'wooden_pickaxe', 1, { table: true }, {});
    assert.deepEqual(s.have, { log: 5, planks: 4, dirt: 74, iron_sword: 1 });
    // two log stacks, one planks, two dirt, one sword: 6 slots, generic count says 5
    assert.equal(s.hidden, 1);
    assert.match(craftState(s), /\nOther dirt x74\n/);
    assert.match(craftState(s), /\nInventory 6\/36$/);
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
    assert.throws(() => craftState({ ...situation([], 'stick', 1, {}), goal: 'cake' as CraftItem }), /bad craft goal/);
});

test('layaItem: aliases, generic names, unknown items', () => {
    assert.equal(layaItem('iron_ore'), 'raw_iron');
    assert.equal(layaItem('deepslate_iron_ore'), 'raw_iron');
    assert.equal(layaItem('coal_ore'), 'coal');
    assert.equal(layaItem('diamond_ore'), 'diamond');
    assert.equal(layaItem('stone'), 'cobblestone');
    assert.equal(layaItem('seeds'), 'wheat_seeds');
    assert.equal(layaItem('wood'), 'log');
    assert.equal(layaItem('logs'), 'log');
    assert.equal(layaItem('birch_log'), 'log');
    assert.equal(layaItem('spruce_planks'), 'planks');
    assert.equal(layaItem('wooden_pickaxe'), 'wooden_pickaxe');
    assert.equal(layaItem('cake'), null);
    assert.equal(layaItem('constructor'), null);
});

test('realName: the most carried, planks after the most carried log, else oak', () => {
    const planksFor = (log: string) => (log === 'birch_log' ? 'birch_planks' : log === 'crimson_stem' ? 'crimson_planks' : null);
    assert.equal(realName([{ name: 'oak_log', count: 1 }, { name: 'birch_log', count: 5 }], 'log', planksFor), 'birch_log');
    assert.equal(realName([{ name: 'oak_log', count: 1 }, { name: 'birch_log', count: 5 }], 'planks', planksFor), 'birch_planks');
    assert.equal(realName([{ name: 'crimson_stem', count: 2 }], 'planks', planksFor), 'crimson_planks');
    assert.equal(realName([{ name: 'spruce_planks', count: 2 }], 'planks', planksFor), 'spruce_planks');
    assert.equal(realName([], 'planks', planksFor), 'oak_planks');
    assert.equal(realName([], 'stick', planksFor), 'stick');
});
