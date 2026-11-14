// The defend model (3.2): golden request byte for byte, laya-go's rules on 1000 situations, and the pure
// parts of the old bot's test/laya_defend.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    chooseWeapons, decide, decideDefend, defendQuestions, defendState, harmful, isDefendKind, isWeapon, KINDS, nearMobs, RULES, safety, targetWord,
    type DefendMob, type DefendSituation, type WeaponName,
} from '../src/models/defend/index.js';
import type { DecideResult, ModelDecider } from '../src/types/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (rel: string): string => fs.readFileSync(path.join(REPO, 'test/fixtures', rel), 'utf8');

test('golden: the defend request matches laya-go v1_sample_request.json byte for byte', () => {
    const golden = JSON.parse(fixture('laya-defend-v1/request.json'));
    // chainmail helmet + iron chestplate (8), a shield, bow, iron sword, 12 arrows, a golden apple;
    // a zombie at E2 N2 and a skeleton at W12 S4 (a far zombie and a cow left out)
    const sit: DefendSituation = { health: 14, food: 12, armor: 8, night: true, playerNear: false,
        weapons: chooseWeapons(['bow', 'iron_sword', 'arrow', 'golden_apple', 'dirt']), arrows: 12, shield: true, apples: 1,
        mobs: nearMobs([{ kind: 'skeleton', x: -12, z: 4 }, { kind: 'zombie', x: 2, z: -2, health: 20 }, { kind: 'zombie', x: 30, z: 0 }, { kind: 'cow', x: 1, z: 1 }], 0, 0) };
    assert.equal(defendState(sit), golden.state);
    assert.equal(JSON.stringify({ questions: defendQuestions(sit), state: defendState(sit) }), JSON.stringify(golden));
});

test('mobs: nearest first, ties by kind then z then x, at most four, health clamped', () => {
    const rel = nearMobs([
        { kind: 'zombie', x: 3, z: 0 }, { kind: 'creeper', x: 0, z: 3 }, { kind: 'creeper', x: 0, z: -3 },
        { kind: 'witch', x: 1, z: 1, health: 30 }, { kind: 'spider', x: 5, z: 5, health: 0.4 }, { kind: 'stray', x: 9, z: 9 },
    ], 0, 0);
    assert.deepEqual(rel.map(m => `${m.kind} ${m.dx} ${m.dz} ${m.health}`), ['witch 1 1 26', 'creeper 0 -3 20', 'creeper 0 3 20', 'zombie 3 0 20']);
    assert.equal(nearMobs([{ kind: 'spider', x: 1, z: 0, health: 0.4, id: 7 }], 0, 0)[0]?.health, 1);
    assert.equal(nearMobs([{ kind: 'spider', x: 1, z: 0, id: 7 }], 0, 0)[0]?.id, 7);
    assert.equal(KINDS.cave_spider.health, 12);
});

test('weapons: at most three, the bow and the best melee, in laya-go order', () => {
    assert.deepEqual(chooseWeapons(['bow', 'wooden_sword', 'stone_axe', 'iron_sword', 'diamond_axe']), ['iron_sword', 'diamond_axe', 'bow']);
    assert.deepEqual(chooseWeapons(['stone_axe', 'wooden_sword']), ['wooden_sword', 'stone_axe']);
    assert.deepEqual(chooseWeapons([]), []);
});

const base = (over: Partial<DefendSituation> = {}): DefendSituation => ({ health: 20, food: 20, armor: 0, night: true, playerNear: false,
    weapons: ['stone_sword', 'bow'], arrows: 5, shield: false, apples: 0, mobs: [], ...over });
const mob = (kind: DefendMob["kind"], dx: number, dz: number, health: number = KINDS[kind].health): DefendMob => ({ kind, dx, dz, health });

test('safety: a close creeper is fled from unless strong and alone', () => {
    const sit = base({ mobs: [mob('creeper', 2, 0)] });
    const v = safety(sit, { action: 'fight', target: 0, weapon: 'stone_sword' });
    assert.ok(v.ok);
    assert.equal(v.answer.action, 'flee');
    assert.equal(v.answer.weapon, null);
    assert.equal(v.override, 'creeper');
    const strong = base({ armor: 20, weapons: ['iron_sword'], mobs: sit.mobs });
    const s2 = safety(strong, { action: 'fight', target: 0, weapon: 'iron_sword' });
    assert.ok(s2.ok && s2.answer.action === 'fight' && !s2.override);
    const bow = safety(sit, { action: 'fight', target: 0, weapon: 'bow' });
    assert.ok(bow.ok && bow.answer.action === 'fight', 'shooting is fine');
});

