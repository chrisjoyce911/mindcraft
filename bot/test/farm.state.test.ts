// 5.3 the farm state and rules (a port of test/laya_farm.test.js's pure tests): laya-go's golden v1, v2 and barren
// requests byte for byte (the repo fixtures and laya-go's own testdata, when that checkout is here), the rules on
// laya-go's 400 generated v1 and v2 situations (answer, rule, Target and Item options), cells, carry and herds, the
// veto, the needed items, the unload keep rule, the v2 lines, the pond checks and v2.1's nearestDry.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    state, stateV2, questions, questionsV2, targetOptions, cellName, parseCellName, carried, herds, decide, veto, needed, farmKeep,
    farmValuables, hasWater, nearestDry, pack, readFarmAnswer, decideFarmStep, unloadRule, wantUnload, depositList, BY_DISTANCE,
    type FarmSituation, type FarmView, type FarmCrop, type Grid, type Carry, type Herd, type FarmItem, type AnimalKind,
} from '../src/models/farm/index.js';
import { sample, plateau, ANIMALS, Y0, reply } from './farmfake.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (f: string) => fs.readFileSync(path.join(REPO, 'test/fixtures', f), 'utf8');
const LAYA_GO = path.join(os.homedir(), 'lnkz/laya-go/games/farm/prompt/testdata');
const json = (s: string) => JSON.parse(s) as { state: string; questions: unknown };
const golden = json(fixture('laya-farm-v1/request.json'));
const goldenV2 = json(fixture('laya-farm-v2/request.json'));
const barrenV2 = json(fixture('laya-farm-v2/barren_request.json'));
const plain = (q: unknown) => JSON.parse(JSON.stringify(q)) as unknown;

test('golden v1 state and questions: match laya-go byte for byte', () => {
    const s = sample();
    assert.equal(state(s), golden.state);
    assert.deepEqual(plain(questions(s)), golden.questions);
    assert.equal(s.ys[4]![4], Y0);
    assert.equal(s.ys[1]![1], Y0, 'a crop cell is its farmland');
});

test('golden v2 state and questions: match laya-go byte for byte', () => {
    const s: FarmSituation = { ...sample(), crop: 'carrots', pack: pack({ free: 5, home: 12, health: 20, food: 18, hostiles: 0, valuables: 6 }) };
    assert.equal(stateV2(s as Required<FarmSituation>), goldenV2.state);
    assert.deepEqual(plain(questionsV2(s)), goldenV2.questions);
    assert.equal(decide(s).rule, 'harvest');
});

test('golden v2 barren plateau (the trial): find_water, by the rules too; a water bucket makes a pond', () => {
    const s: FarmSituation = { ...plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]), crop: 'wheat', pack: pack({ free: 30 }) };
    assert.equal(stateV2(s as Required<FarmSituation>), barrenV2.state);
    assert.deepEqual(plain(questionsV2(s)), barrenV2.questions);
    assert.deepEqual(decide(s), { action: 'find_water', target: 'none', item: 'none', rule: 'find_water' });
    const wet = { ...s, carry: [...s.carry, { item: 'water_bucket' as const, count: 1 }] };
    assert.deepEqual(decide(wet), { action: 'pond', target: 'E0 N1', item: 'water_bucket', rule: 'pond' });
});

test('the fixtures are laya-go\'s own testdata (no drift), when that checkout is here', { skip: !fs.existsSync(LAYA_GO) }, () => {
    for (const [mine, theirs] of [['laya-farm-v1/request.json', 'v1_sample_request.json'], ['laya-farm-v2/request.json', 'v2_sample_request.json'],
        ['laya-farm-v2/barren_request.json', 'v2_barren_request.json']] as const)
        assert.equal(fixture(mine), fs.readFileSync(path.join(LAYA_GO, theirs), 'utf8'), theirs);
});

