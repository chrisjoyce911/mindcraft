// The command model (4.1): laya-go's golden requests and resolve cases for prompts v1, v2, v2.1 and v2.2; the
// plan (the old bot's test/laya_command.test.js, every command present); laya-command.jsonl byte for byte (the
// live fixture and one line per branch recorded from the old JS, test/fixtures/laya-logs/branches/command.jsonl
// by tools/laya-logs/record-command.mjs); every Command the plan makes round-trips through the legacy line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    COMMANDS, COMMANDS_V2, COMMANDS_V22, COUNTS, ITEMS, ITEMS_V2, ITEMS_V21, TIERS,
    commandQuestions, commandState, decideCommand, dropIn, huntFor, mergeCarry, mobIn, normalize, plan, promptOf, read, resolve,
    type CommandAsked, type CommandContext, type CommandPlan, type CommandPrompt,
} from '../src/models/command/index.js';
import { CANNED, handleChat, type CommandDeps } from '../src/command/handle.js';
import { parseLegacy } from '../src/harness/legacy.js';
import { legacyLine } from '../src/log/legacyLine.js';
import { commandLine, stamp, type CommandLine } from '../src/log/jsonl.js';
import type { Command, DecideResult, ModelDecider } from '../src/types/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const raw = (rel: string): string => fs.readFileSync(path.join(REPO, 'test/fixtures', rel), 'utf8');
const json = <T>(rel: string): T => JSON.parse(raw(rel)) as T;
const lines = (rel: string): string[] => raw(rel).split('\n').filter(Boolean);
const timeOf = (line: string): Date => new Date((JSON.parse(line) as { time: string }).time);

/** sorted: keys in order, as laya-go writes its fixtures. */
function sorted(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(sorted);
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted((v as Record<string, unknown>)[k])]));
    return v;
}

// ---- golden requests ----

const GOLDEN: [CommandPrompt, string, string][] = [
    ['v1', 'laya-command-v1/request.json', 'Andy, can you craft me 2 iron picks please?'],
    ['v2', 'laya-command-v2/request.json', 'Andy, can you craft me 2 iron picks please?'],
    ['v2', 'laya-command-v2/farm_request.json', 'andy farm wheat 10'],
    ['v2', 'laya-command-v2/home_request.json', 'andy this is your home chest'],
    ['v2.1', 'laya-command-v21/request.json', 'Andy, can you craft me 2 iron picks please?'],
    ['v2.1', 'laya-command-v21/beef_request.json', 'gather beef'],
    ['v2.2', 'laya-command-v22/v22_chores_request.json', 'andy do your chores'],
];

test('golden requests v1, v2, v2.1, v2.2 match laya-go byte for byte', () => {
    for (const [v, file, msg] of GOLDEN) {
        const req = { questions: commandQuestions(v), state: commandState('andy', 'chrisjoyce911', msg) };
        assert.equal(JSON.stringify(sorted(req), null, 2), raw(file).trimEnd(), file);
        assert.deepEqual(Object.keys(req.questions), ['Addressed', 'Command', 'Item', 'Tier', 'Count'], 'the old request order');
    }
});

test('promptOf: v1 unless v2, v2.1 or v2.2', () => {
    assert.equal(promptOf('v2.1'), 'v2.1');
    assert.equal(promptOf('v2.2'), 'v2.2');
    assert.equal(promptOf('v2'), 'v2');
    assert.equal(promptOf(undefined), 'v1');
    assert.equal(promptOf('v9'), 'v1');
});

test('state refuses names with spaces or empty', () => {
    assert.equal(commandState('an dy', 'steve', 'hi'), null);
    assert.equal(commandState('andy', '', 'hi'), null);
    assert.equal(normalize("Don't  STOP!! x".repeat(1)), 'dont stop x');
});

// ---- option lists, normalize, resolve (laya-go resolve_cases) ----

interface Cases {
    commands: string[]; items: string[]; tiers: string[]; counts: string[]; normalize: Record<string, string>;
    resolve: { command: string; item: string; tier: string; carry: { Item: string; Count: number }[] | null; want: string }[];
    hunt?: Record<string, string>;
}
const carryOf = (c: Cases['resolve'][number]) => (c.carry ?? []).map(s => ({ name: s.Item, count: s.Count }));