test('safety: refusals', () => {
    const z = base({ mobs: [mob('zombie', 1, 1)] });
    assert.deepEqual(safety(z, { action: 'ignore', target: -1, weapon: null }), { ok: false, veto: 'ignore-threat' });
    assert.deepEqual(safety(z, { action: 'eat', target: -1, weapon: null }), { ok: false, veto: 'no-apple' });
    assert.deepEqual(safety(z, { action: 'fight', target: -1, weapon: 'stone_sword' }), { ok: false, veto: 'no-target' });
    assert.deepEqual(safety({ ...z, arrows: 0 }, { action: 'fight', target: 0, weapon: 'bow' }), { ok: false, veto: 'no-arrows' });
    const ok = safety(z, { action: 'fight', target: 0, weapon: 'diamond_sword' }); // not carried: bare hand
    assert.ok(ok.ok);
    assert.equal(ok.answer.weapon, null);
    assert.equal(ok.answer.target, 0);
});

function reply(action: string, target: string, weapon: string, p = 0.9): DecideResult {
    const choice = (top: string) => ({ type: 'choice' as const, top, topProbability: p, confident: p >= 0.4, probabilities: { [top]: p } });
    return { model: 'defend-a', ms: 3, answers: { Action: choice(action), Target: choice(target), Weapon: choice(weapon),
        Danger: { type: 'noul', probability: 0.8, top: 'true', topProbability: 0.8, confident: true } } };
}
function fake(r: DecideResult | null): ModelDecider & { asked: number } {
    const f = { asked: 0, decide: async () => { f.asked++; return r; } };
    return f;
}

test('decideDefend: a confident safe answer is acted on and logged with the model\'s words', async () => {
    const d = await decideDefend(base({ mobs: [mob('zombie', 2, 0)] }), fake(reply('fight', 'zombie 1', 'stone_sword')));
    assert.deepEqual([d.answer, d.source, d.target, d.targetWord, d.weapon, d.danger, d.p], ['fight', 'model', 0, 'zombie 1', 'stone_sword', 0.8, 0.9]);
    assert.deepEqual(d.asked, { action: 'fight', target: 'zombie 1', weapon: 'stone_sword', p: 0.9, danger: 0.8, ms: 3, model: 'defend-a' });
    assert.match(d.state, /^Defend\.\n/);
});

test('decideDefend: no answer, low confidence, malformed or a veto fall back to the rules (not the modes)', async () => {
    const sit = base({ mobs: [mob('zombie', 2, 0)] });
    for (const [r, why] of [[null, 'no-answer'], [reply('fight', 'zombie 1', 'none', 0.2), 'low-confidence'],
        [reply('ignore', 'none', 'none'), 'veto'], [reply('dance', 'zombie 1', 'none'), 'malformed'], [reply('fight', 'zombie 9', 'none'), 'malformed']] as const) {
        const d = await decideDefend(sit, fake(r));
        assert.deepEqual([d.source, d.why, d.answer, d.rule, d.target, d.weapon], ['rules', why, 'fight', 'melee', 0, 'stone_sword'], why);
    }
    const v = await decideDefend(sit, fake(reply('ignore', 'none', 'none')));
    assert.equal(v.veto, 'ignore-threat');
    assert.equal(v.model, 'ignore');
});

test('decideDefend: the creeper override flees; eat and backoff run; spiders by day are calm and not asked', async () => {
    const c = await decideDefend(base({ mobs: [mob('creeper', 2, 1)] }), fake(reply('fight', 'creeper 1', 'stone_sword')));
    assert.deepEqual([c.answer, c.source, c.override, c.weapon], ['flee', 'model', 'creeper', null]);
    const b = await decideDefend(base({ mobs: [mob('creeper', 2, 1)] }), fake(reply('backoff', 'creeper 1', 'none')));
    assert.deepEqual([b.answer, b.override], ['backoff', undefined]);
    const e = await decideDefend(base({ health: 5, apples: 1, mobs: [mob('zombie', 6, 0)] }), fake(reply('eat', 'none', 'none')));
    assert.deepEqual([e.answer, e.source, e.target], ['eat', 'model', -1]);
    const f = fake(reply('fight', 'spider 1', 'none'));
    const sp = await decideDefend(base({ night: false, mobs: [mob('spider', 2, 0)] }), f);
    assert.deepEqual([sp.answer, sp.rule, sp.source, sp.danger, f.asked], ['ignore', 'calm', 'rules', 0, 0]);
});

