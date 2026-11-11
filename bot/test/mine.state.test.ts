// 5.2 the mine state and rules (a port of test/laya_mine_state.test.js and test/laya_mine_v2.test.js): laya-go's
// golden v1 and v2 requests byte for byte (the repo fixtures and laya-go's own testdata, when that checkout is
// here), the rules on 300 generated situations each (v1; v2 with Hazard and Unload), cells, headings, pickaxes, the
// v2 lines, rule 5 and the Unload truth.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    readView, state, QUESTIONS, QUESTIONS_V2, ORES, decide, unsafe, hazard, touching, cellOf, headingOf, pickTier, ACTIONS,
    unload, valuables, homeDistance, TIERS, readMine, isMineAction, moveOf,
    type MineSituation, type View, type Tier, type Ore, type Dir, type MoveAction,
} from '../src/models/mine/index.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (f: string) => fs.readFileSync(path.join(REPO, 'test/fixtures', f), 'utf8');
const LAYA_GO = path.join(os.homedir(), 'lnkz/laya-go/games/mine/prompt/testdata');

const STONE = { name: 'stone', boundingBox: 'block' };
const AIR = { name: 'air', boundingBox: 'empty' };
const LAVA = { name: 'lava', boundingBox: 'empty' };

// The golden scene (laya-go games/mine/prompt sample): feet at (0, 41, 0) in a tunnel heading east, lava two blocks
// east at feet and floor, a small cave to the north-west.
function goldenWorld(lava = ['2,41,0', '2,40,0']) {
    const air = new Set(['0,42,0', '0,41,0', '-1,42,0', '-1,41,0', '-2,42,0', '-2,41,0', '-2,43,-2', '-2,42,-2', '-1,42,-2']);
    const l = new Set(lava);
    return (x: number, y: number, z: number) => {
        const k = `${x},${y},${z}`;
        return air.has(k) ? AIR : l.has(k) ? LAVA : STONE;
    };
}

function goldenSituation(): MineSituation {
    return { ore: 'iron', y: 41, pick: 2, torches: 6, blocks: 20, dark: 7, heading: 'E', seen: 0,
        view: readView(goldenWorld(), 0, 41, 0, ORES.iron.blocks) };
}

const v2situation = (extra: Partial<MineSituation> = {}): MineSituation => ({ ...goldenSituation(), plan: 'tunnel E', free: 5, home: 12,
    health: 20, food: 20, hostiles: 0, valuables: 0, ...extra });

const json = (v: unknown) => JSON.parse(JSON.stringify(v));

test('golden mine state v1: matches laya-go byte for byte', () => {
    const golden = JSON.parse(fixture('laya-mine-v1/request.json'));
    const s = goldenSituation();
    assert.equal(state(s), golden.state);
    assert.deepEqual(json(QUESTIONS), golden.questions);
});

test('golden requests: the repo fixtures are laya-go\'s testdata (v1 and v2), when laya-go is checked out here', t => {
    if (!fs.existsSync(LAYA_GO)) { t.skip('no laya-go checkout'); return; }
    for (const v of ['v1', 'v2']) {
        const go = JSON.parse(fs.readFileSync(path.join(LAYA_GO, `${v}_sample_request.json`), 'utf8'));
        const ours = JSON.parse(fixture(`laya-mine-${v}/request.json`));
        assert.deepEqual(go, ours, v);
        assert.equal(state(v === 'v1' ? goldenSituation() : v2situation()), go.state, v);
        assert.deepEqual(json(v === 'v1' ? QUESTIONS : QUESTIONS_V2), go.questions, v);
    }
});

test('rules port: the golden answer, safety and hazard', () => {
    const s = goldenSituation();
    assert.deepEqual(decide(s), { action: 'down S', rule: 'go-down' });
    assert.equal(unsafe(s.view, moveOf('down E')), 'fluid behind');
    assert.equal(unsafe(s.view, moveOf('tunnel E')), 'fluid behind');
    assert.equal(unsafe(s.view, moveOf('tunnel S')), '');
    assert.equal(hazard(s.view), false);
    assert.equal(decide({ ...s, pick: 1 }).action, 'stop');
    assert.equal(decide({ ...s, seen: 5 }).action, 'collect');
    assert.equal(decide({ ...s, dark: 8 }).action, 'torch');
    assert.equal(decide({ ...s, y: 16 }).action, 'tunnel S');
    assert.equal(decide({ ...s, y: 0 }).action, 'up E');
    s.view[2]![2]![3] = 'L'; // lava touching andy's feet to the east
    assert.equal(hazard(s.view), true);
    assert.deepEqual(touching(s.view), [[2, 1, 0]]);
    assert.deepEqual(decide(s), { action: 'block', rule: 'block-fluid' });
    assert.equal(decide({ ...s, blocks: 0 }).action, 'down S');
    assert.equal(ACTIONS.length, 16);
});

