// The decision logs (3.5): laya-director/eat/defend.jsonl lines identical in format to the old bot's.
// test/fixtures/laya-logs/laya-*.jsonl are lines from live runs of the old bot (1.2); test/fixtures/laya-logs/
// branches/*.jsonl are one line per branch, recorded once from the old JS (src/agent/laya/{eat,defend,director}.js
// driven with the fakes of test/laya_{eat,defend,director}.test.js). Each line here is made from the decision
// the new bot takes on the same situation and model reply, and must equal the old line byte for byte (time
// aside: the fixture's is used).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { carried, decideEat, type EatSituation } from '../src/models/eat/index.js';
import { decideDefend, type DefendMob, type DefendSituation } from '../src/models/defend/index.js';
import { decideDirector, type DirectorSituation } from '../src/models/director/index.js';
import { directorEntry } from '../src/director/loop.js';
import { JsonlLog, defendLine, directorLine, eatLine, stamp, type EatOutcome } from '../src/log/jsonl.js';
import type { DecideResult, ModelDecider } from '../src/types/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lines = (rel: string): string[] =>
    fs.readFileSync(path.join(REPO, 'test/fixtures/laya-logs', rel), 'utf8').split('\n').filter(Boolean);
const timeOf = (line: string): Date => new Date((JSON.parse(line) as { time: string }).time);
const fake = (r: DecideResult | null): ModelDecider => ({ decide: async () => r });
const item = (name: string, count: number) => ({ name, count });

function eatReply(eatP: number, food: string, p = 0.9, ms = 2): DecideResult {
    const top = eatP > 0.5 ? 'true' : 'false', tp = Math.max(eatP, 1 - eatP);
    return { model: 'fake', ms, answers: {
        Eat: { type: 'noul', probability: eatP, top, topProbability: tp, confident: tp >= 0.5 },
        Food: { type: 'choice', top: food, topProbability: p, confident: p >= 0.5, probabilities: { [food]: p } },
    } };
}
function defendReply(action: string, target: string, weapon: string, p = 0.9, danger = 0.9, ms = 3): DecideResult {
    const choice = (top: string) => ({ type: 'choice' as const, top, topProbability: p, confident: p >= 0.4, probabilities: { [top]: p } });
    return { model: 'fake', ms, answers: { Action: choice(action), Target: choice(target), Weapon: choice(weapon),
        Danger: { type: 'noul', probability: danger, top: danger > 0.5 ? 'true' : 'false', topProbability: Math.max(danger, 1 - danger), confident: true } } };
}

// ---- the live fixtures (1.2) ----

test('golden: laya-eat.jsonl (no-eat) byte for byte', async () => {
    const [want] = lines('laya-eat.jsonl');
    const sit: EatSituation = { health: 20, food: 20, saturation: 5, danger: false,
        carry: carried([item('cooked_porkchop', 3), item('apple', 1), item('cooked_beef', 6)]) };
    const d = await decideEat(sit, fake(eatReply(0, 'none', 1, 45)));
    assert.equal(stamp(eatLine(d, 'no-eat')!, timeOf(want!)), want);
});

test('golden: laya-defend.jsonl (fight) byte for byte', async () => {
    const [want] = lines('laya-defend.jsonl');
    const sit: DefendSituation = { health: 16, food: 20, armor: 0, night: false, playerNear: true, weapons: ['iron_sword'],
        arrows: 0, shield: false, apples: 0, mobs: [{ kind: 'husk', dx: -1, dz: 3, health: 20 }] };
    const d = await decideDefend(sit, fake(defendReply('fight', 'husk 1', 'iron_sword', 1, 1, 46)));
    assert.equal(d.source, 'model');
    assert.equal(stamp(defendLine(d)!, timeOf(want!)), want);
});

test('golden: laya-director.jsonl (model idle) byte for byte; acted stays off the file', () => {
    const [want] = lines('laya-director.jsonl');
    const old = JSON.parse(want!) as { state: string; event: string };
    // the old bot's event "idle" isn't a new bot event: the line is made with 'tick' and compared with it swapped in
    const d = { answer: 'idle' as const, rule: 'idle' as const, source: 'model' as const, p: 1, state: old.state, ruleActivity: 'idle' as const };
    const line = directorLine(directorEntry('tick', d, 'eat-model'));
    assert.equal(stamp({ ...line, event: old.event }, timeOf(want!)), want);
    assert.equal('acted' in line, false);
});

// ---- one line per branch, recorded from the old JS ----

test('branches: eat — no-answer, low-confidence, disagree, veto, no-eat, ate, eat-failed', async () => {
    const want = lines('branches/eat.jsonl');
    const sit: EatSituation = { health: 14, food: 12, saturation: 0, danger: false, carry: carried([item('bread', 4), item('golden_apple', 1)]) };
    const cases: [DecideResult | null, EatOutcome][] = [
        [null, 'no-eat'],
        [eatReply(0.9, 'bread', 0.3), 'no-eat'],
        [eatReply(0.9, 'none'), 'no-eat'],
        [eatReply(0.9, 'golden_apple'), 'no-eat'],
        [eatReply(0.1, 'none'), 'no-eat'],
        [eatReply(0.9, 'bread'), 'ate'],
        [eatReply(0.9, 'bread'), 'eat-failed'],
    ];
    assert.equal(want.length, cases.length);
    for (const [i, [r, outcome]] of cases.entries()) {
        const d = await decideEat(sit, fake(r));
        assert.equal(stamp(eatLine(d, outcome)!, timeOf(want[i]!)), want[i], `case ${i}`);
    }
});

