// The director model (3.2): golden requests v1/v1.2/v1.3 byte for byte, the 1000-situation sets, and the
// pure parts of the old bot's test/laya_director.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    blind, decide, decideDirector, decideV12, directorState, itemWord, promptOf, QUESTIONS, RULES,
    type DirectorJobKind, type DirectorSituation, type JobView, type Last,
} from '../src/models/director/index.js';
import { ACTIVITIES, type Activity, type Armed, type DecideResult, type Danger, type ModelDecider, type Questions } from '../src/types/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (rel: string): string => fs.readFileSync(path.join(REPO, 'test/fixtures', rel), 'utf8');

const calmS: DirectorSituation = { job: null, paused: null, health: 20, food: 20, armed: 'sword', armor: 0, hostiles: 0, nearest: null,
    light: 15, night: false, under: false, free: 20, home: 40, valuables: 0, foodItems: 3, danger: 'none', last: 'none' };
const mine: JobView = { kind: 'mine', item: 'iron_ore', left: 6 };
const s = (x: Partial<DirectorSituation>): DirectorSituation => ({ ...calmS, ...x });
const sample = (x: Partial<DirectorSituation> = {}): DirectorSituation => s({ job: mine, health: 14, food: 12, armed: 'sword', armor: 8,
    hostiles: 2, nearest: { kind: 'zombie', dist: 6 }, light: 4, night: false, under: true, free: 5, home: 18, valuables: 3, foodItems: 4, ...x });

const answer = (top: string, p = 0.9, confident = true): DecideResult => ({ model: 'director-a', ms: 3,
    answers: { Activity: { type: 'choice', top, topProbability: p, probabilities: { [top]: p }, confident } } });
function fake(reply: DecideResult | null): ModelDecider & { asked: { task: string; state: string; questions: Questions }[] } {
    const asked: { task: string; state: string; questions: Questions }[] = [];
    return { asked, decide: async (task, state, questions) => { asked.push({ task, state, questions }); return reply; } };
}

test('answers are the spec words in its order', () => {
    assert.deepEqual([...ACTIVITIES], ['continue', 'defend', 'flee', 'eat', 'heal', 'unload', 'resume', 'idle']);
    assert.deepEqual(QUESTIONS.Activity.criteria, ACTIVITIES);
    assert.deepEqual(Object.keys(QUESTIONS), ['Activity']);
    assert.equal(RULES.length, 18);
    assert.equal(promptOf('v1'), 'v1');
    assert.equal(promptOf('v1.2'), 'v1.2');
    assert.equal(promptOf('v1.3'), 'v1.3');
    assert.equal(promptOf(undefined), 'v1.3');
    assert.equal(promptOf('v9'), 'v1.3');
});

for (const [dir, prompt, extra] of [
    ['laya-director-v1', 'v1', {}],
    ['laya-director-v12', 'v1.2', { player: { name: 'chrisjoyce911', attacked: true, by: 'zombie', dist: 12 } }],
    ['laya-director-v13', 'v1.3', { player: { name: 'chrisjoyce911', attacked: true, by: 'zombie', dist: 12 }, me: { attacked: true, by: 'zombie', dist: 6 } }],
] as const) {
    test(`golden: the director request matches laya-go ${prompt}_sample_request.json byte for byte`, () => {
        const golden = JSON.parse(fixture(`${dir}/request.json`));
        // laya-go's sample: mining iron underground (6 left), a zombie 6 off, pack nearly full, home 18
        const text = directorState(sample(extra), prompt);
        assert.equal(text, golden.state);
        assert.equal(JSON.stringify({ questions: QUESTIONS, state: text }), JSON.stringify(golden));
    });
}

