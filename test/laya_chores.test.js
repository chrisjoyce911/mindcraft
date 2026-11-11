import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { choresState, decideChore, nextChore, QUESTIONS, CHORES, RULES, timeWord, biomeWord, bestTiers, kitIn, unreserved,
    haveCounts, recentFailed, possible } from '../src/agent/laya/chores_state.js';

// parseChores reads a chores state back to a situation (choresState's input).
function parseChores(text) {
    const L = text.split('\n').map(l => l.split(' '));
    const n = Number, y = v => v === 'yes';
    const nr = v => (v === 'none' ? null : n(v));
    return {
        home: L[1][1], time: L[1][3], biome: L[1][5],
        table: y(L[2][2]), furnace: y(L[2][4]), chest: y(L[2][6]), lit: y(L[2][8]),
        bedMine: y(L[3][2]), bedPlayer: y(L[3][4]),
        axe: L[4][2], pickaxe: L[4][4], sword: L[4][6], hoe: L[4][8], shovel: L[4][10],
        wood: n(L[5][2]), sticks: n(L[5][4]), cobble: n(L[5][6]), coal: n(L[5][8]), torches: n(L[5][10]),
        food: n(L[6][1]), raw: n(L[6][3]), wool: n(L[6][5]), seeds: n(L[6][7]), saplings: n(L[6][9]),
        pack: n(L[7][1]), farm: y(L[8][1]), ready: y(L[8][3]),
        kitPickaxe: L[9][2], kitAxe: L[9][4], kitShovel: L[9][6], kitSword: L[9][8], kitFood: n(L[9][10]), kitTorches: n(L[9][12]),
        near: { trees: nr(L[10][2]), stone: nr(L[10][4]), coal: nr(L[10][6]), sand: nr(L[10][8]), water: nr(L[10][10]), grass: nr(L[10][12]) },
        animals: { cow: n(L[11][2]), pig: n(L[11][4]), sheep: n(L[11][6]), chicken: n(L[11][8]), rabbit: n(L[11][10]) },
        ground: n(L[12][2]), canPlace: y(L[13][2]), canSmelt: y(L[13][4]),
        failed: L[14][1] === 'none' ? [] : L[14].slice(1),
    };
}

const sample = {
    home: 'chest', time: 'day', biome: 'forest', table: false, furnace: false, chest: true, lit: false, bedMine: false, bedPlayer: false,
    axe: 'stone', pickaxe: 'wooden', sword: 'none', hoe: 'none', shovel: 'none',
    wood: 3, sticks: 2, cobble: 12, coal: 0, torches: 0, food: 4, raw: 2, wool: 0, seeds: 0, saplings: 1, pack: 20, farm: true, ready: false,
    kitPickaxe: 'none', kitAxe: 'none', kitShovel: 'none', kitSword: 'none', kitFood: 0, kitTorches: 0,
    near: { trees: 49, stone: 49, coal: 97, sand: null, water: 49, grass: 49 }, animals: { cow: 2, pig: 0, sheep: 1, chicken: 0, rabbit: 0 },
    ground: 2, canPlace: false, canSmelt: false, failed: [],
};

test('golden: the chores request matches laya-go v1_sample_request.json byte for byte', () => {
    const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-chores-v1/request.json', import.meta.url), 'utf8'));
    const text = choresState(sample);
    assert.equal(text, golden.state);
    assert.equal(JSON.stringify({ questions: QUESTIONS, state: text }), JSON.stringify(golden));
    assert.deepEqual(decideChore(sample), { chore: 'hunt_food', rule: 'food-low-hunt' }, 'the spec says the sample is hunt_food');
});