test('cells, headings and pickaxes', () => {
    assert.equal(cellOf(null, []), 'S');
    assert.equal(cellOf({ name: 'deepslate_iron_ore', boundingBox: 'block' }, ORES.iron.blocks), 'O');
    assert.equal(cellOf({ name: 'deepslate_iron_ore', boundingBox: 'block' }, ORES.gold.blocks), 'S');
    assert.equal(cellOf({ name: 'water', boundingBox: 'empty' }, []), 'W');
    assert.equal(cellOf({ name: 'bedrock', boundingBox: 'block' }, []), 'B');
    assert.equal(cellOf({ name: 'torch', boundingBox: 'empty' }, []), 'A');
    assert.equal(headingOf(0), 'N');
    assert.equal(headingOf(Math.PI / 2), 'W');
    assert.equal(headingOf(-Math.PI / 2), 'E');
    assert.equal(headingOf(Math.PI), 'S');
    assert.equal(pickTier({ stone_pickaxe: 1, wooden_pickaxe: 2 }), 2);
    assert.equal(pickTier({}), 0);
});

const viewOf = (rows: string[]): View => [0, 1, 2, 3, 4].map(l => rows.map(row => [...row.split(' ')[l]!] as View[number][number]));

/** parse reads a prompt v1 state back to a situation (for the cross-check). */
function parse(text: string): MineSituation {
    const lines = text.split('\n');
    const [, ore, , y, , pick, , torches, , blocks, , dark, , heading] = lines[1]!.split(' ');
    const seen = lines[2] === 'Seen none' ? 0 : Number(lines[2]!.split(' ')[1]);
    return { ore: ore as Ore, y: Number(y), pick: (TIERS as readonly string[]).indexOf(pick!) as Tier, torches: Number(torches),
        blocks: Number(blocks), dark: Number(dark), heading: heading as Dir, seen, view: viewOf(lines.slice(3)) };
}

/** parseV2 reads a v2 state back to a situation. */
function parseV2(text: string): MineSituation {
    const lines = text.split('\n');
    const [, ore, , y, , pick, , torches, , blocks, , dark, , heading] = lines[1]!.split(' ');
    const plan = lines[2]!.slice('Plan '.length) as MoveAction;
    const [, free, , home, , health, , food, , hostiles, , vals] = lines[3]!.split(' ');
    const seen = lines[4] === 'Seen none' ? 0 : Number(lines[4]!.split(' ')[1]);
    return { ore: ore as Ore, y: Number(y), pick: (TIERS as readonly string[]).indexOf(pick!) as Tier, torches: Number(torches),
        blocks: Number(blocks), dark: Number(dark), heading: heading as Dir, plan, free: Number(free), home: home === 'none' ? null : Number(home),
        health: Number(health), food: Number(food), hostiles: Number(hostiles), valuables: Number(vals), seen, view: viewOf(lines.slice(5)) };
}

test('rules port agrees with laya-go on 300 generated v1 situations', () => {
    const rows = fixture('laya-mine-v1/decisions.jsonl').trim().split('\n').map(l => JSON.parse(l) as { state: string; action: string; hazard: boolean });
    assert.equal(rows.length, 300);
    for (const r of rows) {
        const s = parse(r.state);
        assert.equal(state(s), r.state, 'state round trip');
        assert.equal(decide(s).action, r.action, r.state);
        assert.equal(hazard(s.view), r.hazard, r.state);
    }
});

test('v2 state: the plan and pack lines after the status line', () => {
    const lines = state(v2situation()).split('\n');
    assert.equal(lines[1], 'Ore iron Y 41 Pick stone Torches 6 Blocks 20 Dark 7 Heading E');
    assert.equal(lines[2], 'Plan tunnel E');
    assert.equal(lines[3], 'Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0');
    assert.equal(lines[4], 'Seen none');
    assert.equal(lines.length, 10);
    assert.equal(state(v2situation({ home: null, hostiles: 12, valuables: 5000 })).split('\n')[3],
        'Pack 5 Home none Health 20 Food 20 Hostiles 9 Valuables 999');
    assert.equal(state({ ...v2situation(), plan: null }).split('\n')[2], 'Seen none', 'no plan: prompt v1');
    assert.deepEqual(Object.keys(QUESTIONS_V2), ['Action', 'Hazard', 'Unload']);
    assert.equal(QUESTIONS_V2.Unload.instructions, 'I should go and empty my pack into the home chest now.');
});

test('golden v2 mine state: matches laya-go byte for byte', () => {
    const golden = JSON.parse(fixture('laya-mine-v2/request.json'));
    assert.equal(state(v2situation()), golden.state);
    assert.equal(state(parseV2(golden.state)), golden.state);
    assert.deepEqual(json(QUESTIONS_V2), golden.questions);
});