for (const [v, dir, commands, items] of [
    ['v1', 'laya-command-v1', COMMANDS, ITEMS], ['v2', 'laya-command-v2', COMMANDS_V2, ITEMS_V2], ['v2.1', 'laya-command-v21', COMMANDS_V2, ITEMS_V21],
] as const) {
    test(`${v}: option lists, normalize and resolve match laya-go`, () => {
        const c = json<Cases>(`${dir}/resolve_cases.json`);
        assert.deepEqual(commands, c.commands);
        assert.deepEqual(items, c.items);
        assert.deepEqual(TIERS, c.tiers);
        assert.deepEqual(COUNTS, c.counts);
        for (const [input, want] of Object.entries(c.normalize)) assert.equal(normalize(input), want, JSON.stringify(input));
        assert.ok(c.resolve.length >= 400);
        for (const r of c.resolve) assert.equal(resolve(r.command, r.item, r.tier, carryOf(r), v === 'v2.1' ? 'v2.1' : 'v2'), r.want, JSON.stringify(r));
        if (c.hunt) for (const [item, mob] of Object.entries(c.hunt)) assert.equal(huntFor(item), mob, item);
    });
}

test('v2.2: chores_on and chores_off before chat; resolves as v2.1', () => {
    assert.deepEqual(COMMANDS_V22.slice(-3), ['chores_on', 'chores_off', 'chat']);
    assert.deepEqual(commandQuestions('v2.2').Item.criteria, ITEMS_V21);
    assert.equal(resolve('gather', 'beef', 'none', [], 'v2.2'), 'beef');
    assert.equal(resolve('gather', 'beef', 'none', [], 'v2'), 'none');
});

// ---- the plan ----

function asked(a: Partial<CommandAsked> = {}): CommandAsked {
    return { addressed: 0.95, command: 'chat', p: 0.9, item: 'none', tier: 'none', count: 'any', ms: 12, model: 'fake', ...a };
}
const CARRY = mergeCarry([{ name: 'oak_log', count: 5 }, { name: 'birch_log', count: 12 }, { name: 'bread', count: 3 }, { name: 'iron_ingot', count: 4 },
    { name: 'stone_pickaxe', count: 1 }, { name: 'cobblestone', count: 30 }, { name: 'rotten_flesh', count: 2 }]);
const ctx = (extra: Partial<CommandContext> = {}): CommandContext =>
    ({ speaker: 'chrisjoyce911', message: '', carry: CARRY, nearestHostile: 'zombie', prompt: 'v2.1', ...extra });

/** Every plan the tests make: each Command must round-trip through its legacy line. */
const made: Command[] = [];
function P(a: Partial<CommandAsked>, c: CommandContext = ctx()): CommandPlan {
    const p = plan(asked(a), c);
    if (p.kind === 'run') made.push(...p.commands);
    return p;
}
const linesOf = (p: CommandPlan): string[] => (p.kind === 'run' ? p.commands.map(c => legacyLine(c)!) : []);
const sayOf = (p: CommandPlan): string | undefined => (p.kind === 'run' ? p.say : p.kind === 'reply' ? p.text : undefined);

test('plan: who it is for, chat and confidence', () => {
    assert.deepEqual(plan(null, ctx()), { kind: 'canned', why: 'no-answer' });
    assert.deepEqual(P({ addressed: 0.05, command: 'follow' }), { kind: 'ignore' });
    assert.deepEqual(P({ addressed: 0.3, command: 'follow' }), { kind: 'canned', why: 'not-sure-addressed' });
    assert.deepEqual(P({ command: 'chat' }), { kind: 'canned', why: 'chat' });
    assert.deepEqual(P({ command: 'follow', p: 0.4 }), { kind: 'canned', why: 'low-confidence' });
    assert.deepEqual(P({ command: 'follow', p: 0.4 }, ctx({ opts: { min_confidence: 0.3 } })).kind, 'run', 'settings override the defaults');
});

