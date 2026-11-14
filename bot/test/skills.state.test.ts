// 5.5 the hunt, gather and place models against laya-go (skills-spec v1 §2–4): each game's golden v1 request (state
// and questions, byte for byte) and 300 of its generated situations (test/fixtures/laya-<g>-v1/situations.json,
// dumped from laya-go's Situations(7, 300) with State, the options, Decide and Harmful on every answer): the same
// state, options, rules answer and rule, and the same harmful answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { UNSEEN, decideSkill, type Dir, type Search, type Seen, type SkillModel } from '../src/models/skill/index.js';
import { HUNT_ACTIONS, HUNT_KINDS, HUNT_MODEL, HUNT_TARGETS, huntQuestions, huntState, readHunt, type HuntSituation } from '../src/models/hunt/index.js';
import { GATHER_ACTIONS, GATHER_MODEL, gatherQuestions, gatherState, type GatherGoal, type GatherSituation } from '../src/models/gather/index.js';
import { PLACE_MODEL, placeOptions, placeQuestions, placeState, readPlace, type PlaceItem, type PlaceSituation } from '../src/models/place/index.js';
import type { DecideResult, ModelDecider } from '../src/types/models.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (g: string, f: string) => JSON.parse(fs.readFileSync(path.join(REPO, `test/fixtures/laya-${g}-v1`, f), 'utf8'));
interface GoSeen { Count: number; Dist: number; Dir: string }
interface Case<S> { situation: S; state: string; options: Record<string, string[]>; want: Record<string, string>; rule: string; harmful: string[] | null }
const seen = (g: GoSeen): Seen => g.Count === 0 && g.Dist === -1 ? { ...UNSEEN } : { count: g.Count, dist: g.Dist, dir: g.Dir as Dir };

interface GoHunt { Goal: number; Have: number; Animals: GoSeen[]; Drops: GoSeen; Search: number }
const hunt = (g: GoHunt): HuntSituation => ({ goal: g.Goal, have: g.Have, search: g.Search as Search, drops: seen(g.Drops),
    animals: Object.fromEntries(HUNT_KINDS.map((k, i) => [k, seen(g.Animals[i]!)])) as HuntSituation['animals'] });
interface GoGather { Goal: string; Want: number; Have: number; Source: GoSeen; Drops: GoSeen; Shears: boolean; Free: number; Search: number }
const gather = (g: GoGather): GatherSituation => ({ goal: g.Goal as GatherGoal, want: g.Want, have: g.Have, source: seen(g.Source),
    drops: seen(g.Drops), shears: g.Shears, free: g.Free, search: g.Search as Search });
interface GoPlace { Item: string; Grid: string[] }
const place = (g: GoPlace): PlaceSituation => ({ item: g.Item as PlaceItem, grid: g.Grid });

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

test('golden v1 requests: hunt, gather and place match laya-go byte for byte', () => {
    const none = { ...UNSEEN };
    const h = fixture('hunt', 'request.json');
    const hs: HuntSituation = { goal: 32, have: 12, search: 49, drops: { count: 2, dist: 3, dir: 'W' },
        animals: { cow: { count: 3, dist: 9, dir: 'E' }, pig: { count: 1, dist: 22, dir: 'N' }, sheep: none, chicken: { count: 2, dist: 30, dir: 'S' }, rabbit: none } };
    assert.equal(huntState(hs), h.state);
    assert.deepEqual(json(huntQuestions()), h.questions);
    const g = fixture('gather', 'request.json');
    const gs: GatherSituation = { goal: 'logs', want: 16, have: 4, source: { count: 3, dist: 7, dir: 'E' }, drops: { count: 3, dist: 2, dir: 'N' }, shears: false, free: 20, search: 49 };
    assert.equal(gatherState(gs), g.state);
    assert.deepEqual(json(gatherQuestions()), g.questions);
    const p = fixture('place', 'request.json');
    const ps: PlaceSituation = { item: 'furnace', grid: ['#########', '#..,,...#', '#..C.T..#', '#.......#', '#...@...#', '#~~.....#', '#ff.....#', '#ff..s..#', '#########'] };
    assert.equal(placeState(ps), p.state);
    assert.deepEqual(json(placeQuestions(ps)), p.questions);
});

