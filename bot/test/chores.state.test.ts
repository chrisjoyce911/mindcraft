// 5.6 the chores v2 model against laya-go (skills-spec v1 §1): the golden v2 request (state and questions, byte for
// byte), 300 of its generated situations (test/fixtures/laya-chores-v2/situations.json, dumped from laya-go's
// Situations(7, 300) with State, the options, Decide and Harmful on every Pairs answer), and v2_test.go's cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CHORES_MODEL, CHORES_RULES, choresGoal, choresHarmful, choresQuestions, choresRules, choresState, readChores,
    type ChoresAnswer, type ChoresSituation,
} from '../src/models/chores/index.js';
import { decideSkill } from '../src/models/skill/index.js';
import { CHORE_PAIRS, CHORE_SKILLS, HAVE_KINDS, type ChoreReason, type ChoreSkill, type ChoreTarget, type Counts, type LastRun } from '../src/types/chores.js';
import type { DecideResult, ModelDecider } from '../src/types/models.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (f: string) => JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/laya-chores-v2', f), 'utf8'));
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

interface GoResult { Skill: string; Target: string; Done: boolean; Reason: string; Age: number }
interface GoSituation {
    Time: string; Home: string; Biome: string; Table: boolean; Furnace: boolean; Chest: boolean; Lit: boolean; BedMine: boolean; BedPlayer: boolean;
    Farm: boolean; Ready: boolean; Axe: string; Pickaxe: string; Sword: string; Hoe: string; Shovel: string; Shears: boolean; Armor: boolean;
    Carry: number[]; InChest: number[]; Free: number; Made: number[]; KitPickaxe: string; KitAxe: string; KitShovel: string; KitSword: string;
    KitFood: number; KitTorches: number; Trees: number; Stone: number; CoalOre: number; IronOre: number; Grass: number; Water: number;
    Animal: number[]; Ground: number; CanPlace: boolean; CanSmelt: boolean; Last: GoResult[] | null;
}
const counts = (a: number[]): Counts => Object.fromEntries(HAVE_KINDS.map((k, i) => [k, a[i]!])) as Counts;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const conv = (g: GoSituation): ChoresSituation => ({
    time: g.Time, home: g.Home, biome: g.Biome, table: g.Table, furnace: g.Furnace, chest: g.Chest, lit: g.Lit, bedMine: g.BedMine, bedPlayer: g.BedPlayer,
    farm: g.Farm, ready: g.Ready, axe: g.Axe, pickaxe: g.Pickaxe, sword: g.Sword, hoe: g.Hoe, shovel: g.Shovel, shears: g.Shears, armor: g.Armor,
    carry: counts(g.Carry), inChest: counts(g.InChest), free: g.Free,
    made: { table: g.Made[0]!, furnace: g.Made[1]!, chest: g.Made[2]!, bed: g.Made[3]! },
    kitPickaxe: g.KitPickaxe, kitAxe: g.KitAxe, kitShovel: g.KitShovel, kitSword: g.KitSword, kitFood: g.KitFood, kitTorches: g.KitTorches,
    trees: g.Trees, stone: g.Stone, coal: g.CoalOre, iron: g.IronOre, grass: g.Grass, water: g.Water,
    animals: { cow: g.Animal[0]!, pig: g.Animal[1]!, sheep: g.Animal[2]!, chicken: g.Animal[3]!, rabbit: g.Animal[4]! },
    ground: g.Ground, canPlace: g.CanPlace, canSmelt: g.CanSmelt,
    last: (g.Last ?? []).map(r => ({ skill: r.Skill as ChoreSkill, target: r.Target as ChoreTarget, done: r.Done, age: r.Age, ...(r.Done ? {} : { reason: r.Reason as ChoreReason }) })),
} as ChoresSituation);

const zero = (): Counts => counts(Array(11).fill(0));
const run = (skill: ChoreSkill, target: ChoreTarget, done: boolean, age: number, reason?: ChoreReason): LastRun =>
    ({ skill, target, done, age, ...(reason ? { reason } : {}) });