test('directorState: the spec lines in order, caps, other and bogged', () => {
    const text = directorState(s({ job: mine, paused: 'farm', health: 14.4, food: 17, armor: 7, hostiles: 2,
        nearest: { kind: 'zombie', dist: 5 }, light: 7, night: true, under: true, free: 10, home: 140, valuables: 7, foodItems: 4, danger: 'fall', last: 'interrupted' }));
    assert.equal(text, ['Director.', 'Job mine iron_ore left 6', 'Paused farm', 'Health 14 Food 17 Armed sword Armor 7', 'Hostiles 2 Nearest zombie 5',
        'Me attacked no by none none', 'Player none attacked no by none none', 'Light 7 Night yes Under yes', 'Pack 10 Home 99 Valuables 7',
        'Food items 4', 'Danger fall', 'Last interrupted'].join('\n'));
    const idle = directorState(calmS).split('\n');
    assert.equal(idle[1], 'Job none none left 0');
    assert.equal(idle[2], 'Paused none');
    assert.equal(idle[4], 'Hostiles 0 Nearest none none');
    assert.equal(directorState(s({ hostiles: 1, nearest: { kind: 'witch', dist: 30 } })).split('\n')[4], 'Hostiles 1 Nearest other 16');
    assert.equal(directorState(s({ job: { kind: 'farm', item: 'any', left: 'any' } })).split('\n')[1], 'Job farm any left any');
    assert.equal(directorState(s({ job: { kind: 'mine', item: 'iron_ore', left: 4000 } })).split('\n')[1], 'Job mine iron_ore left 999');
    const pl = (x: Partial<DirectorSituation>): string | undefined => directorState(s(x)).split('\n')[6];
    assert.equal(pl({ player: { name: 'ChrisJoyce911', attacked: true, by: 'husk', dist: 12.4 } }), 'Player chrisjoyce911 attacked yes by other 12');
    assert.equal(pl({ player: { name: 'tester', attacked: false, by: 'zombie', dist: 3 } }), 'Player tester attacked no by none 3');
    assert.equal(pl({ player: { name: 'tester', attacked: false, by: 'none', dist: 30 } }), 'Player none attacked no by none none', 'beyond 24: none');
    assert.equal(pl({ player: { name: 'tester', attacked: true, by: 'stray', dist: 0 } }), 'Player tester attacked yes by skeleton 0');
    assert.equal(directorState(s({ hostiles: 1, nearest: { kind: 'bogged', dist: 9 } })).split('\n')[4], 'Hostiles 1 Nearest skeleton 9');
    assert.equal(directorState(calmS, 'v1').split('\n').length, 10);
    assert.equal(directorState(calmS, 'v1.2').split('\n').length, 11);
    assert.equal(directorState(calmS, 'v1.2').split('\n')[5], 'Player none attacked no by none none');
    const me = (x: Partial<DirectorSituation>): string | undefined => directorState(s(x)).split('\n')[5];
    assert.equal(me({ me: { attacked: true, by: 'zombie', dist: 2.2 } }), 'Me attacked yes by zombie 2');
    assert.equal(me({ me: { attacked: true, by: 'stray', dist: 30 } }), 'Me attacked yes by skeleton 16');
    assert.equal(me({ me: { attacked: false, by: 'zombie', dist: 3 } }), 'Me attacked no by none none');
    assert.equal(me({ me: null }), 'Me attacked no by none none');
});

test('itemWord: laya-go director item words', () => {
    assert.equal(itemWord('mine', 'iron'), 'iron_ore');
    assert.equal(itemWord('mine', 'lapis'), 'lapis_ore');
    assert.equal(itemWord('farm', 'any'), 'none');
    assert.equal(itemWord('farm', 'wheat'), 'wheat');
    assert.equal(itemWord('craft', 'stone_pickaxe'), 'stone_pickaxe');
    assert.equal(itemWord('follow', null), 'none');
});