// decisions.jsonl: 300 laya-go v2 situations (generate.PlanSituations(7, 300)) with rules.Decide, Hazard and Unload
test('v2 rules port agrees with laya-go on 300 generated situations', () => {
    const rows = fixture('laya-mine-v2/decisions.jsonl').trim().split('\n')
        .map(l => JSON.parse(l) as { state: string; action: string; rule: string; hazard: boolean; unload: boolean });
    assert.equal(rows.length, 300);
    for (const r of rows) {
        const s = parseV2(r.state);
        assert.equal(state(s), r.state, 'state round trip');
        assert.deepEqual(decide(s), { action: r.action, rule: r.rule }, r.state);
        assert.equal(hazard(s.view), r.hazard, r.state);
        assert.equal(unload(s), r.unload, r.state);
    }
});

test('v2 rule 5: follow the plan when safe, else detour; ore, fluid and torches first', () => {
    assert.deepEqual(decide(v2situation({ plan: 'tunnel S' })), { action: 'tunnel S', rule: 'follow-plan' });
    assert.deepEqual(decide(v2situation({ plan: 'down S' })), { action: 'down S', rule: 'follow-plan' });
    // the plan step has lava behind it: the plan's kind right (S), then left (N)...
    assert.deepEqual(decide(v2situation({ plan: 'tunnel E' })), { action: 'tunnel S', rule: 'detour' });
    assert.deepEqual(decide(v2situation({ plan: 'down E' })), { action: 'down S', rule: 'detour' });
    assert.equal(decide(v2situation({ plan: 'down S', seen: 3 })).action, 'collect');
    assert.equal(decide(v2situation({ plan: 'down S', dark: 8 })).action, 'torch');
    // never down below the lowest height
    assert.notEqual(decide(v2situation({ plan: 'down S', y: -59 })).action.split(' ')[0], 'down');
    // trapped
    const s = v2situation({ plan: 'tunnel N' });
    s.view = s.view.map((l, li) => l.map((r, z) => r.map((_c, x) => ((li === 1 || li === 2) && z === 2 && x === 2 ? 'A' : 'B'))));
    assert.deepEqual(decide(s), { action: 'stop', rule: 'trapped' });
    // v2.1: with a plan, ore further than 12 is left; a step down at health 8 or less is a stop
    assert.equal(decide(v2situation({ plan: 'tunnel S', seen: 13 })).action, 'tunnel S');
    assert.deepEqual(decide(v2situation({ plan: 'down S', health: 8 })), { action: 'stop', rule: 'low-health' });
});

test('v2 unload truth, valuables and home distance', () => {
    assert.equal(unload(v2situation({ free: 2, home: 500 })), true);
    assert.equal(unload(v2situation({ free: 6, home: 24 })), true);
    assert.equal(unload(v2situation({ free: 6, home: 25 })), false);
    assert.equal(unload(v2situation({ free: 2, home: null })), false);
    assert.equal(unload(v2situation({ free: 20, valuables: 4, health: 8 })), true);
    assert.equal(unload(v2situation({ free: 20, valuables: 4, hostiles: 2 })), true);
    assert.equal(unload(v2situation({ free: 20, valuables: 4, food: 6 })), true);
    assert.equal(unload(v2situation({ free: 20, valuables: 3, health: 1 })), false);
    assert.equal(unload(v2situation({ free: 20, valuables: 4 })), false);
    const s = v2situation({ free: 0 });
    s.view[2]![2]![3] = 'L'; // lava touching
    assert.equal(unload(s), false);
    assert.equal(valuables({ diamond: 1, raw_iron: 2, coal: 5, cobblestone: 64 }), 5);
    assert.equal(valuables({ redstone: 5000 }), 999);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, null), null);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0.5 }), 6);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }), 999);
});

test('the answer: Action, Hazard and Unload read typed; a malformed reply is none', () => {
    const r = readMine({ model: 'm', ms: 7, answers: {
        Action: { type: 'choice', top: 'down S', topProbability: 0.8, probabilities: {}, confident: true },
        Hazard: { type: 'noul', probability: 0.2, top: 'false', topProbability: 0.8, confident: true },
        Unload: { type: 'noul', probability: 0.9, top: 'true', topProbability: 0.9, confident: true },
    } });
    assert.deepEqual(r, { action: 'down S', p: 0.8, confident: true, ms: 7, hazard: 0.2, unload: { probability: 0.9, confident: true } });
    assert.equal(readMine(null), null);
    assert.equal(readMine({ model: 'm', ms: 1, answers: { Action: { type: 'choice', top: 'fly N', topProbability: 1, probabilities: {}, confident: true } } }), null);
    assert.equal(isMineAction('up W'), true);
    assert.equal(isMineAction('up'), false);
});