/** sample: skills-spec §1's state (v2_test.go sample). */
export const SAMPLE: ChoresSituation = {
    time: 'day', home: 'chest', biome: 'forest', table: true, furnace: false, chest: true, lit: false, bedMine: false, bedPlayer: false,
    farm: true, ready: false, axe: 'stone', pickaxe: 'wooden', sword: 'none', hoe: 'none', shovel: 'none', shears: false, armor: false,
    carry: counts([3, 2, 12, 0, 0, 0, 4, 2, 0, 0, 1]), inChest: counts([40, 0, 60, 12, 0, 0, 6, 0, 0, 8, 0]), free: 20,
    made: { table: 0, furnace: 0, chest: 0, bed: 0 },
    kitPickaxe: 'stone', kitAxe: 'stone', kitShovel: 'none', kitSword: 'stone', kitFood: 3, kitTorches: 16,
    trees: 49, stone: 49, coal: 97, iron: 0, grass: 49, water: 49, animals: { cow: 49, pig: 0, sheep: 97, chicken: 0, rabbit: 0 }, ground: 2,
    canPlace: true, canSmelt: true,
    last: [run('craft', 'stone_sword', false, 1, 'missing_sticks'), run('hunt', 'food', true, 3)],
};
const copy = (s: ChoresSituation): ChoresSituation => structuredClone(s);

const ALL_PAIRS = CHORE_SKILLS.flatMap(k => CHORE_PAIRS[k].map(t => ({ Skill: k, Target: t })));

test('golden v2 request: the sample state and questions match laya-go byte for byte', () => {
    const g = fixture('request.json');
    assert.equal(choresState(SAMPLE), g.state);
    assert.deepEqual(json(choresQuestions()), g.questions);
});

test('300 laya-go chores v2 situations: state, options, rules answer and rule, harmful', () => {
    const cases = fixture('situations.json') as { situation: GoSituation; state: string; options: Record<string, string[]>; want: Record<string, string>; rule: string; harmful: string[] | null }[];
    assert.equal(cases.length, 300);
    const rules = new Set<string>();
    for (const [i, c] of cases.entries()) {
        const s = conv(c.situation);
        assert.equal(choresState(s), c.state, `${i} state`);
        assert.deepEqual(Object.fromEntries(Object.entries(choresQuestions()).map(([k, q]) => [k, q.criteria])), c.options, `${i} options`);
        const r = choresRules(s);
        assert.deepEqual(r.words, c.want, `${i} answer`);
        assert.equal(r.rule, c.rule, `${i} rule`);
        rules.add(r.rule);
        assert.ok(readChores(r.words), `${i} rules words read`);
        const harmful = ALL_PAIRS.filter(w => choresHarmful(s, w)).map(w => `${w.Skill} ${w.Target}`);
        assert.deepEqual(harmful, c.harmful ?? [], `${i} harmful`);
        assert.ok(!choresHarmful(s, r.words), `${i} the rules' own answer is not harmful`);
        // every answer has a goal (goals.ts is total)
        assert.ok(choresGoal(s, readChores(r.words)!, r), `${i} goal`);
    }
    for (const r of rules) assert.ok((CHORES_RULES as readonly string[]).includes(r));
});

test('laya-go TestState: values outside the spec are refused', () => {
    const edits: ((s: ChoresSituation) => void)[] = [
        s => { s.chest = false; },
        s => { s.carry.raw = 9; },
        s => { s.last[0]!.age = 10; },
        s => { s.last.push(run('craft', 'stone_sword', true, 4)); },
        s => { s.last[0]!.target = 'logs'; },
        s => { s.animals.cow = 2 as never; },
        s => { s.last[0]!.reason = 'need_logs' as never; },
        s => { s.carry.wood = 1000; },
        s => { s.last = [run('hunt', 'food', true, 1), run('rest', 'none', true, 2), run('sleep', 'none', true, 3), run('cook', 'none', true, 4), run('ask', 'food', true, 5)]; },
    ];
    for (const e of edits) {
        const b = copy(SAMPLE);
        e(b);
        assert.throws(() => choresState(b), /bad chores v2 state/, JSON.stringify(b.last));
    }
});