test('rules and state agree with laya-go chores v1 on 1000 generated situations (f05b409)', () => {
    const rows = readFileSync(new URL('./fixtures/laya-chores-v1/decisions.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 1000);
    const seen = new Set();
    for (const r of rows) {
        const s = parseChores(r.state);
        assert.equal(choresState(s), r.state, 'state round trip');
        assert.deepEqual(decideChore(s), { chore: r.answer, rule: r.rule }, r.state);
        seen.add(r.rule);
    }
    assert.equal(seen.size, RULES.length, 'every rule is exercised');
});

test('masked and failed chores fall through; a model answer the bot cannot start is impossible', async () => {
    const s = { ...sample, time: 'day', food: 20, raw: 0, table: false, wood: 9, axe: 'none', pickaxe: 'none', ground: 0, saplings: 0 };
    assert.equal(decideChore(s).chore, 'craft_wood_tools', 'place_table masked (Can place no)');
    assert.equal(decideChore({ ...s, canPlace: true }).chore, 'place_table');
    assert.equal(decideChore({ ...s, canPlace: true, failed: ['place_table'] }).chore, 'craft_wood_tools');
    assert.ok(!possible(s, 'cook_food'));
    const client = { decide: async () => ({ answers: { Chore: { top: 'place_table', topProbability: 0.9, confident: true } } }) };
    const d = await nextChore(s, { client, task: {} });
    assert.deepEqual([d.chore, d.source, d.impossible], ['place_table', 'model', true]);
    const r = await nextChore(s);
    assert.equal(r.source, 'rules');
});

test('sensor helpers', () => {
    assert.equal(timeWord(6000), 'day');
    assert.equal(timeWord(10142), 'dusk');
    assert.equal(timeWord(12541), 'dusk');
    assert.equal(timeWord(12542), 'night');
    assert.equal(timeWord(23459), 'night');
    assert.equal(timeWord(23460), 'day');
    assert.equal(timeWord(24000 + 13000), 'night');
    assert.equal(biomeWord('snowy_taiga'), 'snowy');
    assert.equal(biomeWord('dark_forest'), 'forest');
    assert.equal(biomeWord('sunflower_plains'), 'plains');
    assert.equal(biomeWord('badlands'), 'desert');
    assert.equal(biomeWord('river'), 'beach');
    assert.equal(biomeWord('swamp'), 'other');
    assert.deepEqual(bestTiers(['wooden_pickaxe', 'stone_pickaxe', 'golden_axe', 'netherite_sword', 'dirt']),
        { axe: 'wooden', pickaxe: 'stone', sword: 'diamond', hoe: 'none', shovel: 'none' });
    const isFood = n => ['cooked_beef', 'beef', 'bread', 'rotten_flesh'].includes(n);
    const chest = [{ name: 'stone_pickaxe', count: 1 }, { name: 'wooden_pickaxe', count: 1 }, { name: 'stone_axe', count: 1 },
        { name: 'cooked_beef', count: 10 }, { name: 'beef', count: 3 }, { name: 'torch', count: 20 }, { name: 'oak_planks', count: 20 }];
    const kit = kitIn(chest, isFood);
    assert.deepEqual([kit.pickaxe, kit.axe, kit.shovel, kit.sword, kit.food, kit.torches], ['stone', 'stone', 'none', 'none', 10, 20]);
    assert.deepEqual(kit.reserved, { stone_pickaxe: 1, stone_axe: 1, cooked_beef: 8, torch: 16 });
    const rest = unreserved(chest, kit.reserved);
    assert.deepEqual(rest, [{ name: 'wooden_pickaxe', count: 1 }, { name: 'cooked_beef', count: 2 }, { name: 'beef', count: 3 },
        { name: 'torch', count: 4 }, { name: 'oak_planks', count: 20 }]);
    const have = haveCounts([...rest, { name: 'oak_log', count: 2 }, { name: 'rotten_flesh', count: 4 }, { name: 'white_wool', count: 3 },
        { name: 'oak_sapling', count: 2 }, { name: 'wheat_seeds', count: 5 }, { name: 'charcoal', count: 1 }, { name: 'coal', count: 2 }], isFood);
    assert.deepEqual(have, { wood: 7, sticks: 0, cobble: 0, coal: 3, torches: 4, food: 5, raw: 3, wool: 3, seeds: 5, saplings: 2 });
    assert.deepEqual(recentFailed([{ chore: 'a', at: 1 }, { chore: 'b', at: 5 }, { chore: 'a', at: 6 }, { chore: 'c', at: 7 }, { chore: 'd', at: 8 }], 10),
        ['d', 'c', 'a']);
    assert.deepEqual(recentFailed([{ chore: 'a', at: 0 }], 5 * 60_000 + 1), []);
    assert.equal(CHORES.length, 25);
});
