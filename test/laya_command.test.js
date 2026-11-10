import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { normalize, state, QUESTIONS, resolve, COMMANDS, ITEMS, TIERS, COUNTS } from '../src/agent/laya/command_state.js';

const fixture = name => JSON.parse(readFileSync(new URL(`./fixtures/laya-command-v1/${name}`, import.meta.url), 'utf8'));
const golden = fixture('request.json');
const cases = fixture('resolve_cases.json');

test('golden v1 request: matches laya-go byte for byte', () => {
    assert.equal(state('andy', 'chrisjoyce911', 'Andy, can you craft me 2 iron picks please?'), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS)), golden.questions);
});

test('option lists match laya-go', () => {
    assert.deepEqual(COMMANDS, cases.commands);
    assert.deepEqual(ITEMS, cases.items);
    assert.deepEqual(TIERS, cases.tiers);
    assert.deepEqual(COUNTS, cases.counts);
});

test('normalize matches laya-go', () => {
    for (const [input, want] of Object.entries(cases.normalize)) assert.equal(normalize(input), want, JSON.stringify(input));
});

test('resolve matches laya-go on 400 cases', () => {
    for (const c of cases.resolve) {
        const carry = (c.carry || []).map(s => ({ item: s.Item, count: s.Count }));
        assert.equal(resolve(c.command, c.item, c.tier, carry), c.want, JSON.stringify(c));
    }
});

test('state refuses names with spaces', () => {
    assert.equal(state('an dy', 'steve', 'hi'), null);
    assert.equal(state('andy', '', 'hi'), null);
});

import { plan, handleCommand, CANNED } from '../src/agent/laya/command.js';

// answer builds a decide() result like laya-client's normal form.
function answer({ addressed = 0.95, command = 'chat', p = 0.9, item = 'none', tier = 'none', count = 'any' } = {}) {
    return { ms: 12, answers: {
        Addressed: { type: 'noul', probability: addressed },
        Command: { type: 'choice', top: command, topProbability: p },
        Item: { type: 'choice', top: item, topProbability: 0.9 },
        Tier: { type: 'choice', top: tier, topProbability: 0.9 },
        Count: { type: 'choice', top: count, topProbability: 0.9 },
    } };
}

const carry = [{ item: 'oak_log', count: 5 }, { item: 'birch_log', count: 12 }, { item: 'bread', count: 3 }, { item: 'iron_ingot', count: 4 },
    { item: 'stone_pickaxe', count: 1 }, { item: 'cobblestone', count: 30 }, { item: 'rotten_flesh', count: 2 }];
const ctx = (extra = {}) => ({ speaker: 'chrisjoyce911', carry, has: n => ['!layaCraft', '!layaGather'].includes(n), nearestHostile: () => 'zombie', ...extra });

test('plan: who it is for, chat and confidence', () => {
    assert.deepEqual(plan(null, ctx()), { kind: 'llm', reason: 'no-answer' });
    assert.deepEqual(plan(answer({ addressed: 0.05, command: 'follow' }), ctx()), { kind: 'ignore' });
    assert.equal(plan(answer({ addressed: 0.3, command: 'follow' }), ctx()).reason, 'not-sure-addressed');
    assert.equal(plan(answer({ command: 'chat' }), ctx()).reason, 'chat');
    assert.equal(plan(answer({ command: 'follow', p: 0.4 }), ctx()).reason, 'low-confidence');
});

test('plan: movement commands', () => {
    assert.deepEqual(plan(answer({ command: 'follow' }), ctx()).lines, ['!followPlayer("chrisjoyce911", 3)']);
    assert.deepEqual(plan(answer({ command: 'come' }), ctx()).lines, ['!goToPlayer("chrisjoyce911", 2)']);
    assert.deepEqual(plan(answer({ command: 'stop' }), ctx()).lines, ['!stop']);
    assert.deepEqual(plan(answer({ command: 'stay' }), ctx()).lines, ['!stay(-1)']);
    assert.deepEqual(plan(answer({ command: 'inventory' }), ctx()).lines, ['!inventory']);
});