test('plan: movement, stop, inventory, chores', () => {
    assert.deepEqual(P({ command: 'follow' }), { kind: 'run', commands: [{ kind: 'job', job: { kind: 'follow', player: 'chrisjoyce911', distance: 3 } }], say: 'Following you.' });
    assert.deepEqual(linesOf(P({ command: 'come' })), ['!goToPlayer("chrisjoyce911", 2)']);
    assert.equal(sayOf(P({ command: 'come' })), 'On my way.');
    assert.deepEqual(P({ command: 'stop' }), { kind: 'run', commands: [{ kind: 'stop' }] });
    assert.deepEqual(linesOf(P({ command: 'stay' })), ['!stay(-1)']);
    assert.equal(sayOf(P({ command: 'stay' })), "I'll stay here.");
    assert.deepEqual(P({ command: 'inventory' }), { kind: 'run', commands: [{ kind: 'inventory' }] });
    const v22 = ctx({ prompt: 'v2.2' });
    assert.deepEqual(P({ command: 'chores_on' }, v22), { kind: 'run', commands: [{ kind: 'chores', on: true }] });
    assert.deepEqual(P({ command: 'chores_off' }, v22), { kind: 'run', commands: [{ kind: 'chores', on: false }] });
});

test('plan: gather, mine and craft', () => {
    assert.deepEqual(linesOf(P({ command: 'gather', item: 'wood', count: '10' })), ['!layaGather("log", 10)']);
    assert.equal(sayOf(P({ command: 'gather', item: 'wood', count: '10' })), 'Gathering 10 logs.');
    assert.deepEqual(linesOf(P({ command: 'gather', item: 'wood' })), ['!layaGather("log", 8)'], 'no count: gather_count');
    assert.deepEqual(linesOf(P({ command: 'mine', item: 'iron', count: '4' })), ['!layaMine("iron", 4)']);
    assert.equal(sayOf(P({ command: 'mine', item: 'iron', count: '9' })), 'Mining 9 iron.');
    assert.deepEqual(P({ command: 'mine', item: 'iron', count: 'any' }), {
        kind: 'run', commands: [{ kind: 'job', job: { kind: 'mine', ore: 'iron', count: 'forever' } }], say: 'Mining iron until you say stop.' });
    assert.deepEqual(linesOf(P({ command: 'mine', item: 'coal', count: 'all' })), ['!layaMine("coal")'], '"mine all the coal": until stopped');
    assert.deepEqual(linesOf(P({ command: 'mine', item: 'stone', count: '8' })), ['!layaGather("cobblestone", 8)'], 'stone is no ore');
    assert.equal(sayOf(P({ command: 'mine', item: 'stone', count: '8' })), 'Mining 8 cobblestone.');
    assert.deepEqual(P({ command: 'mine' }), { kind: 'reply', text: 'What should I mine for? Iron, coal, diamonds…' });
    assert.deepEqual(linesOf(P({ command: 'craft', item: 'pickaxe', count: '1' })), ['!layaCraft("iron_pickaxe", 1)'], 'best tier: 4 iron ingots');
    assert.deepEqual(linesOf(P({ command: 'craft', item: 'pickaxe', tier: 'diamond' })), ['!layaCraft("diamond_pickaxe", 1)']);
    assert.equal(sayOf(P({ command: 'craft', item: 'torch', count: '4' })), 'Making 4 torches.');
    assert.deepEqual(P({ command: 'craft', item: 'diamond' }), { kind: 'reply', text: "I don't know how to make that." });
});

test('plan: drops hunt (v2.1), and item none takes the message\'s animal', () => {
    assert.deepEqual(P({ command: 'gather', item: 'beef', count: '5' }), {
        kind: 'run', commands: [{ kind: 'job', job: { kind: 'hunt', mob: 'cow', item: 'beef', count: 5 } }], say: 'Hunting cows for 5 beef.' });
    assert.deepEqual(linesOf(P({ command: 'gather', item: 'wool', count: '3' })), ['!hunt("sheep", "white_wool", 3)']);
    assert.deepEqual(P({ command: 'mine', item: 'beef' }).kind, 'reply', 'a mine of a drop is none');
    const beef = P({ command: 'gather' }, ctx({ message: 'gather beef' }));
    assert.deepEqual(linesOf(beef), ['!attack("cow")']);
    assert.equal(sayOf(beef), 'Hunting a cow for beef.');
    assert.deepEqual(P({ command: 'gather' }, ctx({ message: 'gather stuff' })), { kind: 'reply', text: 'What should I gather?' });
    assert.equal(mobIn('kill cow'), 'cow');
    assert.equal(mobIn('kill those zombies'), 'zombie');
    assert.equal(mobIn('kill the cave spider'), 'cave_spider');
    assert.equal(mobIn('kill it'), null);
    assert.deepEqual(dropIn('gather beef'), { drop: 'beef', animal: 'cow' });
    assert.deepEqual(dropIn('get me some porkchops'), { drop: 'porkchop', animal: 'pig' });
});