test('rules: laya-go rules_test cases and Harmful', () => {
    const strong = base({ armor: 20, weapons: ['iron_sword'], arrows: 0 });
    const plain = base({ weapons: [], arrows: 0 });
    const cases: [DefendSituation, ReturnType<typeof decide>][] = [
        [plain, { action: 'ignore', target: -1, weapon: null, rule: 'calm' }],
        [{ ...plain, night: false, mobs: [mob('spider', 2, 0)] }, { action: 'ignore', target: -1, weapon: null, rule: 'calm' }],
        [{ ...plain, mobs: [mob('spider', 2, 0)] }, { action: 'fight', target: 0, weapon: null, rule: 'melee' }],
        [{ ...plain, weapons: ['stone_sword'], mobs: [mob('creeper', 2, 1)] }, { action: 'flee', target: 0, weapon: null, rule: 'creeper-near' }],
        [{ ...strong, mobs: [mob('creeper', 2, 1)] }, { action: 'fight', target: 0, weapon: 'iron_sword', rule: 'creeper-strong' }],
        [{ ...strong, mobs: [mob('creeper', 2, 1), mob('zombie', 5, 0)] }, { action: 'flee', target: 0, weapon: null, rule: 'creeper-near' }],
        [{ ...plain, weapons: ['bow'], arrows: 5, mobs: [mob('creeper', 6, 0)] }, { action: 'fight', target: 0, weapon: 'bow', rule: 'creeper-shoot' }],
        [{ ...plain, mobs: [mob('creeper', 6, 0)] }, { action: 'backoff', target: 0, weapon: null, rule: 'creeper-away' }],
        [{ ...plain, health: 5, apples: 1, mobs: [mob('zombie', 6, 0)] }, { action: 'eat', target: -1, weapon: null, rule: 'low-eat' }],
        [{ ...plain, health: 5, apples: 1, mobs: [mob('zombie', 2, 0)] }, { action: 'backoff', target: 0, weapon: null, rule: 'low-backoff' }],
        [{ ...plain, health: 5, mobs: [mob('skeleton', 10, 0)] }, { action: 'flee', target: 0, weapon: null, rule: 'low-flee' }],
        [{ ...plain, health: 12, weapons: ['iron_sword'], mobs: [mob('zombie', 2, 0), mob('zombie', -3, 0), mob('husk', 0, 4)] }, { action: 'flee', target: 0, weapon: null, rule: 'outnumbered' }],
        [{ ...plain, health: 12, armor: 10, weapons: ['iron_sword'], mobs: [mob('zombie', 2, 0), mob('zombie', -3, 0), mob('husk', 0, 4)] }, { action: 'fight', target: 0, weapon: 'iron_sword', rule: 'melee' }],
        [{ ...plain, health: 12, playerNear: true, weapons: ['iron_sword'], mobs: [mob('zombie', 2, 0), mob('zombie', -3, 0), mob('husk', 0, 4)] }, { action: 'fight', target: 0, weapon: 'iron_sword', rule: 'melee' }],
        [{ ...plain, weapons: ['iron_sword', 'bow'], arrows: 9, mobs: [mob('skeleton', 10, 0)] }, { action: 'fight', target: 0, weapon: 'bow', rule: 'shoot' }],
        [{ ...plain, weapons: ['iron_sword'], shield: true, mobs: [mob('skeleton', 10, 0)] }, { action: 'shield', target: 0, weapon: 'iron_sword', rule: 'close-in' }],
        [{ ...plain, weapons: ['iron_sword'], mobs: [mob('skeleton', 10, 0)] }, { action: 'fight', target: 0, weapon: 'iron_sword', rule: 'close-in' }],
        [{ ...strong, mobs: [mob('zombie', 5, 0), mob('witch', 5, 1)] }, { action: 'fight', target: 1, weapon: 'iron_sword', rule: 'melee' }],
        [{ ...strong, mobs: [mob('zombie', 2, 0), mob('witch', 5, 1)] }, { action: 'fight', target: 0, weapon: 'iron_sword', rule: 'melee' }],
        [{ ...strong, mobs: [mob('zombie', 2, 0, 20), mob('zombie', 0, 2, 5)] }, { action: 'fight', target: 1, weapon: 'iron_sword', rule: 'melee' }],
        [{ ...plain, weapons: ['wooden_sword', 'bow'], arrows: 20, mobs: [mob('zombie', 6, 0)] }, { action: 'backoff', target: 0, weapon: 'bow', rule: 'kite' }],
        [{ ...plain, weapons: ['wooden_sword', 'stone_axe'], mobs: [mob('zombie', 2, 0)] }, { action: 'fight', target: 0, weapon: 'stone_axe', rule: 'melee' }],
        [{ ...plain, weapons: ['diamond_axe', 'iron_sword'], mobs: [mob('zombie', 2, 0)] }, { action: 'fight', target: 0, weapon: 'iron_sword', rule: 'melee' }],
    ];
    for (const [sit, want] of cases) assert.deepEqual(decide(sit), want, defendState(sit));
    const cr = { ...plain, mobs: [mob('creeper', 2, 0)] };
    const want = decide(cr);
    assert.ok(harmful(cr, want, 'fight', 0) && harmful(cr, want, 'ignore', -1) && !harmful(cr, want, 'flee', 0) && !harmful(cr, want, 'backoff', 0));
});