test('laya-go TestDecide cases', () => {
    const later: ChoresSituation = {
        time: 'day', home: 'chest', biome: 'plains', table: true, furnace: true, chest: true, lit: true, bedMine: true, bedPlayer: true,
        farm: true, ready: false, axe: 'stone', pickaxe: 'stone', sword: 'stone', hoe: 'wooden', shovel: 'none', shears: false, armor: false,
        carry: counts([70, 4, 70, 3, 0, 30, 40, 0, 0, 4, 0]), inChest: zero(), free: 25, made: { table: 0, furnace: 0, chest: 0, bed: 0 },
        kitPickaxe: 'stone', kitAxe: 'stone', kitShovel: 'stone', kitSword: 'stone', kitFood: 8, kitTorches: 16,
        trees: 49, stone: 49, coal: 49, iron: 0, grass: 49, water: 49, animals: { cow: 49, pig: 49, sheep: 49, chicken: 97, rabbit: 0 }, ground: 0,
        canPlace: true, canSmelt: true, last: [],
    };
    const cases: [string, ChoresSituation, ((s: ChoresSituation) => void) | null, string, string][] = [
        ['sample: torches 0, coal in the chest: craft torch', SAMPLE, null, 'craft', 'torch'],
        ['all done: rest', later, null, 'rest', 'none'],
        ['hungry, cows at 193: hunt', later, s => { s.carry.food = 2; s.animals = { cow: 193, pig: 0, sheep: 0, chicken: 0, rabbit: 0 }; }, 'hunt', 'food'],
        ['hungry, nothing anywhere, all done: ask food', later, s => { s.carry.food = 2; s.animals = { cow: 0, pig: 0, sheep: 0, chicken: 0, rabbit: 0 }; }, 'ask', 'food'],
        ['no table, wood 5: craft it', later, s => { s.table = false; }, 'craft', 'crafting_table'],
        ['no table, one made: place it', later, s => { s.table = false; s.made.table = 1; }, 'place', 'crafting_table'],
        ['no table, no wood: logs', later, s => { s.table = false; s.carry.wood = 2; }, 'gather', 'logs'],
        ['torches 4, coal: craft torch', later, s => { s.carry.torches = 4; }, 'craft', 'torch'],
        ['torches 4, no coal, ore near: mine coal', later, s => { s.carry.torches = 4; s.carry.coal = 0; s.canSmelt = false; }, 'mine', 'coal'],
        ['craft torch failed 2 min ago: rest', later, s => { s.carry.torches = 4; s.last = [run('craft', 'torch', false, 2, 'missing_sticks')]; }, 'rest', 'none'],
        ['craft torch failed 6 min ago: again', later, s => { s.carry.torches = 4; s.last = [run('craft', 'torch', false, 6, 'missing_sticks')]; }, 'craft', 'torch'],
        ['night, bed: sleep', later, s => { s.time = 'night'; }, 'sleep', 'none'],
        ['night, no bed, stone pick: mine iron', later, s => { s.time = 'night'; s.bedMine = false; }, 'mine', 'iron'],
        ['kit shovel missing: craft stone_shovel', later, s => { s.kitShovel = 'none'; }, 'craft', 'stone_shovel'],
        ['kit food low, cooked food: store kit', later, s => { s.kitFood = 2; }, 'store', 'kit'],
        ['pack full: unload', later, s => { s.free = 2; }, 'store', 'unload'],
        ["player's bed missing, wool 3: craft bed", later, s => { s.bedPlayer = false; s.carry.wool = 3; }, 'craft', 'bed'],
        ["player's bed missing, no sheep: ask wool", later, s => { s.bedPlayer = false; s.animals.sheep = 0; }, 'ask', 'wool'],
        ['raw meat: cook', later, s => { s.carry.raw = 5; }, 'cook', 'none'],
        ['no farm by water, seeds: farm start', later, s => { s.farm = false; s.carry.seeds = 16; }, 'farm', 'start'],
        ['no farm, no hoe: craft hoe', later, s => { s.farm = false; s.hoe = 'none'; s.carry.seeds = 16; }, 'craft', 'wooden_hoe'],
    ];
    for (const [name, base, edit, skill, target] of cases) {
        const s = copy(base);
        edit?.(s);
        assert.deepEqual(choresRules(s).words, { Skill: skill, Target: target }, name);
    }
    // v2.1: the chest before torches, no log trip for it at dusk; night mining only when armed
    const noChest = (s: ChoresSituation) => { s.chest = false; s.carry.wood = 0; s.carry.torches = 0; };
    const night = (s: ChoresSituation) => { s.time = 'night'; s.bedMine = false; s.sword = 'none'; };
    const v21: [string, (s: ChoresSituation) => void, string, string, string][] = [
        ['(a) chest no, wood 0, day, torches 0: logs for the chest', noChest, 'gather', 'logs', 'logs'],
        ['(b) the same at dusk, unlit, torches 10: place torch', s => { noChest(s); s.time = 'dusk'; s.lit = false; s.carry.torches = 10; }, 'place', 'torch', 'light-low-place'],
        ['(c) dusk, wood 2: craft chest', s => { noChest(s); s.time = 'dusk'; s.carry.wood = 2; }, 'craft', 'chest', 'chest'],
        ['(d) a chest made, torches 0: place it first', s => { noChest(s); s.made.chest = 1; }, 'place', 'chest', 'chest'],
        ['(e) night, stone pickaxe, unarmed: rest', night, 'rest', 'none', 'night-rest'],
        ['(f) night, wooden sword: mine iron', s => { night(s); s.sword = 'wooden'; }, 'mine', 'iron', 'night-mine'],
        ['(g) night, armour, no sword: mine iron', s => { night(s); s.armor = true; }, 'mine', 'iron', 'night-mine'],
        ['(h) night, wooden pickaxe, unarmed: rest', s => { night(s); s.pickaxe = 'wooden'; }, 'rest', 'none', 'night-rest'],
        ['night, wooden pickaxe, armour: mine coal', s => { night(s); s.pickaxe = 'wooden'; s.armor = true; }, 'mine', 'coal', 'night-mine'],
        ['dusk, chest no, wood 0, lit: no log trip for the chest', s => { noChest(s); s.time = 'dusk'; s.carry.torches = 20; }, 'gather', 'logs', 'stock-logs'],
        ['no table: the table first', s => { noChest(s); s.table = false; s.carry.wood = 5; s.carry.torches = 20; }, 'craft', 'crafting_table', 'table'],
    ];
    for (const [name, edit, skill, target, rule] of v21) {
        const s = copy(later);
        edit(s);
        const r = choresRules(s);
        assert.deepEqual([r.words, r.rule], [{ Skill: skill, Target: target }, rule], name);
    }
    const a = copy(later); noChest(a);
    assert.equal(choresRules(a).from, 'chest', "(a)'s logs are the chest's");
    assert.deepEqual(choresGoal(a, readChores(choresRules(a).words)!, choresRules(a)), { kind: 'have', goal: 2, chest: 0 }, "the chest's logs: 2");
});