test('plan: farm a count, until stopped, any crop', () => {
    assert.deepEqual(linesOf(P({ command: 'farm', item: 'wheat', count: '20' })), ['!layaFarm("wheat", 20)']);
    assert.equal(sayOf(P({ command: 'farm', item: 'wheat', count: '20' })), "Farming until I've harvested 20 wheat.");
    assert.deepEqual(linesOf(P({ command: 'farm', item: 'carrots', count: 'any' })), ['!layaFarm("carrots")']);
    assert.equal(sayOf(P({ command: 'farm', item: 'none', count: 'any' })), 'Farming crops until you say stop.');
    assert.deepEqual(linesOf(P({ command: 'farm', item: 'none', count: 'any' })), ['!layaFarm("any")']);
});

test('plan: home says its confirmation when the job is done', () => {
    assert.deepEqual(P({ command: 'home' }), { kind: 'run', commands: [{ kind: 'job', job: { kind: 'home' } }], doneSay: "That's my chest now." });
});

test('plan: giving resolves against the inventory', () => {
    const give = (a: Partial<CommandAsked>, c = ctx()) => P({ command: 'give', ...a }, c);
    assert.deepEqual(linesOf(give({ item: 'wood', count: 'all' })), ['!givePlayer("chrisjoyce911", "birch_log", 12)']);
    assert.deepEqual(linesOf(give({ item: 'wood', count: '5' })), ['!givePlayer("chrisjoyce911", "birch_log", 5)']);
    assert.equal(sayOf(give({ item: 'wood', count: '5' })), 'Here you go.');
    const tooMany = give({ item: 'bread', count: '10' });
    assert.deepEqual(linesOf(tooMany), ['!givePlayer("chrisjoyce911", "bread", 3)']);
    assert.equal(sayOf(tooMany), 'I only have 3 bread.');
    assert.deepEqual(linesOf(give({ item: 'pickaxe', count: '1' })), ['!givePlayer("chrisjoyce911", "stone_pickaxe", 1)']);
    assert.deepEqual(give({ item: 'diamond', count: '3' }), { kind: 'reply', text: "I don't have any diamond." });
    const all = give({ count: 'all' });
    assert.equal(linesOf(all).length, CARRY.length, 'everything: one give per stack');
    assert.equal(sayOf(all), 'Here, take everything.');
    assert.deepEqual(give({}), { kind: 'reply', text: 'What should I give you?' });
    assert.deepEqual(give({ count: 'all' }, ctx({ carry: [] })), { kind: 'reply', text: "I don't have anything." });
});

