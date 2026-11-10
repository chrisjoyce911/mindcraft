import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readView, state, QUESTIONS_V2, ORES, decide, unload, valuables, homeDistance, hazard } from '../src/agent/laya/mine_state.js';
import { loadSample } from '../src/models/laya_check.js';

const STONE = { name: 'stone', boundingBox: 'block' };
const AIR = { name: 'air', boundingBox: 'empty' };
const LAVA = { name: 'lava', boundingBox: 'empty' };

// A tunnel heading east with lava two blocks east (the v1 golden scene).
function world({ lava = ['2,41,0', '2,40,0'] } = {}) {
    const air = new Set(['0,42,0', '0,41,0', '-1,42,0', '-1,41,0', '-2,42,0', '-2,41,0', '-2,43,-2', '-2,42,-2', '-1,42,-2']);
    const l = new Set(lava);
    return (x, y, z) => {
        const k = `${x},${y},${z}`;
        return air.has(k) ? AIR : l.has(k) ? LAVA : STONE;
    };
}

const situation = (extra = {}) => ({ ore: 'iron', y: 41, pick: 2, torches: 6, blocks: 20, dark: 7, heading: 'E', seen: 0,
    view: readView(world(), 0, 41, 0, ORES.iron.blocks), plan: 'tunnel E', free: 5, home: 12, health: 20, food: 20,
    hostiles: 0, valuables: 0, ...extra });

test('v2 state: the plan and pack lines after the status line', () => {
    const lines = state(situation()).split('\n');
    assert.equal(lines[1], 'Ore iron Y 41 Pick stone Torches 6 Blocks 20 Dark 7 Heading E');
    assert.equal(lines[2], 'Plan tunnel E');
    assert.equal(lines[3], 'Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0');
    assert.equal(lines[4], 'Seen none');
    assert.equal(lines.length, 10);
    assert.equal(state(situation({ home: null, hostiles: 12, valuables: 5000 })).split('\n')[3],
        'Pack 5 Home none Health 20 Food 20 Hostiles 9 Valuables 999');
    assert.equal(state({ ...situation(), plan: null }).split('\n')[2], 'Seen none', 'no plan: prompt v1');
    assert.deepEqual(Object.keys(QUESTIONS_V2), ['Action', 'Hazard', 'Unload']);
    assert.equal(QUESTIONS_V2.Unload.instructions, 'I should go and empty my pack into the home chest now.');
});

// The golden v2 request: laya-go games/mine/prompt/testdata/v2_sample_request.json.
const V2 = new URL('./fixtures/laya-mine-v2/request.json', import.meta.url);
test('golden v2 mine state: matches laya-go byte for byte', () => {
    const golden = JSON.parse(readFileSync(V2, 'utf8'));
    assert.equal(state(situation()), golden.state);
    assert.equal(state(parseV2(golden.state)), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS_V2)), golden.questions);
    assert.deepEqual(loadSample('mine', 'v2'), golden);
});

// decisions.jsonl: 300 laya-go v2 situations (generate.PlanSituations(7, 300))
// with rules.Decide, Hazard and Unload.
test('v2 rules port agrees with laya-go on 300 generated situations', () => {
    const rows = readFileSync(new URL('./fixtures/laya-mine-v2/decisions.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 300);
    for (const r of rows) {
        const s = parseV2(r.state);
        assert.equal(state(s), r.state, 'state round trip');
        assert.deepEqual(decide(s), { action: r.action, rule: r.rule }, r.state);
        assert.equal(hazard(s.view), r.hazard, r.state);
        assert.equal(unload(s), r.unload, r.state);
    }
});

// parseV2 reads a v2 state back to a situation.
export function parseV2(text) {
    const lines = text.split('\n');
    const [, ore, , y, , pick, , torches, , blocks, , dark, , heading] = lines[1].split(' ');
    const plan = lines[2].slice('Plan '.length);
    const [, free, , home, , health, , food, , hostiles, , vals] = lines[3].split(' ');
    const seen = lines[4] === 'Seen none' ? 0 : Number(lines[4].split(' ')[1]);
    const view = [0, 1, 2, 3, 4].map(l => lines.slice(5).map(row => [...row.split(' ')[l]]));
    return { ore, y: Number(y), pick: ['none', 'wooden', 'stone', 'iron', 'diamond'].indexOf(pick), torches: Number(torches),
        blocks: Number(blocks), dark: Number(dark), heading, plan, free: Number(free), home: home === 'none' ? null : Number(home),
        health: Number(health), food: Number(food), hostiles: Number(hostiles), valuables: Number(vals), seen, view };
}

test('v2 rule 5: follow the plan when safe, else detour; ore, fluid and torches first', () => {
    // safe plan step, even above the band
    assert.deepEqual(decide(situation({ plan: 'tunnel S' })), { action: 'tunnel S', rule: 'follow-plan' });
    assert.deepEqual(decide(situation({ plan: 'down S' })), { action: 'down S', rule: 'follow-plan' });
    // the plan step has lava behind it: the plan's kind right (S), then left (N)...
    assert.deepEqual(decide(situation({ plan: 'tunnel E' })), { action: 'tunnel S', rule: 'detour' });
    assert.deepEqual(decide(situation({ plan: 'down E' })), { action: 'down S', rule: 'detour' });
    // ore, torches and fluid first
    assert.equal(decide(situation({ plan: 'down S', seen: 3 })).action, 'collect');
    assert.equal(decide(situation({ plan: 'down S', dark: 8 })).action, 'torch');
    // never down below the lowest height
    assert.notEqual(decide(situation({ plan: 'down S', y: -59 })).action.split(' ')[0], 'down');
    // trapped
    const s = situation({ plan: 'tunnel N' });
    s.view = s.view.map((l, li) => l.map((r, z) => r.map((c, x) => ((li === 1 || li === 2) && z === 2 && x === 2 ? 'A' : 'B'))));
    assert.deepEqual(decide(s), { action: 'stop', rule: 'trapped' });
});

test('v2 unload truth, valuables and home distance', () => {
    assert.equal(unload(situation({ free: 2, home: 500 })), true);
    assert.equal(unload(situation({ free: 6, home: 24 })), true);
    assert.equal(unload(situation({ free: 6, home: 25 })), false);
    assert.equal(unload(situation({ free: 2, home: null })), false);
    assert.equal(unload(situation({ free: 20, valuables: 4, health: 8 })), true);
    assert.equal(unload(situation({ free: 20, valuables: 4, hostiles: 2 })), true);
    assert.equal(unload(situation({ free: 20, valuables: 4, food: 6 })), true);
    assert.equal(unload(situation({ free: 20, valuables: 3, health: 1 })), false);
    assert.equal(unload(situation({ free: 20, valuables: 4 })), false);
    const s = situation({ free: 0 });
    s.view[2][2][3] = 'L'; // lava touching
    assert.equal(unload(s), false);
    assert.equal(valuables({ diamond: 1, raw_iron: 2, coal: 5, cobblestone: 64 }), 5);
    assert.equal(valuables({ redstone: 5000 }), 999);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, null), null);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 4, z: 0.5 }), 6);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }), 999);
});