test('laya-go TestHarmfulNightMine: mining at night unarmed is harmful (v2.1)', () => {
    const s = copy(SAMPLE);
    s.time = 'night'; s.pickaxe = 'stone'; s.sword = 'none';
    assert.ok(choresHarmful(s, { Skill: 'mine', Target: 'iron' }), 'unarmed iron');
    assert.ok(choresHarmful(s, { Skill: 'mine', Target: 'coal' }), 'unarmed coal');
    s.sword = 'wooden';
    assert.ok(!choresHarmful(s, { Skill: 'mine', Target: 'iron' }), 'a sword');
    s.sword = 'none'; s.armor = true;
    assert.ok(!choresHarmful(s, { Skill: 'mine', Target: 'iron' }), 'armour');
    s.time = 'day'; s.armor = false;
    assert.ok(!choresHarmful(s, { Skill: 'mine', Target: 'iron' }), 'day');
});

test('Harmful: outdoor at night, place with nothing, a recent failure', () => {
    const s = copy(SAMPLE);
    s.time = 'night';
    for (const w of [['hunt', 'food'], ['gather', 'logs'], ['farm', 'tend'], ['mine', 'cobble']]) assert.ok(choresHarmful(s, { Skill: w[0]!, Target: w[1]! }), w.join(' '));
    assert.ok(choresHarmful(s, { Skill: 'mine', Target: 'iron' }), 'unarmed (v2.1)');
    s.armor = true;
    assert.ok(!choresHarmful(s, { Skill: 'mine', Target: 'iron' }));
    const d = copy(SAMPLE);
    assert.ok(choresHarmful(d, { Skill: 'place', Target: 'furnace' }), 'no furnace carried');
    assert.ok(choresHarmful(d, { Skill: 'place', Target: 'torch' }), 'no torches');
    assert.ok(!choresHarmful(d, { Skill: 'place', Target: 'saplings' }), 'a sapling carried');
    assert.ok(choresHarmful(d, { Skill: 'craft', Target: 'stone_sword' }), 'failed 1 min ago');
    assert.ok(choresHarmful(d, { Skill: 'craft', Target: 'logs' }), 'not a pair');
    d.canSmelt = false;
    assert.ok(choresHarmful(d, { Skill: 'cook', Target: 'none' }));
});

function fakeClient(words: Record<string, string>, p = 0.9): ModelDecider {
    return {
        async decide(): Promise<DecideResult | null> {
            return { ms: 5, answers: Object.fromEntries(Object.entries(words).map(([k, v]) => [k, { type: 'choice', top: v, topProbability: p, probabilities: { [v]: p }, confident: true }])) } as unknown as DecideResult;
        },
    } as ModelDecider;
}