test('plan: attack, store and eat', () => {
    assert.deepEqual(linesOf(P({ command: 'attack', item: 'creeper' })), ['!attack("creeper")']);
    assert.equal(sayOf(P({ command: 'attack', item: 'cave_spider' })), 'Attacking the cave spider!');
    assert.deepEqual(linesOf(P({ command: 'attack' })), ['!attack("zombie")'], 'defend me: nearest hostile');
    assert.deepEqual(linesOf(P({ command: 'attack' }, ctx({ message: 'kill that pig', nearestHostile: 'zombie' }))), ['!attack("pig")'], 'the message first');
    assert.deepEqual(linesOf(P({ command: 'attack' }, ctx({ message: 'get the beef', nearestHostile: null }))), ['!attack("cow")'], 'then a drop\'s animal');
    assert.deepEqual(P({ command: 'attack' }, ctx({ nearestHostile: null })), { kind: 'reply', text: "I don't see anything to fight." });
    assert.deepEqual(linesOf(P({ command: 'store', item: 'stone', count: 'all' })), ['!putInChest("cobblestone", 30)']);
    assert.equal(sayOf(P({ command: 'store', item: 'stone', count: '5' })), 'Storing 5 cobblestone.');
    const all = linesOf(P({ command: 'store', count: 'all' }));
    assert.ok(!all.some(l => /bread|pickaxe|rotten/.test(l)) && all.some(l => /birch_log/.test(l)), all.join(' '));
    assert.equal(sayOf(P({ command: 'store', count: 'all' })), 'Putting my things in the chest.');
    assert.deepEqual(P({ command: 'store' }, ctx({ carry: [{ name: 'bread', count: 1 }, { name: 'coal', count: 3 }] })), { kind: 'reply', text: 'Nothing to store.' });
    assert.deepEqual(P({ command: 'eat' }), { kind: 'run', commands: [{ kind: 'job', job: { kind: 'eat', item: 'bread' } }] }, 'eat: best good food');
    assert.deepEqual(linesOf(P({ command: 'eat', item: 'bread' })), ['!consume("bread")']);
    assert.deepEqual(P({ command: 'eat' }, ctx({ carry: [{ name: 'rotten_flesh', count: 2 }] })), { kind: 'reply', text: "I don't have any food." });
    assert.deepEqual(linesOf(P({ command: 'eat', item: 'meat' })), ['!consume("bread")'], 'no meat: the best good food (as the old plan)');
    assert.deepEqual(P({ command: 'eat', item: 'meat' }, ctx({ carry: [{ name: 'dirt', count: 1 }] })), { kind: 'reply', text: "I don't have any meat." });
});

// ---- the answer ----

function reply(a: Partial<Record<'addressed' | 'p', number> & Record<'command' | 'item' | 'tier' | 'count', string>> = {}, ms = 41): DecideResult {
    const o = { addressed: 0.95, command: 'chat', p: 0.9, item: 'none', tier: 'none', count: 'any', ...a };
    const choice = (top: string, p = 0.9) => ({ type: 'choice' as const, top, topProbability: p, confident: true, probabilities: { [top]: p } });
    return { model: 'fake', ms, answers: {
        Addressed: { type: 'noul', probability: o.addressed, top: o.addressed > 0.5 ? 'true' : 'false', topProbability: Math.max(o.addressed, 1 - o.addressed), confident: true },
        Command: choice(o.command, o.p), Item: choice(o.item), Tier: choice(o.tier), Count: choice(o.count),
    } };
}

test('read: words outside the prompt\'s options are malformed; missing answers are none', () => {
    assert.equal(read(null, 'v2.1').ok, false);
    assert.deepEqual(read(reply({ command: 'chores_on' }), 'v2.1'), { ok: false, why: 'malformed', said: { addressed: 0.95, command: 'chores_on', p: 0.9,
        item: 'none', tier: 'none', count: 'any', ms: 41, model: 'fake' } });
    assert.equal(read(reply({ command: 'chores_on' }), 'v2.2').ok, true);
    assert.equal(read(reply({ item: 'beef' }), 'v2').ok, false);
    assert.equal(read(reply({ count: '11' }), 'v2.1').ok, false);
    const r = reply(); delete (r.answers as Record<string, unknown>).Tier;
    assert.deepEqual(read(r, 'v2.1'), { ok: false, why: 'no-answer' });
});

test('decideCommand: never throws; a client error is no answer', async () => {
    const boom: ModelDecider = { decide: async () => { throw new Error('boom'); } };
    const d = await decideCommand('andy', ctx({ message: 'andy follow me' }), boom);
    assert.deepEqual(d, { plan: { kind: 'canned', why: 'no-answer' }, state: 'Command.\nMe andy From chrisjoyce911\nSaid andy follow me' });
    assert.equal(await decideCommand('an dy', ctx({ message: 'x' }), boom), null);
    let asked: { task: string; state: string; items: unknown } | null = null;
    const spy: ModelDecider = { decide: async (task, state, qs) => { asked = { task, state, items: qs.Item?.criteria }; return reply({ command: 'stop', p: 0.99 }); } };
    const ok = await decideCommand('andy', ctx({ message: 'Stop!', prompt: 'v2.2' }), spy);
    assert.deepEqual(ok?.plan, { kind: 'run', commands: [{ kind: 'stop' }] });
    assert.deepEqual(asked, { task: 'command', state: 'Command.\nMe andy From chrisjoyce911\nSaid stop', items: ITEMS_V21 });
});