test('plan: gather, mine and craft use the Laya commands when present', () => {
    assert.deepEqual(plan(answer({ command: 'gather', item: 'wood', count: '10' }), ctx()).lines, ['!layaGather("log", 10)']);
    assert.deepEqual(plan(answer({ command: 'gather', item: 'wood' }), ctx()).lines, ['!layaGather("log", 8)']);
    assert.deepEqual(plan(answer({ command: 'mine', item: 'iron', count: '4' }), ctx()).lines, ['!layaGather("raw_iron", 4)']);
    assert.deepEqual(plan(answer({ command: 'mine', item: 'iron' }), ctx({ has: n => n === '!layaMine' })).lines, ['!layaMine("iron", 4)']);
    assert.deepEqual(plan(answer({ command: 'mine', item: 'iron' }), ctx({ has: () => false })).lines, ['!collectBlocks("iron_ore", 4)']);
    assert.equal(plan(answer({ command: 'mine' }), ctx()).kind, 'reply');
    assert.deepEqual(plan(answer({ command: 'craft', item: 'pickaxe', count: '1' }), ctx()).lines, ['!layaCraft("iron_pickaxe", 1)'], 'best tier: 4 iron ingots');
    assert.deepEqual(plan(answer({ command: 'craft', item: 'pickaxe', tier: 'diamond' }), ctx()).lines, ['!layaCraft("diamond_pickaxe", 1)']);
    assert.deepEqual(plan(answer({ command: 'craft', item: 'wood', count: '4' }), ctx({ has: () => false })).lines, ['!craftRecipe("oak_planks", 4)']);
    assert.equal(plan(answer({ command: 'craft', item: 'diamond' }), ctx()).kind, 'reply');
});

test('plan: giving resolves against the inventory', () => {
    const give = (a, c = ctx()) => plan(answer({ command: 'give', ...a }), c);
    assert.deepEqual(give({ item: 'wood', count: 'all' }).lines, ['!givePlayer("chrisjoyce911", "birch_log", 12)']);
    assert.deepEqual(give({ item: 'wood', count: '5' }).lines, ['!givePlayer("chrisjoyce911", "birch_log", 5)']);
    const tooMany = give({ item: 'bread', count: '10' });
    assert.deepEqual(tooMany.lines, ['!givePlayer("chrisjoyce911", "bread", 3)']);
    assert.match(tooMany.say, /only have 3/);
    assert.deepEqual(give({ item: 'pickaxe', count: '1' }).lines, ['!givePlayer("chrisjoyce911", "stone_pickaxe", 1)']);
    assert.deepEqual(give({ item: 'diamond', count: '3' }), { kind: 'reply', text: "I don't have any diamond." });
    assert.equal(give({ count: 'all' }).lines.length, carry.length, 'everything: one give per stack');
    assert.equal(give({}).kind, 'reply');
});

test('plan: attack, store and eat', () => {
    assert.deepEqual(plan(answer({ command: 'attack', item: 'creeper' }), ctx()).lines, ['!attack("creeper")']);
    assert.deepEqual(plan(answer({ command: 'attack' }), ctx()).lines, ['!attack("zombie")'], 'defend me: nearest hostile');
    assert.equal(plan(answer({ command: 'attack' }), ctx({ nearestHostile: () => null })).kind, 'reply');
    assert.deepEqual(plan(answer({ command: 'store', item: 'stone', count: 'all' }), ctx()).lines, ['!putInChest("cobblestone", 30)']);
    const all = plan(answer({ command: 'store', count: 'all' }), ctx()).lines;
    assert.ok(!all.some(l => /bread|pickaxe|rotten/.test(l)) && all.some(l => /birch_log/.test(l)), all.join(' '));
    assert.deepEqual(plan(answer({ command: 'eat' }), ctx()).lines, ['!consume("bread")'], 'eat: best good food');
    assert.deepEqual(plan(answer({ command: 'eat', item: 'bread' }), ctx()).lines, ['!consume("bread")']);
    assert.equal(plan(answer({ command: 'eat' }), ctx({ carry: [{ item: 'rotten_flesh', count: 2 }] })).kind, 'reply');
});