test('branches: defend — no-answer, low-confidence, veto, creeper override, acted', async () => {
    const want = lines('branches/defend.jsonl');
    const sit = (mobs: DefendMob[]): DefendSituation => ({ health: 20, food: 20, armor: 0, night: true, playerNear: false,
        weapons: ['stone_sword', 'bow'], arrows: 5, shield: false, apples: 0, mobs });
    const zombie = [{ kind: 'zombie' as const, dx: 2, dz: 0, health: 20 }];
    const cases: [DefendMob[], DecideResult | null][] = [
        [zombie, null],
        [zombie, defendReply('fight', 'zombie 1', 'stone_sword', 0.2)],
        [zombie, defendReply('ignore', 'none', 'none')],
        [[{ kind: 'creeper', dx: 2, dz: 1, health: 20 }], defendReply('fight', 'creeper 1', 'stone_sword')],
        [zombie, defendReply('fight', 'zombie 1', 'stone_sword')],
    ];
    assert.equal(want.length, cases.length);
    for (const [i, [mobs, r]] of cases.entries()) {
        const d = await decideDefend(sit(mobs), fake(r));
        assert.equal(stamp(defendLine(d)!, timeOf(want[i]!)), want[i], `case ${i}`);
    }
});

test('branches: director — rules (no p), model, a refused answer (why + model)', async () => {
    const want = lines('branches/director.jsonl');
    const sit: DirectorSituation = { job: { kind: 'mine', item: 'iron_ore', left: 6 }, paused: null, health: 20, food: 20, armed: 'sword',
        armor: 0, hostiles: 0, nearest: null, light: 15, night: false, under: false, free: 20, home: 40, valuables: 0, foodItems: 3,
        danger: 'none', last: 'none' };
    const ask = (top: string): DecideResult => ({ model: 'fake', ms: 3,
        answers: { Activity: { type: 'choice', top, topProbability: 0.9, probabilities: { [top]: 0.9 }, confident: true } } });
    const cases = [
        { event: 'job-end' as const, model: null },
        { event: 'tick' as const, model: { client: fake(ask('unload')), prompt: 'v1.3' as const } },
        { event: 'tick' as const, model: { client: fake(ask('defend')), prompt: 'v1.3' as const } },
    ];
    assert.equal(want.length, cases.length);
    for (const [i, c] of cases.entries()) {
        const d = await decideDirector(sit, c.model);
        const line = directorLine(directorEntry(c.event, d));
        // the old event word for a finished job was "job-ended"; the new bot's is "job-end"
        const old = JSON.parse(want[i]!) as { event: string };
        assert.equal(stamp({ ...line, event: old.event }, timeOf(want[i]!)), want[i], `case ${i}`);
    }
});

// ---- what is not written ----

test('no line when the model was not asked (the rules alone decided), nor for eat-later', async () => {
    const eatSit: EatSituation = { health: 14, food: 12, saturation: 0, danger: false, carry: carried([item('bread', 4)]) };
    const rulesEat = await decideEat(eatSit, null);
    assert.equal(rulesEat.source, 'rules');
    for (const o of ['ate', 'eat-failed', 'no-eat'] as const) assert.equal(eatLine(rulesEat, o), null);
    const modelEat = await decideEat(eatSit, fake(eatReply(0.9, 'bread')));
    assert.equal(eatLine(modelEat, 'eat-later'), null);
    const fallbackEat = await decideEat(eatSit, fake(null));
    assert.deepEqual(eatLine(fallbackEat, 'eat-later'), { state: fallbackEat.state, outcome: 'fallback', reason: 'no-answer' },
        'a fallback is a line whatever the outcome');
    const defSit: DefendSituation = { health: 20, food: 20, armor: 0, night: true, playerNear: false, weapons: [], arrows: 0,
        shield: false, apples: 0, mobs: [{ kind: 'zombie', dx: 2, dz: 0, health: 20 }] };
    assert.equal(defendLine(await decideDefend(defSit, null)), null);
});

test('no new fields: eat/defend lines never carry source, rule, why or acted; director none of acted', async () => {
    const eatSit: EatSituation = { health: 14, food: 12, saturation: 0, danger: false, carry: carried([item('bread', 4)]) };
    const defSit: DefendSituation = { health: 20, food: 20, armor: 0, night: true, playerNear: false, weapons: ['stone_sword'], arrows: 0,
        shield: false, apples: 0, mobs: [{ kind: 'zombie', dx: 2, dz: 0, health: 20 }] };
    const all: object[] = [];
    for (const r of [null, eatReply(0.9, 'bread', 0.3), eatReply(0.1, 'none'), eatReply(0.9, 'bread')]) all.push(eatLine(await decideEat(eatSit, fake(r)), 'ate')!);
    for (const r of [null, defendReply('fight', 'zombie 1', 'stone_sword', 0.2), defendReply('fight', 'zombie 1', 'stone_sword')]) all.push(defendLine(await decideDefend(defSit, fake(r)))!);
    for (const l of all) for (const k of ['source', 'rule', 'why', 'acted']) assert.equal(k in l, false, `${k} in ${JSON.stringify(l)}`);
});

test('JsonlLog: time first, one line per write, null writes nothing, never throws', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-'));
    const t = new Date('2026-11-12T00:00:00.000Z');
    const log = new JsonlLog(path.join(dir, 'logs'), () => t);
    log.write('defend', null);
    log.write('director', { event: 'stop-overrun', runner: 'director:defend', waitedMs: 2100 });
    assert.equal(fs.existsSync(log.file('defend')), false);
    assert.equal(fs.readFileSync(log.file('director'), 'utf8'),
        '{"time":"2026-11-12T00:00:00.000Z","event":"stop-overrun","runner":"director:defend","waitedMs":2100}\n');
    const bad = new JsonlLog('/dev/null/nope');
    assert.doesNotThrow(() => bad.write('eat', { state: 's', outcome: 'fallback', reason: 'no-answer' }));
});