// ---- handleChat ----

function deps(r: DecideResult | null, extra: Partial<CommandDeps> = {}) {
    const said: string[] = [], ran: [Command, string | undefined][] = [], logged: CommandLine[] = [];
    const d: CommandDeps = {
        me: 'andy', model: { client: { decide: async () => r }, prompt: 'v2.1' },
        carry: () => [{ name: 'bread', count: 2 }, { name: 'oak_log', count: 7 }, { name: 'bread', count: 1 }],
        nearestHostile: () => null,
        say: t => { said.push(t); }, run: (c, done) => { ran.push([c, done]); }, log: l => { logged.push(l); }, ...extra,
    };
    return { d, said, ran, logged };
}

test('handleChat: runs commands (inventory merged), says first; canned and ignore; one log line each', async () => {
    let t = deps(reply({ command: 'give', item: 'bread', count: 'all' }));
    await handleChat('chrisjoyce911', 'andy give me your bread', t.d);
    assert.deepEqual(t.ran, [[{ kind: 'job', job: { kind: 'give', player: 'chrisjoyce911', item: 'bread', count: 3 } }, undefined]]);
    assert.deepEqual(t.said, ['Here you go.']);
    assert.equal(t.logged.length, 1);
    t = deps(reply({ command: 'chat' }));
    await handleChat('chrisjoyce911', 'hi andy', t.d);
    assert.deepEqual([t.ran, t.said, t.logged[0]?.kind, t.logged[0]?.reason], [[], [CANNED], 'llm', 'chat']);
    t = deps(null);
    await handleChat('chrisjoyce911', 'follow me', t.d);
    assert.deepEqual(t.said, [CANNED], 'no model answer: canned');
    t = deps(reply({ addressed: 0.02, command: 'follow' }));
    await handleChat('chrisjoyce911', 'bob follow me', t.d);
    assert.deepEqual([t.ran, t.said, t.logged.length], [[], [], 1], 'for someone else: ignored, logged');
    t = deps(reply({ command: 'gather' }));
    await handleChat('chrisjoyce911', 'gather stuff', t.d);
    assert.deepEqual(t.said, ['What should I gather?']);
    t = deps(reply({ command: 'home', p: 0.97 }));
    await handleChat('chrisjoyce911', 'andy this is your chest', t.d);
    assert.deepEqual([t.said, t.ran], [[], [[{ kind: 'job', job: { kind: 'home' } }, "That's my chest now."]]]);
});

test('handleChat: the task off or no state is canned with no line; a failing run doesn\'t stop the rest', async () => {
    let t = deps(reply({ command: 'follow', p: 0.99 }), { model: null });
    await handleChat('chrisjoyce911', 'andy follow me', t.d);
    assert.deepEqual([t.said, t.ran, t.logged], [[CANNED], [], []]);
    t = deps(reply({ command: 'follow', p: 0.99 }));
    await handleChat('two words', 'andy follow me', t.d);
    assert.deepEqual([t.said, t.logged], [[CANNED], []]);
    const ran: string[] = [];
    t = deps(reply({ command: 'store', count: 'all', p: 0.99 }), { carry: () => [{ name: 'dirt', count: 5 }, { name: 'sand', count: 3 }],
        run: c => { ran.push(legacyLine(c)!); if (ran.length === 1) throw new Error('no chest'); } });
    await handleChat('chrisjoyce911', 'andy store everything', t.d);
    assert.deepEqual(ran, ['!putInChest("dirt", 5)', '!putInChest("sand", 3)']);
});

// ---- laya-command.jsonl ----