function parity<S, A, R extends string>(g: string, m: SkillModel<S, A, R>, conv: (x: never) => S, answers: (s: S) => Record<string, string>[]) {
    const cases = fixture(g, 'situations.json') as Case<never>[];
    assert.equal(cases.length, 300);
    for (const [i, c] of cases.entries()) {
        const s = conv(c.situation);
        assert.equal(m.state(s), c.state, `${g} ${i} state`);
        const qs = m.questions(s);
        assert.deepEqual(Object.fromEntries(Object.entries(qs).map(([k, q]) => [k, q.criteria])), c.options, `${g} ${i} options`);
        const r = m.rules(s);
        assert.deepEqual(r.words, c.want, `${g} ${i} answer`);
        assert.equal(r.rule, c.rule, `${g} ${i} rule`);
        assert.ok(m.read(r.words), `${g} ${i} rules words read`);
        const harmful = answers(s).filter(w => m.harmful(s, w)).map(w => Object.values(w).join(' '));
        assert.deepEqual(harmful, c.harmful ?? [], `${g} ${i} harmful`);
    }
}

test('300 laya-go hunt situations: state, options, rules, harmful', () => {
    parity('hunt', HUNT_MODEL, hunt as (x: never) => HuntSituation, () => HUNT_ACTIONS.flatMap(a => HUNT_TARGETS.map(t => ({ Action: a, Target: t }))));
});
test('300 laya-go gather situations: state, options, rules, harmful', () => {
    parity('gather', GATHER_MODEL, gather as (x: never) => GatherSituation, () => GATHER_ACTIONS.map(a => ({ Action: a })));
});
test('300 laya-go place situations: state, options (24 nearest, reading order), rules, harmful', () => {
    parity('place', PLACE_MODEL, place as (x: never) => PlaceSituation, s => placeOptions(s).map(o => ({ Target: o })));
});

test('laya-go TestState/TestDecide cases: refusals and the place rule cases', () => {
    const none = { ...UNSEEN };
    const animals = { cow: none, pig: none, sheep: none, chicken: none, rabbit: none };
    assert.throws(() => huntState({ goal: 0, have: 0, search: 49, drops: none, animals }), /bad hunt state/);
    assert.throws(() => huntState({ goal: 8, have: 0, search: 50 as Search, drops: none, animals }), /bad hunt state/);
    assert.throws(() => huntState({ goal: 8, have: 0, search: 49, drops: none, animals: { ...animals, cow: { count: 10, dist: 3, dir: 'E' } } }), /bad hunt state/);
    const gs: GatherSituation = { goal: 'logs', want: 16, have: 4, source: none, drops: none, shears: false, free: 20, search: 49 };
    assert.equal(gatherState(gs), 'Gather.\nGoal logs 16 have 4\nSource none 0 none none\nDrops 0 none none\nShears no Free 20\nSearch 49');
    assert.throws(() => gatherState({ ...gs, goal: 'stone' as GatherGoal }), /bad gather state/);
    assert.throws(() => gatherState({ ...gs, drops: { count: 1, dist: 17, dir: 'N' } }), /bad gather state/);
    const sample = ['#########', '#..,,...#', '#..C.T..#', '#.......#', '#...@...#', '#~~.....#', '#ff.....#', '#ff..s..#', '#########'];
    assert.throws(() => placeState({ item: 'furnace', grid: ['####@####', ...sample.slice(1)] }), /bad place state/);
    assert.throws(() => placeState({ item: 'torch', grid: sample }), /bad place state/);
    const grid = (...rows: string[]) => rows;
    for (const [item, g, want, rule] of [
        ['furnace', sample, 'W1 N1', 'station-by-station'],
        ['chest', grid('#########', '#########', '#########', '###...###', '###.@.###', '###...###', '#########', '#########', '#########'), 'E0 N1', 'station'],
        ['crafting_table', grid('#########', '#########', '#########', '###~..###', '###.@.###', '#########', '#########', '#########', '#########'), 'E1 N0', 'station'],
        ['torch', grid('#######', '#.....#', '#.....#', '#..@..#', '#.....#', '#.....#', '#######'), 'none', 'no-spot'],
        ['torch', grid('#######', '#....,#', '#.....#', '#..@..#', '#.....#', '#;....#', '#######'), 'E6 N6', 'torch'],
        ['saplings', grid('#########', '#.......#', '#.......#', '#.......#', '#...@...#', '#.......#', '#.......#', '#.......#', '#########'), 'E0 N3', 'saplings'],
    ] as const) {
        const r = PLACE_MODEL.rules({ item, grid: g });
        assert.deepEqual([r.words.Target, r.rule], [want, rule], `${item} ${want}`);
    }
});