test('cell names, carry and herds', () => {
    assert.equal(cellName(2, 3), 'W2 N1');
    assert.equal(cellName(4, 4), 'E0 S0');
    assert.deepEqual(parseCellName('W2 N1'), { x: 2, z: 3 });
    assert.equal(parseCellName('E5 S0'), null);
    assert.equal(parseCellName('cow'), null);
    assert.deepEqual(carried([{ name: 'wooden_hoe', count: 1 }, { name: 'stone_hoe', count: 1 }, { name: 'wheat', count: 2 }]),
        [{ item: 'hoe', count: 2 }, { item: 'wheat', count: 2 }]);
    assert.deepEqual(herds(ANIMALS, 4, 4), [{ kind: 'cow', count: 2 }, { kind: 'pig', count: 3 }]);
    assert.deepEqual(BY_DISTANCE.slice(0, 5), [{ x: 4, z: 4 }, { x: 4, z: 3 }, { x: 3, z: 4 }, { x: 5, z: 4 }, { x: 4, z: 5 }]);
});

test('veto', () => {
    const s = sample();
    assert.equal(veto(s, 'harvest', 'W2 N1', 'none'), null);
    assert.equal(veto(s, 'harvest', 'W1 N1', 'none'), 'not-ripe');
    assert.equal(veto(s, 'plant', 'E1 N2', 'wheat_seeds'), null);
    assert.equal(veto(s, 'plant', 'E1 N2', 'hoe'), 'not-a-seed');
    assert.equal(veto(s, 'till', 'W1 S0', 'hoe'), null);
    assert.equal(veto(s, 'till', 'E0 S0', 'hoe'), 'not-tillable');
    assert.equal(veto(s, 'water', 'E1 N2', 'water_bucket'), 'not-dry-farmland');
    assert.equal(veto(s, 'bone_meal', 'W1 N1', 'bone_meal'), null);
    assert.equal(veto(s, 'breed', 'pig', 'carrot'), null);
    assert.equal(veto(s, 'breed', 'pig', 'wheat'), 'wrong-food');
    assert.equal(veto(s, 'breed', 'sheep', 'wheat'), 'no-pair');
    assert.equal(veto(s, 'harvest', 'nowhere', 'none'), 'no-cell');
    assert.ok(targetOptions(s).includes('W2 N1'));
});

test('needed items', () => {
    const s = sample();
    assert.equal(needed(s, 'till', 'none'), null);
    assert.equal(needed(s, 'water', 'none'), 'water_bucket');
    assert.equal(needed(s, 'plant', 'potato'), 'potato');
    assert.equal(needed(s, 'harvest', 'none'), null);
});

test('keep and valuables when unloading', () => {
    const keep = farmKeep(n => ['bread', 'carrot', 'potato', 'beetroot'].includes(n), 16);
    assert.equal(keep('iron_hoe', 1), 1);
    assert.equal(keep('water_bucket', 1), 1);
    assert.equal(keep('bucket', 1), 1);
    assert.equal(keep('bread', 5), 5);
    assert.equal(keep('wheat_seeds', 40), 16);
    assert.equal(keep('carrot', 40), 16, 'carrots are seeds: keep 16 though they are food');
    assert.equal(keep('wheat', 40), 0);
    assert.equal(keep('beetroot', 9), 0, 'produce goes even when it is food');
    assert.equal(keep('cobblestone', 9), 0);
    assert.equal(farmValuables({ wheat: 10, carrot: 20, wheat_seeds: 30, bread: 2 }, keep), 14);
    assert.deepEqual(depositList({ iron_hoe: 1, wheat: 60, wheat_seeds: 40, bread: 2, bucket: 1, dirt: 5 }, farmKeep(n => n === 'bread', 16)),
        [{ name: 'wheat', count: 60 }, { name: 'wheat_seeds', count: 24 }, { name: 'dirt', count: 5 }]);
});

test('v2 state: Crop and Pack after Farm., Unload asked; the pack line in range', () => {
    const s = { ...sample(), crop: 'wheat' as FarmCrop, pack: pack({ free: 5, home: 12 }) };
    const lines = stateV2(s).split('\n');
    assert.deepEqual(lines.slice(0, 3), ['Farm.', 'Crop wheat', 'Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0']);
    assert.equal(lines.length, 14);
    const q = questionsV2(s);
    assert.deepEqual(q.Action!.criteria, ['harvest', 'plant', 'till', 'water', 'pond', 'bone_meal', 'breed', 'find_water', 'wait']);
    assert.equal(q.Unload!.type, 'noul');
    assert.deepEqual(pack({ free: 40, home: 5000, health: 19.6, food: -2, hostiles: 12, valuables: 1200 }),
        { free: 36, home: 999, health: 20, food: 0, hostiles: 9, valuables: 999 });
    assert.equal(pack({ home: 0.2 }).home, 1, 'a known chest is never Home 0 (laya-go reads 0 as none)');
});