interface DefendRow { state: string; questions: unknown; action: string; target: string; weapon: string; rule: string; danger: boolean }

// parseDefend reads a defend state back to a situation (laya-go prompt.ParseState).
function parseDefend(text: string): DefendSituation {
    const L = text.split('\n');
    const st = /^Health (\d+) Food (\d+) Armor (\d+) Night (yes|no) Player (yes|no)$/.exec(L[1] ?? '');
    const gear = /^Arrows (\d+) Shield (yes|no) Apples (\d+)$/.exec(L[3] ?? '');
    assert.ok(st && gear, text);
    const w = (L[2] ?? '').split(' ').slice(1);
    const weapons: WeaponName[] = w.length === 1 && w[0] === 'none' ? [] : w.map(n => { assert.ok(isWeapon(n), n); return n; });
    const m = (L[4] ?? '').split(' ').slice(1);
    const mobs: DefendMob[] = [];
    if (!(m.length === 1 && m[0] === 'none')) {
        for (let i = 0; i < m.length; i += 4) {
            const [kind = '', x = '', z = '', h = ''] = m.slice(i, i + 4);
            assert.ok(isDefendKind(kind), kind);
            const dx = Number(x.slice(1)) * (x[0] === 'W' ? -1 : 1), dz = Number(z.slice(1)) * (z[0] === 'N' ? -1 : 1);
            mobs.push({ kind, dx, dz, health: Number(h.slice(1)) });
        }
    }
    return { health: Number(st[1]), food: Number(st[2]), armor: Number(st[3]), night: st[4] === 'yes', playerNear: st[5] === 'yes',
        weapons, arrows: Number(gear[1]), shield: gear[2] === 'yes', apples: Number(gear[3]), mobs };
}

test('renderer, questions and rules agree with laya-go on 1000 generated situations (3a8fe4c, seed 7)', () => {
    const rows = fixture('laya-defend-v1/decisions.jsonl').trim().split('\n').map(l => JSON.parse(l) as DefendRow);
    assert.equal(rows.length, 1000);
    const seen = new Set<string>();
    for (const r of rows) {
        const sit = parseDefend(r.state);
        assert.equal(defendState(sit), r.state, 'state round trip');
        assert.equal(JSON.stringify(defendQuestions(sit)), JSON.stringify(r.questions), r.state);
        const d = decide(sit);
        assert.deepEqual({ action: d.action, target: targetWord(sit, d.target), weapon: d.weapon ?? 'none', rule: d.rule },
            { action: r.action, target: r.target, weapon: r.weapon, rule: r.rule }, r.state);
        assert.equal(d.rule !== 'calm', r.danger, 'danger');
        seen.add(r.rule);
    }
    assert.deepEqual([...seen].sort(), [...RULES].sort(), 'every rule is exercised');
});