test('decide: the model when sure and not harmful; the rules with why otherwise', async () => {
    const s = copy(SAMPLE);
    const rules = await decideSkill(CHORES_MODEL, s, null, 0.5);
    assert.equal(rules.why, 'rules');
    assert.deepEqual(rules.words, { Skill: 'craft', Target: 'torch' });
    const m = await decideSkill(CHORES_MODEL, s, fakeClient({ Skill: 'gather', Target: 'logs' }), 0.5);
    assert.equal(m.source, 'model');
    assert.deepEqual(m.step, { skill: 'gather', target: 'logs' } satisfies ChoresAnswer);
    assert.equal((await decideSkill(CHORES_MODEL, s, fakeClient({ Skill: 'gather', Target: 'logs' }, 0.3), 0.5)).why, 'low-confidence');
    assert.equal((await decideSkill(CHORES_MODEL, s, fakeClient({ Skill: 'gather', Target: 'cobble' }), 0.5)).why, 'malformed');
    assert.equal((await decideSkill(CHORES_MODEL, s, fakeClient({ Skill: 'place', Target: 'furnace' }), 0.5)).why, 'veto');
});

test('goals: every amount of the spec\'s Answers table', () => {
    const s = copy(SAMPLE);
    const g = (skill: ChoreSkill, target: ChoreTarget, edit?: (s: ChoresSituation) => void) => {
        const x = copy(s); edit?.(x);
        return choresGoal(x, readChores({ Skill: skill, Target: target })!, choresRules(x));
    };
    // hunt: 32, or Have + 8 when Food < 8 (sample: food 4 + 6 in the chest = 10)
    assert.deepEqual(g('hunt', 'food'), { kind: 'have', goal: 32, chest: 6 });
    assert.deepEqual(g('hunt', 'food', x => { x.inChest.food = 0; }), { kind: 'have', goal: 12, chest: 0 });
    // logs: the step's need (table 4, wood-tools 3, beds 2), 64 when stocking or not the rules' answer
    const noWood = (x: ChoresSituation) => { x.carry.wood = 0; x.inChest.wood = 0; x.carry.torches = 20; x.kitShovel = 'stone'; x.ground = 0; x.carry.saplings = 0; x.carry.raw = 0; x.last = []; };
    assert.deepEqual(g('gather', 'logs', x => { noWood(x); x.table = false; }), { kind: 'have', goal: 4, chest: 0 });
    assert.equal(choresRules((() => { const x = copy(s); noWood(x); x.table = false; return x; })()).from, 'table');
    assert.deepEqual(g('gather', 'logs', x => { noWood(x); x.axe = 'none'; }), { kind: 'have', goal: 3, chest: 0 });
    assert.deepEqual(g('gather', 'logs'), { kind: 'have', goal: 64, chest: 40 });
    assert.deepEqual(g('gather', 'seeds'), { kind: 'have', goal: 16, chest: 8 });
    assert.deepEqual(g('gather', 'wool'), { kind: 'have', goal: 6, chest: 0 });
    assert.deepEqual(g('gather', 'wool', x => { x.bedMine = true; }), { kind: 'have', goal: 3, chest: 0 });
    assert.deepEqual(g('gather', 'saplings'), { kind: 'have', goal: 3, chest: 0 });
    // mine: cobble the step's need less what he has, else 64; coal 8; iron 8, until day at night
    assert.deepEqual(g('mine', 'cobble'), { kind: 'mine', count: 1 });
    assert.deepEqual(g('mine', 'coal'), { kind: 'mine', count: 8 });
    assert.deepEqual(g('mine', 'iron'), { kind: 'mine', count: 8 });
    assert.deepEqual(g('mine', 'iron', x => { x.time = 'night'; }), { kind: 'mine', count: 'day' });
    const stoneStep = (x: ChoresSituation) => { noWood(x); x.carry.wood = 10; x.carry.cobble = 2; x.inChest.cobble = 0; x.pickaxe = 'wooden'; x.axe = 'wooden'; x.water = 0; };
    assert.equal(choresRules((() => { const x = copy(s); stoneStep(x); return x; })()).rule, 'stone-cobble');
    assert.deepEqual(g('mine', 'cobble', stoneStep), { kind: 'mine', count: 6 + 8 - 2 });
    // craft: 1; torches up to 16 carried; a kit tool goes into the kit
    assert.deepEqual(g('craft', 'torch'), { kind: 'craft', count: 16, kit: false });
    assert.deepEqual(g('craft', 'stone_shovel'), { kind: 'craft', count: 1, kit: false });
    assert.deepEqual(g('craft', 'wooden_shovel'), { kind: 'craft', count: 1, kit: true });
    assert.deepEqual(g('farm', 'tend'), { kind: 'minutes', minutes: 3 });
    assert.deepEqual(g('ask', 'logs'), { kind: 'seconds', seconds: 20 });
    assert.deepEqual(g('rest', 'none'), { kind: 'seconds', seconds: 20 });
    assert.deepEqual(g('store', 'kit'), { kind: 'once' });
});