test('rules: the golden farm harvests first; the plateau has no water', () => {
    assert.equal(decide(sample()).action, 'harvest');
    assert.equal(hasWater(plateau([]).grid), false);
});

test('Unload: the rule, the model when sure, always when full, never without a home chest', () => {
    assert.equal(unloadRule(pack({ free: 2, home: 100 })), true);
    assert.equal(unloadRule(pack({ free: 6, home: 24 })), true);
    assert.equal(unloadRule(pack({ free: 6, home: 25 })), false);
    assert.equal(unloadRule(pack({ free: 20, home: 50, valuables: 4, hostiles: 2 })), true);
    assert.equal(unloadRule(pack({ free: 20, home: null })), false);
    assert.equal(wantUnload(pack({ free: 0, home: 50 }), { probability: 0.1, confident: true }), true);
    assert.equal(wantUnload(pack({ free: 20, home: 50 }), { probability: 0.9, confident: true }), true);
    assert.equal(wantUnload(pack({ free: 1, home: 50 }), { probability: 0.1, confident: true }), false, 'the model when sure');
    assert.equal(wantUnload(pack({ free: 1, home: 50 }), { probability: 0.1, confident: false }), true, 'else the rule');
    assert.equal(wantUnload(pack({ free: 0, home: null }), undefined), false);
});

// parseFarmState reads a v1 or v2 state text back to a situation (as laya-go prompt.ParseState does).
function parseFarmState(text: string): FarmSituation {
    const L = text.split('\n');
    const s: FarmSituation = { grid: [], ys: [], carry: [], animals: [] };
    let i = 1;
    if (L[1]!.startsWith('Crop ')) {
        const f = L[2]!.split(' ');
        s.crop = L[1]!.slice(5) as FarmCrop;
        s.pack = pack({ free: +f[1]!, home: f[3] === 'none' ? null : +f[3]!, health: +f[5]!, food: +f[7]!, hostiles: +f[9]!, valuables: +f[11]! });
        i = 3;
    }
    const c = L[i]!.split(' ').slice(1), a = L[i + 1]!.split(' ').slice(1);
    if (c[0] !== 'none') for (let k = 0; k < c.length; k += 2) (s.carry as Carry[]).push({ item: c[k] as FarmItem, count: +c[k + 1]!.slice(1) });
    if (a[0] !== 'none') for (let k = 0; k < a.length; k += 2) (s.animals as Herd[]).push({ kind: a[k] as AnimalKind, count: +a[k + 1]! });
    s.grid = L.slice(i + 2).map(r => [...r]) as Grid;
    return s;
}

interface Case { state: string; action: string; target: string; item: string; rule: string; targets: string[]; items: string[] }

test('rules port agrees with laya-go on 400 generated v1 and v2 situations', () => {
    const cases = fixture('laya-farm-v2/decisions.jsonl').trim().split('\n').map(l => JSON.parse(l) as Case);
    assert.equal(cases.length, 400);
    const seen = new Set<string>();
    for (const d of cases) {
        const s = parseFarmState(d.state);
        assert.equal(s.crop ? stateV2(s as Required<FarmSituation>) : state(s), d.state);
        assert.deepEqual(decide(s), { action: d.action, target: d.target, item: d.item, rule: d.rule }, d.state);
        assert.deepEqual(targetOptions(s), d.targets, d.state);
        assert.deepEqual(questions(s).Item!.criteria, d.items);
        seen.add(d.rule);
    }
    for (const r of ['harvest', 'water', 'plant-crop', 'replant', 'plant', 'till', 'pond', 'find_water', 'breed', 'bone_meal', 'wait']) assert.ok(seen.has(r), r);
});

test('pond veto: only dry ground, not beside a hole or water', () => {
    assert.equal(veto(sample(), 'pond', 'E4 N4', 'water_bucket'), null);
    assert.equal(veto(sample(), 'pond', 'W3 N3', 'water_bucket'), 'not-dry-ground');
    const s = plateau([]);
    s.ys[3]![4] = Y0 - 1; // a hole dug at E0 N1
    assert.equal(veto(s, 'pond', cellName(3, 3), 'water_bucket'), 'beside-hole');
    assert.equal(veto(s, 'pond', cellName(2, 3), 'water_bucket'), null);
    s.grid[6]![6] = 'W';
    assert.equal(veto(s, 'pond', cellName(6, 5), 'water_bucket'), 'beside-hole');
});

