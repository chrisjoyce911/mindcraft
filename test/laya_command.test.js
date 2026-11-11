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

test('home command: !setHomeChest, a short reply when it worked', async () => {
    const homeCtx = ctx({ has: n => n === '!setHomeChest' });
    const p = plan(answer({ command: 'home' }), homeCtx);
    assert.deepEqual(p.lines, ['!setHomeChest']);
    assert.equal(plan(answer({ command: 'home' }), ctx()).kind, 'llm');
    for (const [result, want] of [['Home chest set at 1 64 2.', "That's my chest now."], ["I can't see a chest near you.", "I can't see a chest near you."]]) {
        const said = [];
        await handleCommand('andy this is your chest', {
            client: { decide: async () => answer({ command: 'home' }) }, task: { log_decisions: false }, bot: { username: 'andy', inventory: { items: () => [] } },
            speaker: 'chrisjoyce911', has: n => n === '!setHomeChest', execute: async () => result, say: t => said.push(t),
        });
        assert.deepEqual(said, [want]);
    }
});

import { QUESTIONS_V2, questionsFor, COMMANDS_V2, ITEMS_V2 } from '../src/agent/laya/command_state.js';

const fixture2 = name => JSON.parse(readFileSync(new URL(`./fixtures/laya-command-v2/${name}`, import.meta.url), 'utf8'));

test('golden v2 requests: match laya-go byte for byte', () => {
    for (const [file, msg] of [['request.json', 'Andy, can you craft me 2 iron picks please?'], ['farm_request.json', 'andy farm wheat 10'], ['home_request.json', 'andy this is your home chest']]) {
        const g = fixture2(file);
        assert.equal(state('andy', 'chrisjoyce911', msg), g.state, file);
        assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS_V2)), g.questions, file);
    }
    assert.equal(questionsFor('v2'), QUESTIONS_V2);
    assert.equal(questionsFor('v1'), QUESTIONS);
    assert.equal(questionsFor(undefined), QUESTIONS);
});

test('v2 option lists, normalize and resolve match laya-go', () => {
    const c = fixture2('resolve_cases.json');
    assert.deepEqual(COMMANDS_V2, c.commands);
    assert.deepEqual(ITEMS_V2, c.items);
    assert.deepEqual(TIERS, c.tiers);
    assert.deepEqual(COUNTS, c.counts);
    for (const [input, want] of Object.entries(c.normalize)) assert.equal(normalize(input), want);
    for (const r of c.resolve) {
        const carry = (r.carry || []).map(s => ({ item: s.Item, count: s.Count }));
        assert.equal(resolve(r.command, r.item, r.tier, carry), r.want, JSON.stringify(r));
    }
    assert.ok(c.resolve.some(r => r.command === 'farm'));
});

test('gather beef and kill cow with item none: the message names the animal', async () => {
    const { mobIn, dropIn } = await import('../src/agent/laya/command.js');
    assert.equal(mobIn('kill cow'), 'cow');
    assert.equal(mobIn('kill those zombies'), 'zombie');
    assert.equal(mobIn('kill the cave spider'), 'cave_spider');
    assert.equal(mobIn('kill it'), null);
    assert.deepEqual(dropIn('gather beef'), { drop: 'beef', animal: 'cow' });
    assert.deepEqual(dropIn('get me some porkchops'), { drop: 'porkchop', animal: 'pig' });
    let d = deps(answer({ command: 'gather' }));
    assert.equal(await handleCommand('gather beef', d), true);
    assert.deepEqual(d.ran, ['!attack("cow")']);
    assert.match(d.said[0], /Hunting a cow for beef/);
    d = deps(answer({ command: 'attack' }));
    assert.equal(await handleCommand('kill cow', d), true);
    assert.deepEqual(d.ran, ['!attack("cow")']);
    d = deps(answer({ command: 'gather' }));
    await handleCommand('gather stuff', d);
    assert.deepEqual(d.said, ['What should I gather?']);
});

// ---- prompt v2.1: animal drops, hunting ----
import { QUESTIONS_V21, ITEMS_V21, huntFor } from '../src/agent/laya/command_state.js';
const fixture21 = name => JSON.parse(readFileSync(new URL(`./fixtures/laya-command-v21/${name}`, import.meta.url), 'utf8'));

test('golden v2.1 requests: match laya-go byte for byte', () => {
    for (const [file, msg] of [['request.json', 'Andy, can you craft me 2 iron picks please?'], ['beef_request.json', 'gather beef']]) {
        const g = fixture21(file);
        assert.equal(state('andy', 'chrisjoyce911', msg), g.state, file);
        assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS_V21)), g.questions, file);
    }
    assert.equal(questionsFor('v2.1'), QUESTIONS_V21);
    assert.equal(questionsFor('v2'), QUESTIONS_V2);
});

