import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readView, state, QUESTIONS, ORES, decide, unsafe, hazard, touching, cellOf, headingOf, pickTier, ACTIONS } from '../src/agent/laya/mine_state.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-mine-v1/request.json', import.meta.url), 'utf8'));

const STONE = { name: 'stone', boundingBox: 'block' };
const AIR = { name: 'air', boundingBox: 'empty' };
const LAVA = { name: 'lava', boundingBox: 'empty' };

// The golden scene (laya-go games/mine/prompt sample): feet at (0, 41, 0) in a
// tunnel heading east, lava two blocks east at feet and floor, a small cave
// to the north-west.
function goldenWorld() {
    const air = new Set(['0,42,0', '0,41,0', '-1,42,0', '-1,41,0', '-2,42,0', '-2,41,0', '-2,43,-2', '-2,42,-2', '-1,42,-2']);
    const lava = new Set(['2,41,0', '2,40,0']);
    return (x, y, z) => {
        const k = `${x},${y},${z}`;
        if (air.has(k)) return AIR;
        if (lava.has(k)) return LAVA;
        return STONE;
    };
}

function goldenSituation() {
    return { ore: 'iron', y: 41, pick: 2, torches: 6, blocks: 20, dark: 7, heading: 'E', seen: 0,
        view: readView(goldenWorld(), 0, 41, 0, ORES.iron.blocks) };
}

test('golden mine state: matches laya-go byte for byte', () => {
    const s = goldenSituation();
    assert.equal(state(s), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS)), golden.questions);
});

test('rules port: the golden answer, safety and hazard', () => {
    const s = goldenSituation();
    assert.deepEqual(decide(s), { action: 'down S', rule: 'go-down' });
    assert.equal(unsafe(s.view, 'down E'), 'fluid behind');
    assert.equal(unsafe(s.view, 'tunnel E'), 'fluid behind');
    assert.equal(unsafe(s.view, 'tunnel S'), '');
    assert.equal(hazard(s.view), false);
    assert.equal(decide({ ...s, pick: 1 }).action, 'stop');
    assert.equal(decide({ ...s, seen: 5 }).action, 'collect');
    assert.equal(decide({ ...s, dark: 8 }).action, 'torch');
    assert.equal(decide({ ...s, y: 16 }).action, 'tunnel S');
    assert.equal(decide({ ...s, y: 0 }).action, 'up E');
    s.view[2][2][3] = 'L'; // lava touching the bot's feet to the east
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

// parse reads a prompt v1 state back to a situation (for the cross-check).
function parse(text) {
    const lines = text.split('\n');
    const [, ore, , y, , pick, , torches, , blocks, , dark, , heading] = lines[1].split(' ');
    const seen = lines[2] === 'Seen none' ? 0 : Number(lines[2].split(' ')[1]);
    const view = [0, 1, 2, 3, 4].map(l => lines.slice(3).map(row => [...row.split(' ')[l]]));
    return { ore, y: Number(y), pick: ['none', 'wooden', 'stone', 'iron', 'diamond'].indexOf(pick), torches: Number(torches),
        blocks: Number(blocks), dark: Number(dark), heading, seen, view };
}

test('rules port agrees with laya-go on 300 generated situations', () => {
    const rows = readFileSync(new URL('./fixtures/laya-mine-v1/decisions.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 300);
    for (const r of rows) {
        const s = parse(r.state);
        assert.equal(state(s), r.state, 'state round trip');
        assert.equal(decide(s).action, r.action, r.state);
        assert.equal(hazard(s.view), r.hazard, r.state);
    }
});