test('typed answers: hunt pairs that do not fit are malformed; place labels to blocks (E+ x, N− z)', () => {
    assert.deepEqual(readHunt({ Action: 'attack', Target: 'cow' }), { action: 'attack', target: 'cow' });
    assert.equal(readHunt({ Action: 'attack', Target: 'drops' }), null);
    assert.equal(readHunt({ Action: 'collect', Target: 'cow' }), null);
    assert.equal(readHunt({ Action: 'done', Target: 'cow' }), null);
    assert.deepEqual(readHunt({ Action: 'collect', Target: 'drops' }), { action: 'collect' });
    assert.deepEqual(readPlace({ Target: 'E1 N2' }), { kind: 'cell', dx: 1, dz: -2 });
    assert.deepEqual(readPlace({ Target: 'W3 S0' }), { kind: 'cell', dx: -3, dz: 0 });
    assert.deepEqual(readPlace({ Target: 'none' }), { kind: 'none' });
    assert.equal(readPlace({ Target: 'up' }), null);
});

const answer = (words: Record<string, string>, p = 0.9, ms = 12): DecideResult => ({ model: 'm', ms,
    answers: Object.fromEntries(Object.entries(words).map(([k, v]) => [k, { type: 'choice' as const, top: v, topProbability: p, probabilities: { [v]: p }, confident: true }])) });
const client = (r: DecideResult | null): ModelDecider & { asked: string[] } => {
    const asked: string[] = [];
    return { asked, decide: async (task: string) => { asked.push(task); return r; } };
};

test('decideSkill: model when sure and not harmful; else the rules with why', async () => {
    const none = { ...UNSEEN };
    // 12 food of 32, three cows 2 away: rules attack cow
    const s: HuntSituation = { goal: 32, have: 12, search: 49, drops: none,
        animals: { cow: { count: 3, dist: 2, dir: 'E' }, pig: { count: 2, dist: 5, dir: 'N' }, sheep: none, chicken: none, rabbit: none } };
    const off = await decideSkill(HUNT_MODEL, s, null, 0.3);
    assert.deepEqual([off.source, off.why, off.step, off.rule], ['rules', 'rules', { action: 'attack', target: 'cow' }, 'attack']);
    const c = client(answer({ Action: 'approach', Target: 'cow' }));
    const sure = await decideSkill(HUNT_MODEL, s, c, 0.3);
    assert.deepEqual([sure.source, sure.why, sure.step, c.asked], ['model', undefined, { action: 'approach', target: 'cow' }, ['hunt']]);
    const unsure = await decideSkill(HUNT_MODEL, s, client(answer({ Action: 'approach', Target: 'cow' }, 0.2)), 0.3);
    assert.deepEqual([unsure.source, unsure.why, unsure.step.action, unsure.asked?.p], ['rules', 'low-confidence', 'attack', 0.2]);
    // the last two pigs when not hungry: harmful → vetoed
    const veto = await decideSkill(HUNT_MODEL, s, client(answer({ Action: 'attack', Target: 'pig' })), 0.3);
    assert.deepEqual([veto.source, veto.why, veto.asked?.words], ['rules', 'veto', { Action: 'attack', Target: 'pig' }]);
    const bad = await decideSkill(HUNT_MODEL, s, client(answer({ Action: 'collect', Target: 'cow' })), 0.3);
    assert.deepEqual([bad.source, bad.why], ['rules', 'malformed']);
    const outside = await decideSkill(HUNT_MODEL, s, client(answer({ Action: 'fly', Target: 'cow' })), 0.3);
    assert.deepEqual([outside.source, outside.why], ['rules', 'malformed']);
    const down = await decideSkill(HUNT_MODEL, s, client(null), 0.3);
    assert.deepEqual([down.source, down.why, down.step.action], ['rules', 'no-answer', 'attack']);
});