test('v2.1 option lists, resolve and hunt match laya-go', () => {
    const c = fixture21('resolve_cases.json');
    assert.deepEqual(COMMANDS_V2, c.commands);
    assert.deepEqual(ITEMS_V21, c.items);
    assert.deepEqual(TIERS, c.tiers);
    assert.deepEqual(COUNTS, c.counts);
    for (const [input, want] of Object.entries(c.normalize)) assert.equal(normalize(input), want);
    for (const r of c.resolve) {
        const carry = (r.carry || []).map(s => ({ item: s.Item, count: s.Count }));
        assert.equal(resolve(r.command, r.item, r.tier, carry, 'v2.1'), r.want, JSON.stringify(r));
    }
    for (const [item, mob] of Object.entries(c.hunt)) assert.equal(huntFor(item), mob, item);
    // v2 resolves as before
    const c2 = fixture2('resolve_cases.json');
    for (const r of c2.resolve) {
        const carry = (r.carry || []).map(s => ({ item: s.Item, count: s.Count }));
        assert.equal(resolve(r.command, r.item, r.tier, carry, 'v2'), r.want);
    }
});

test('v2.1: a gather of a drop hunts its mob until the count; a mine of a drop is none', async () => {
    let d = deps(answer({ command: 'gather', item: 'beef', count: '5' }), { task: { prompt: 'v2.1' }, has: n => ['!layaGather', '!hunt'].includes(n) });
    assert.equal(await handleCommand('get me 5 beef', d), true);
    assert.deepEqual(d.ran, ['!hunt("cow", "beef", 5)']);
    d = deps(answer({ command: 'gather', item: 'leather', count: '3' }), { task: { prompt: 'v2.1' } });
    await handleCommand('kill some cows for leather', d);
    assert.deepEqual(d.ran, ['!attack("cow")'], 'no !hunt: one attack');
    d = deps(answer({ command: 'mine', item: 'beef' }), { task: { prompt: 'v2.1' } });
    await handleCommand('mine beef', d);
    assert.deepEqual(d.ran, []);
    assert.match(d.said[0], /What should I mine for/);
});

test('huntUntil: attacks until the count, stops when none are near or after maxKills', async () => {
    const { huntUntil } = await import('../src/agent/laya/hunt.js');
    let beef = 0, cows = 3;
    let r = await huntUntil(4, { have: () => beef, attack: async () => (cows-- > 0 ? (beef += 2, true) : false) });
    assert.deepEqual(r, { ok: true, reason: 'done', kills: 2 });
    r = await huntUntil(10, { have: () => beef, attack: async () => (cows-- > 0 ? (beef += 2, true) : false) });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'none near');
    r = await huntUntil(2, { have: () => 0, attack: async () => true, maxKills: 3 });
    assert.equal(r.kills, 3);
    assert.equal(r.ok, false);
});

test('laya:check has v2.1 samples (command v2.1, mine and farm on v2 text)', async () => {
    const { loadSample } = await import('../src/models/laya_check.js');
    assert.deepEqual(loadSample('command', 'v2.1').questions.Item.criteria, ITEMS_V21);
    assert.ok(loadSample('mine', 'v2.1').questions.Unload);
    assert.ok(loadSample('farm', 'v2.1').questions.Unload);
});

// ---- prompt v2.2: chores_on, chores_off ----
import { QUESTIONS_V22, COMMANDS_V22 } from '../src/agent/laya/command_state.js';

test('golden v2.2 request: "andy do your chores" matches laya-go byte for byte', () => {
    const g = JSON.parse(readFileSync(new URL('./fixtures/laya-command-v22/v22_chores_request.json', import.meta.url), 'utf8'));
    assert.equal(state('andy', 'chrisjoyce911', 'andy do your chores'), g.state);
    assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS_V22)), g.questions);
    assert.equal(questionsFor('v2.2'), QUESTIONS_V22);
    assert.deepEqual(COMMANDS_V22.slice(-3), ['chores_on', 'chores_off', 'chat']);
});

test('v2.2 plan: chores_on and chores_off run !layaChores', async () => {
    const { plan } = await import('../src/agent/laya/command.js');
    const ans = cmd => ({ answers: { Addressed: { probability: 0.99 }, Command: { top: cmd, topProbability: 0.95 },
        Item: { top: 'none' }, Tier: { top: 'none' }, Count: { top: 'any' } } });
    const ctx = { speaker: 'tester', has: n => n === '!layaChores', opts: { prompt: 'v2.2' }, carry: [] };
    assert.deepEqual(plan(ans('chores_on'), ctx).lines, ['!layaChores("on")']);
    assert.deepEqual(plan(ans('chores_off'), ctx).lines, ['!layaChores("off")']);
    assert.equal(plan(ans('chores_on'), { ...ctx, has: () => false }).kind, 'llm');
});