function deps(r, extra = {}) {
    const said = [], ran = [];
    return {
        said, ran,
        client: { decide: async (task, state, qs) => { assert.equal(task, 'command'); assert.ok(qs.Item); return r; } },
        task: {}, speaker: 'chrisjoyce911',
        bot: { username: 'andy', inventory: { items: () => [{ name: 'bread', count: 2 }, { name: 'bread', count: 1 }, { name: 'oak_log', count: 7 }] } },
        has: n => n === '!layaGather', nearestHostile: () => null,
        execute: async line => { ran.push(line); return ''; },
        say: t => said.push(t), logPath: null, ...extra,
    };
}

test('handleCommand runs commands, merges inventory, and falls back to the LLM', async () => {
    let d = deps(answer({ command: 'give', item: 'bread', count: 'all' }));
    assert.equal(await handleCommand('andy give me your bread', d), true);
    assert.deepEqual(d.ran, ['!givePlayer("chrisjoyce911", "bread", 3)']);
    d = deps(answer({ command: 'chat' }));
    assert.equal(await handleCommand('hi andy', d), false);
    assert.deepEqual(d.ran, []);
    d = deps(answer({ command: 'chat' }), { task: { no_llm: true } });
    assert.equal(await handleCommand('hi andy', d), true);
    assert.deepEqual(d.said, [CANNED]);
    d = deps(null);
    assert.equal(await handleCommand('follow me', d), false, 'no model answer: the LLM');
    d = deps(answer({ addressed: 0.02, command: 'follow' }));
    assert.equal(await handleCommand('bob follow me', d), true);
    assert.deepEqual([d.ran, d.said], [[], []], 'for someone else: ignored');
});

test('plan: farm a count, until stopped, and open-ended mining', () => {
    const farmCtx = ctx({ has: n => ['!layaFarm', '!layaMine'].includes(n), arity: n => (n === '!layaMine' ? { min: 1, max: 2 } : { min: 0, max: 2 }) });
    assert.deepEqual(plan(answer({ command: 'farm', item: 'wheat', count: '20' }), farmCtx).lines, ['!layaFarm("wheat", 20)']);
    assert.deepEqual(plan(answer({ command: 'farm', item: 'carrots', count: 'any' }), farmCtx).lines, ['!layaFarm("carrots")']);
    assert.deepEqual(plan(answer({ command: 'farm', item: 'none', count: 'any' }), farmCtx).lines, ['!layaFarm("any")']);
    assert.equal(plan(answer({ command: 'farm', item: 'wheat' }), ctx()).kind, 'llm', 'no !layaFarm');
    assert.deepEqual(plan(answer({ command: 'mine', item: 'iron', count: 'any' }), farmCtx).lines, ['!layaMine("iron")']);
    assert.deepEqual(plan(answer({ command: 'mine', item: 'iron', count: '9' }), farmCtx).lines, ['!layaMine("iron", 9)']);
    const fixedMine = ctx({ has: n => n === '!layaMine', arity: () => ({ min: 2, max: 2 }) });
    assert.deepEqual(plan(answer({ command: 'mine', item: 'iron', count: 'any' }), fixedMine).lines, ['!layaMine("iron", 4)'], 'count required: the default count');
    assert.deepEqual(plan(answer({ command: 'mine', item: 'stone', count: '8' }), ctx({ has: n => n === '!layaMine' })).lines, ['!collectBlocks("stone", 8)'], 'stone is no ore');
});