test('golden: laya-command.jsonl (mine coal 5) byte for byte', async () => {
    const [want] = lines('laya-logs/laya-command.jsonl');
    const d = await decideCommand('andy', ctx({ speaker: 'tester', message: 'andy go mine coal 5', carry: [] }),
        { decide: async () => reply({ addressed: 1, command: 'mine', p: 1, item: 'coal', count: '5' }, 237) });
    assert.ok(d);
    assert.equal(stamp(commandLine(d), timeOf(want!)), want);
});

// The messages and answers tools/laya-logs/record-command.mjs gave the old handleCommand (speaker tester, prompt v2.1 unless
// named), in its order.
type Ans = [number, string, number, string?, string?, string?, number?];
const BRANCHES: [CommandPrompt, string, Ans | null][] = [
    ['v2.1', 'andy follow me', null],
    ['v2.1', 'bob follow me', [0.0412, 'follow', 0.97]],
    ['v2.1', 'follow me', [0.33333, 'follow', 0.97]],
    ['v2.1', 'nice weather andy', [0.9, 'chat', 0.8888]],
    ['v2.1', 'andy do the thing', [0.95, 'craft', 0.41234]],
    ['v2.1', 'andy gather stuff', [0.99, 'gather', 0.9]],
    ['v2.1', 'andy follow me', [0.99876, 'follow', 0.99951, 'none', 'none', 'any', 230]],
    ['v2.1', 'andy give me everything', [0.97, 'give', 0.95, 'none', 'none', 'all']],
    ['v2.1', 'andy this is your chest', [0.97, 'home', 0.95]],
    ['v2.1', 'andy get me 5 beef', [0.97, 'gather', 0.95, 'beef', 'none', '5']],
    ['v2.1', 'andy mine some iron', [0.97, 'mine', 0.95, 'iron', 'none', 'any']],
    ['v2.1', 'andy store everything', [0.97, 'store', 0.95, 'none', 'none', 'all']],
    ['v2.1', 'andy kill the cave spider', [0.97, 'attack', 0.95]],
    ['v2.1', 'andy craft a pickaxe', [0.97, 'craft', 0.95, 'pickaxe']],
    ['v2.1', 'andy eat something', [0.97, 'eat', 0.95]],
    ['v2.2', 'andy do your chores', [0.97, 'chores_on', 0.95]],
    ['v2.1', 'andy farm 20 wheat', [0.97, 'farm', 0.95, 'wheat', 'none', '20']],
];

test('branches: command — llm (no-answer, not-sure, chat, low-confidence), ignore, reply, run (every kind of line)', async () => {
    const want = lines('laya-logs/branches/command.jsonl');
    assert.equal(want.length, BRANCHES.length);
    const inv = [{ name: 'oak_log', count: 5 }, { name: 'bread', count: 3 }, { name: 'oak_log', count: 7 }, { name: 'stone_pickaxe', count: 1 },
        { name: 'cobblestone', count: 30 }, { name: 'coal', count: 4 }];
    for (const [i, [prompt, message, a]] of BRANCHES.entries()) {
        const r = a ? reply({ addressed: a[0], command: a[1], p: a[2], item: a[3] ?? 'none', tier: a[4] ?? 'none', count: a[5] ?? 'any' }, a[6] ?? 41) : null;
        const logged: CommandLine[] = [];
        const ran: Command[] = [];
        await handleChat('tester', message, { me: 'andy', model: { client: { decide: async () => r }, prompt }, carry: () => inv,
            nearestHostile: () => 'zombie', say: () => {}, run: c => { ran.push(c); }, log: l => { logged.push(l); } });
        made.push(...ran);
        assert.equal(logged.length, 1, message);
        assert.equal(stamp(logged[0]!, timeOf(want[i]!)), want[i], message);
    }
});

// ---- every Command the plan made is the one the old line parses to ----

test('legacy round trip: parseLegacy(legacyLine(c)) is c for every Command the plan made', () => {
    assert.ok(made.length > 40, `${made.length} commands`);
    for (const c of made) {
        const line = legacyLine(c);
        assert.ok(line, JSON.stringify(c));
        assert.deepEqual(parseLegacy(line, 'chrisjoyce911'), c, line);
    }
    assert.equal(legacyLine({ kind: 'reply', text: 'x' }), null);
    assert.equal(legacyLine({ kind: 'ignore' }), null);
});