test('decide: v1.2 flee-ranged and defend-player, v1.3 defend only attackers', () => {
    const sk = (d: number): Partial<DirectorSituation> => ({ hostiles: 1, nearest: { kind: 'skeleton', dist: d } });
    assert.deepEqual(decide(s({ ...sk(14), health: 6, foodItems: 0 })), { activity: 'flee', rule: 'flee-ranged' });
    assert.deepEqual(decide(s({ hostiles: 1, nearest: { kind: 'stray', dist: 12 }, health: 5, foodItems: 0 })), { activity: 'flee', rule: 'flee-ranged' });
    assert.deepEqual(decide(s({ ...sk(14), health: 6, foodItems: 2 })), { activity: 'heal', rule: 'heal' }, 'with food: heal');
    const hit = { name: 'tester', attacked: true, by: 'zombie', dist: 12 };
    assert.deepEqual(decide(s({ player: hit, job: mine })), { activity: 'defend', rule: 'defend-player' });
    assert.deepEqual(decide(s({ player: hit, health: 5 })), { activity: 'defend', rule: 'defend-player' }, 'hurt but nothing near: still defends');
    assert.deepEqual(decide(s({ player: hit, food: 6 })), { activity: 'eat', rule: 'eat-hungry' }, 'hungry with food: eats first');
    assert.deepEqual(decide(s({ player: { ...hit, dist: 25 } })), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decide(s({ player: { ...hit, attacked: false, by: 'none' } })), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decide(s({ player: hit, hostiles: 1, nearest: { kind: 'zombie', dist: 7 }, health: 6 })), { activity: 'flee', rule: 'flee-low' }, 'its own flee first');
    // v1.3: a zombie near attacking nobody is ignored; one attacking the bot is defended; an attack at 6 is fled
    assert.deepEqual(decide(s({ hostiles: 1, nearest: { kind: 'zombie', dist: 5 }, job: mine })), { activity: 'continue', rule: 'continue' });
    assert.deepEqual(decide(s({ hostiles: 1, nearest: { kind: 'zombie', dist: 5 }, me: { attacked: true, by: 'zombie', dist: 5 } })), { activity: 'defend', rule: 'defend' });
    assert.deepEqual(decide(s({ health: 6, me: { attacked: true, by: 'skeleton', dist: 14 } })), { activity: 'flee', rule: 'flee-low' });
});

test('decideV12: the spec v1.1/v1.2 rules in priority order, with laya-go rule names', () => {
    const z = (d: number): Partial<DirectorSituation> => ({ hostiles: 1, nearest: { kind: 'zombie', dist: d } });
    for (const d of ['fluid', 'fire', 'drowning'] as Danger[]) assert.deepEqual(decideV12(s({ danger: d, ...z(3) })), { activity: 'flee', rule: 'flee-danger' });
    assert.notEqual(decideV12(s({ danger: 'fall' })).activity, 'flee');
    assert.deepEqual(decideV12(s({ ...z(4), health: 6 })), { activity: 'flee', rule: 'flee-hostile' });
    assert.deepEqual(decideV12(s({ ...z(4), health: 10, armed: 'none' })), { activity: 'flee', rule: 'flee-hostile' });
    assert.deepEqual(decideV12(s({ hostiles: 1, nearest: { kind: 'creeper', dist: 3 } })), { activity: 'flee', rule: 'flee-creeper' });
    assert.deepEqual(decideV12(s({ ...z(7), health: 6 })), { activity: 'flee', rule: 'flee-low' });
    assert.deepEqual(decideV12(s({ ...z(4), health: 10 })), { activity: 'defend', rule: 'defend' });
    assert.deepEqual(decideV12(s({ ...z(8) })), { activity: 'defend', rule: 'defend' });
    assert.deepEqual(decideV12(s({ health: 8, job: mine })), { activity: 'heal', rule: 'heal' });
    assert.deepEqual(decideV12(s({ ...z(9), health: 8 })), { activity: 'heal', rule: 'heal' });
    assert.deepEqual(decideV12(s({ food: 6, job: mine })), { activity: 'eat', rule: 'eat-hungry' });
    assert.equal(decideV12(s({ food: 6, foodItems: 0, job: mine })).activity, 'continue');
    assert.deepEqual(decideV12(s({ free: 2, home: 300, job: mine })), { activity: 'unload', rule: 'unload-full' });
    assert.deepEqual(decideV12(s({ free: 6, home: 24, job: mine })), { activity: 'unload', rule: 'unload-near' });
    assert.deepEqual(decideV12(s({ free: 6, home: 24, paused: 'mine' })), { activity: 'unload', rule: 'unload-near' }, 'paused counts');
    assert.equal(decideV12(s({ free: 6, home: 25, job: mine })).activity, 'continue');
    assert.deepEqual(decideV12(s({ valuables: 4, hostiles: 2, nearest: { kind: 'zombie', dist: 12 }, job: mine })), { activity: 'unload', rule: 'unload-valuables' });
    assert.equal(decideV12(s({ free: 0, home: null, job: mine })).activity, 'continue', 'no home: no unload');
    assert.deepEqual(decideV12(s({ free: 4, home: 3 })), { activity: 'idle', rule: 'idle' }, 'never unload while idle');
    assert.deepEqual(decideV12(s({ paused: 'mine' })), { activity: 'resume', rule: 'resume-paused' });
    assert.deepEqual(decideV12(s({ job: mine, last: 'interrupted' })), { activity: 'continue', rule: 'continue' });
    assert.deepEqual(decideV12(s({ job: mine, last: 'failed', paused: 'farm' })), { activity: 'resume', rule: 'resume-failed' });
    assert.deepEqual(decideV12(s({ job: mine, last: 'blocked' })), { activity: 'idle', rule: 'idle-failed' });
    assert.deepEqual(decideV12(s({ job: mine, last: 'blocked', food: 17, health: 19 })), { activity: 'idle', rule: 'idle-failed' }, 'eat-idle only with nothing to do');
    assert.deepEqual(decideV12(calmS), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decideV12(s({ food: 17, health: 19 })), { activity: 'eat', rule: 'eat-idle' });
});