test('v2.1 nearestDry: a pond never goes beside an X (a dug hole) unless every dry cell has one', () => {
    const row = (r: string) => [...r] as Grid[number];
    let grid = ['GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGLXGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGLGGGGGG', 'GGGGGGGGG'].map(row);
    assert.deepEqual(nearestDry(grid), { x: 2, z: 7 });
    grid = ['GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGLXGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG'].map(row);
    assert.deepEqual(nearestDry(grid), { x: 5, z: 4 }, 'every dry cell has one: the nearest');
});

test('the answer: typed; a malformed reply is no answer; sure needs Action and Target confident', () => {
    const r = readFarmAnswer(reply('harvest', 'W2 N1', 'none'));
    assert.deepEqual(r, { action: 'harvest', target: 'W2 N1', item: 'none', p: 0.9, sure: true, ms: 3 });
    assert.equal(readFarmAnswer(reply('dance', 'W2 N1', 'none')), null);
    assert.equal(readFarmAnswer(null), null);
    const unsure = reply('harvest', 'W2 N1', 'none');
    unsure.answers.Target = { ...unsure.answers.Target!, confident: false } as never;
    assert.equal(readFarmAnswer(unsure)!.sure, false);
});

test('decideFarmStep: model, rules, low-confidence, ban, dry pond / find_water, seed swap, missing, veto', () => {
    const none = () => false;
    const s = sample();
    const d = (asked: ReturnType<typeof readFarmAnswer>, o: { v2?: boolean; crop?: FarmCrop; s?: FarmView; banned?: (a: string, t: string) => boolean } = {}) =>
        decideFarmStep({ s: o.s ?? s, asked, v2: o.v2 ?? false, crop: o.crop ?? 'any', isBanned: o.banned ?? none });
    assert.deepEqual(d(readFarmAnswer(reply('harvest', 'W2 N1', 'none'))), { kind: 'act', action: 'harvest', target: 'W2 N1', item: 'none', use: 'none',
        source: 'model', ruled: false, said: { p: 0.9, ms: 3 }, missing: null, veto: null });
    const low = d(readFarmAnswer(reply('harvest', 'W2 N1', 'none', 0.3)));
    assert.equal(low.kind, 'wait');
    assert.equal(low.source, 'low-confidence');
    assert.deepEqual(low.said, { model_action: 'harvest', p: 0.3, ms: 3 });
    const ruled = d(null, { v2: true });
    assert.deepEqual([ruled.action, ruled.target, ruled.source, ruled.ruled], ['harvest', 'W2 N1', 'rules', true]);
    const banned = d(readFarmAnswer(reply('till', 'E0 S0', 'hoe')), { banned: (a, t) => a === 'till' && t === 'E0 S0' });
    assert.deepEqual([banned.action, banned.target, banned.source, banned.banned], ['harvest', 'W2 N1', 'banned', 'till E0 S0']);
    assert.equal(d(readFarmAnswer(reply('till', 'E0 S0', 'hoe'))).veto, 'not-tillable');
    const swap = d(readFarmAnswer(reply('plant', 'E1 N2', 'wheat_seeds')), { crop: 'carrots' });
    assert.deepEqual([swap.item, swap.use], ['wheat_seeds', 'carrot'], 'the answer is logged; the crop\'s seed is planted');
    assert.equal(d(readFarmAnswer(reply('water', 'E1 N2', 'none'))).missing, 'water_bucket');
    const dry = plateau([{ item: 'hoe', count: 1 }, { item: 'water_bucket', count: 1 }]);
    const pond = d(readFarmAnswer(reply('wait', 'none', 'none')), { s: dry });
    assert.deepEqual([pond.kind, pond.action, pond.target, pond.use, pond.source], ['act', 'pond', 'E0 N1', 'water_bucket', 'dry']);
    const find = d(readFarmAnswer(reply('wait', 'none', 'none')), { s: plateau([]) });
    assert.deepEqual([find.kind, find.action, find.target], ['find_water', 'find_water', 'none']);
});