test('decideDirector: no model, the rules; a confident model; low confidence and no answer fall back with why', async () => {
    let d = await decideDirector(s({ job: mine }), null);
    assert.deepEqual([d.answer, d.source, d.rule, d.why], ['continue', 'rules', 'continue', undefined]);
    assert.match(d.state, /^Director\.\nJob mine iron_ore left 6/);
    const c = fake(answer('unload'));
    d = await decideDirector(s({ job: mine }), { client: c, prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source, d.p, d.rule, d.ruleActivity], ['unload', 'model', 0.9, 'continue', 'continue']);
    assert.equal(c.asked[0]?.task, 'director');
    assert.equal(JSON.stringify(c.asked[0]?.questions), JSON.stringify(QUESTIONS));
    d = await decideDirector(s({ job: mine }), { client: fake(answer('idle', 0.3, false)), prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source, d.why, d.model, d.p], ['continue', 'rules', 'low-confidence', 'idle', 0.3]);
    d = await decideDirector(s({ job: mine }), { client: fake(null), prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source, d.why], ['continue', 'rules', 'no-answer']);
    const thrower: ModelDecider = { decide: async () => { throw new Error('boom'); } };
    d = await decideDirector(s({ job: mine }), { client: thrower, prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.why], ['continue', 'no-answer']);
});

test('decideDirector: nothing-to-defend and not-hungry are the rules\' to answer', async () => {
    let d = await decideDirector(s({ job: mine, hostiles: 1, nearest: { kind: 'zombie', dist: 5 } }), { client: fake(answer('defend', 0.95)), prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source, d.why, d.model, d.p], ['continue', 'rules', 'nothing-to-defend', 'defend', 0.95]);
    d = await decideDirector(s({ job: mine, me: { attacked: true, by: 'zombie', dist: 2 }, hostiles: 1, nearest: { kind: 'zombie', dist: 2 } }),
        { client: fake(answer('defend')), prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source], ['defend', 'model']);
    d = await decideDirector(s({ food: 20 }), { client: fake(answer('eat')), prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source, d.why], ['idle', 'rules', 'not-hungry']);
    d = await decideDirector(s({ food: 19 }), { client: fake(answer('eat')), prompt: 'v1.3' });
    assert.deepEqual([d.answer, d.source], ['eat', 'model']);
});

test('decideDirector: a model on an older prompt never overrides a rule it cannot see (blind)', async () => {
    const c = fake(answer('idle', 0.99));
    const hit = { name: 'tester', attacked: true, by: 'zombie', dist: 12 };
    let d = await decideDirector(s({ player: hit }), { client: c, prompt: 'v1' });
    assert.deepEqual([d.answer, d.source, d.rule], ['defend', 'rules', 'defend-player']);
    assert.equal(c.asked.length, 0);
    d = await decideDirector(calmS, { client: c, prompt: 'v1' });
    assert.equal(d.source, 'model');
    assert.ok(!/Player/.test(c.asked[0]?.state ?? ''), 'v1 text has no Player line');
    d = await decideDirector(s({ player: hit }), { client: c, prompt: 'v1.2' });
    assert.equal(d.source, 'model', 'a v1.2 model sees the line and decides');
    assert.match(c.asked[1]?.state ?? '', /\nPlayer tester attacked yes by zombie 12\n/);
    assert.ok(!/\nMe /.test(c.asked[1]?.state ?? ''), 'v1.2 text has no Me line');
    // v1.3 ignores a zombie attacking nobody; v1.2 defends it: a v1.2 model is not asked
    const z = s({ job: mine, hostiles: 1, nearest: { kind: 'zombie', dist: 5 } });
    assert.equal(blind(z, decide(z), 'v1.2'), true);
    assert.equal(blind(z, decide(z), 'v1.3'), false);
    d = await decideDirector(z, { client: c, prompt: 'v1.2' });
    assert.deepEqual([d.answer, d.source, c.asked.length], ['continue', 'rules', 2]);
});

// parseDirector reads a director state back to a situation (v1.3 has the Me line at index 5, v1.2+ the Player line).
function parseDirector(text: string): DirectorSituation {
    let L = text.split('\n').map(l => l.split(' '));
    const at = (i: number, j: number): string => L[i]?.[j] ?? '';
    let me: DirectorSituation['me'] = null;
    if (at(5, 0) === 'Me') {
        me = at(5, 2) === 'yes' ? { attacked: true, by: at(5, 4), dist: Number(at(5, 5)) } : { attacked: false, by: 'none', dist: 0 };
        L = [...L.slice(0, 5), ...L.slice(6)];
    }
    let player: DirectorSituation['player'] = null;
    if (at(5, 0) === 'Player') {
        if (at(5, 1) !== 'none') player = { name: at(5, 1), attacked: at(5, 3) === 'yes', by: at(5, 5), dist: Number(at(5, 6)) };
        L = [...L.slice(0, 5), ...L.slice(6)];
    }
    const n = Number;
    const kind = at(1, 1), left = at(1, 4);
    return {
        job: kind === 'none' ? null : { kind: kind as DirectorJobKind, item: at(1, 2), left: left === 'any' ? 'any' : n(left) },
        paused: at(2, 1) === 'none' ? null : at(2, 1) as DirectorJobKind,
        health: n(at(3, 1)), food: n(at(3, 3)), armed: at(3, 5) as Armed, armor: n(at(3, 7)),
        hostiles: n(at(4, 1)), nearest: at(4, 3) === 'none' ? null : { kind: at(4, 3), dist: n(at(4, 4)) },
        light: n(at(5, 1)), night: at(5, 3) === 'yes', under: at(5, 5) === 'yes',
        free: n(at(6, 1)), home: at(6, 3) === 'none' ? null : n(at(6, 3)), valuables: n(at(6, 5)),
        foodItems: n(at(7, 2)), danger: at(8, 1) as Danger, last: at(9, 1) as Last, player, me,
    };
}

interface DirectorRow { state: string; answer: Activity; rule: string }
const rows = (dir: string): DirectorRow[] => fixture(`${dir}/decisions.jsonl`).trim().split('\n').map(l => JSON.parse(l) as DirectorRow);

test('prompt v1 state round trip on laya-go v1.1 situations (db494eb); v1.2 rules differ only by flee-ranged', () => {
    const rs = rows('laya-director-v1');
    assert.equal(rs.length, 1000);
    for (const r of rs) {
        const st = parseDirector(r.state);
        assert.equal(directorState(st, 'v1'), r.state, 'state round trip');
        const d = decideV12(st);
        if (d.rule !== 'flee-ranged') assert.deepEqual(d, { activity: r.answer, rule: r.rule }, r.state);
    }
});

test('rules and state agree with laya-go v1.2 on 1000 generated situations (94b2117)', () => {
    const rs = rows('laya-director-v12');
    assert.equal(rs.length, 1000);
    const seen = new Set<string>();
    for (const r of rs) {
        const st = parseDirector(r.state);
        assert.equal(directorState(st, 'v1.2'), r.state, 'state round trip');
        assert.deepEqual(decideV12(st), { activity: r.answer, rule: r.rule }, r.state);
        seen.add(r.rule);
    }
    assert.equal(seen.size, 18, 'every rule is exercised');
});

test('rules and state agree with laya-go v1.3 on 1000 generated situations (0cbe811)', () => {
    const rs = rows('laya-director-v13');
    assert.equal(rs.length, 1000);
    const seen = new Set<string>();
    for (const r of rs) {
        const st = parseDirector(r.state);
        assert.equal(directorState(st), r.state, 'state round trip');
        assert.deepEqual(decide(st), { activity: r.answer, rule: r.rule }, r.state);
        seen.add(r.rule);
    }
    assert.ok(seen.has('defend') && seen.has('flee-low'), 'the v1.3 rules are exercised');
});
