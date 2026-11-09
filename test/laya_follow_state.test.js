import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readWindow, readColumn, cellChar, parseCell, parseGrid, playerLine, QUESTIONS } from '../src/agent/laya/follow_state.js';
import { check } from '../src/agent/laya/veto.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-follow-v1/request.json', import.meta.url), 'utf8'));

const AIR = { name: 'air', boundingBox: 'empty' };
const STONE = { name: 'stone', boundingBox: 'block' };
const GRASS = { name: 'grass_block', boundingBox: 'block' };
const WATER = { name: 'water', boundingBox: 'empty' };
const LAVA = { name: 'lava', boundingBox: 'empty' };

// worldFromRows builds a fake world from laya-go world.Parse rows: '.' ground
// at 0, '1'–'9' up, 'a'–'i' down, '~' water at 0, 'v' water at −6, 'L' lava at
// 0. Ground columns are stone with grass on top; water and lava sit on stone.
// Outside the rows, nothing is loaded. Heights are offset by Y0.
const Y0 = 64;
function worldFromRows(rows, extra = new Map()) {
    const cols = rows.map(r => [...r].map(ch => {
        if (ch === '.') return { h: 0, top: GRASS };
        if (ch >= '1' && ch <= '9') return { h: +ch, top: GRASS };
        if (ch >= 'a' && ch <= 'i') return { h: -(ch.charCodeAt(0) - 96), top: GRASS };
        if (ch === '~') return { h: 0, top: WATER };
        if (ch === 'v') return { h: -6, top: WATER };
        if (ch === 'L') return { h: 0, top: LAVA };
        throw new Error('bad char ' + ch);
    }));
    return (x, y, z) => {
        const key = `${x},${y},${z}`;
        if (extra.has(key)) return extra.get(key);
        const c = cols[z]?.[x];
        if (!c) return null;
        const top = Y0 + c.h;
        if (y > top) return AIR;
        if (y === top) return c.top;
        return STONE;
    };
}

// The golden sample terrain (fixtures/laya-follow-v1/README.md).
const SAMPLE = ['..1122233', '.~~.1122a', '.~~..112b', '....L.1bc', '..d.....b', '..d..12..', '.....23..'];

test('golden state: matches laya-go v1 byte for byte', () => {
    const blockAt = worldFromRows(SAMPLE);
    // bot at (1, 3) standing on ground at Y0, so feet at Y0 + 1; player at (13, 0)
    const { state } = readWindow(blockAt, 1, Y0 + 1, 3, 13 - 1, 0 - 3);
    assert.equal(state, golden.state);
});

test('questions match laya-go v1', () => {
    assert.deepEqual(JSON.parse(JSON.stringify(QUESTIONS)), golden.questions);
});

test('alphabet round trip and clamping', () => {
    for (let h = -8; h <= 8; h++) {
        for (const surface of ['ground', 'water']) {
            assert.deepEqual(parseCell(cellChar({ surface, height: 70 + h }, 70)), { surface, height: h });
        }
    }
    assert.equal(cellChar({ surface: 'ground', height: 81 }, 70), '8');
    assert.equal(cellChar({ surface: 'ground', height: 55 }, 70), 'H');
    assert.equal(cellChar({ surface: 'water', height: 70 }, 70), 'W');
    assert.equal(cellChar({ surface: 'harmful', height: 3 }, 70), '!');
    assert.equal(cellChar({ surface: 'unknown', height: 0 }, 70), '?');
    assert.equal(playerLine(12, -3), 'Player E12 N3');
    assert.equal(playerLine(0, 0), 'Player E0 S0');
    assert.equal(playerLine(-5, 7), 'Player W5 S7');
});

// column builds a one-column world from a list of [y, block] (air elsewhere).
function column(blocks) {
    const m = new Map(blocks.map(([y, b]) => [y, b]));
    return (x, y) => (x === 0 ? (m.get(y) ?? AIR) : null);
}

test('columns from the world', () => {
    const flat = (x, y) => (y <= 64 ? STONE : AIR);
    // step up
    assert.deepEqual(readColumn((x, y) => (y <= 65 ? STONE : AIR), 0, 0, 64), { surface: 'ground', height: 65 });
    // clamped wall: solid up to 64 + 11
    assert.equal(cellChar(readColumn((x, y) => (y <= 75 ? STONE : AIR), 0, 0, 64), 64), '8');
    // magma
    assert.equal(cellChar(readColumn(column([[63, STONE], [64, { name: 'magma_block', boundingBox: 'block' }]]), 0, 0, 64), 64), '!');
    // fire in the headroom
    assert.equal(cellChar(readColumn((x, y) => (y <= 64 ? STONE : y === 65 ? { name: 'fire', boundingBox: 'empty' } : AIR), 0, 0, 64), 64), '!');
    // fence at the bot's level: two or more up
    const fence = (x, y) => (y <= 64 ? STONE : y === 65 ? { name: 'oak_fence', boundingBox: 'block' } : AIR);
    assert.equal(cellChar(readColumn(fence, 0, 0, 64), 64), '2');
    // deep drop: air all the way
    assert.equal(cellChar(readColumn(() => AIR, 0, 0, 64), 64), 'H');
    // unloaded
    assert.equal(cellChar(readColumn(() => null, 0, 0, 64), 64), '?');
    // a roof above the floor: the floor wins
    const roof = (x, y) => (y <= 64 || y === 69 ? STONE : AIR);
    assert.deepEqual(readColumn(roof, 0, 0, 64), { surface: 'ground', height: 64 });
    // water
    assert.equal(cellChar(readColumn((x, y) => (y <= 60 ? STONE : y <= 63 ? WATER : AIR), 0, 0, 64), 64), 'I');
    assert.equal(cellChar(readColumn(flat, 0, 0, 64), 64), '0');
});

test('a swimming bot is W', () => {
    const pond = (x, y) => (y <= 60 ? STONE : y <= 64 ? WATER : AIR);
    const { state } = readWindow(pond, 0, 64, 0, 5, 0); // feet in the surface water block
    const rows = state.split('\n').slice(2);
    assert.equal(rows[4][4], 'W');
});

const grid = rows => parseGrid(['Follow.', 'Player E9 S0', ...rows].join('\n'));
const flatRows = () => Array.from({ length: 9 }, () => '000000000');
const withCells = (cells) => {
    const rows = flatRows().map(r => [...r]);
    for (const [dx, dz, ch] of cells) rows[4 + dz][4 + dx] = ch;
    return rows.map(r => r.join(''));
};

test('veto: harm and illegal moves refused', () => {
    assert.deepEqual(check(grid(withCells([[1, 0, '!']])), 'E'), { ok: false, reason: 'harmful' });
    assert.deepEqual(check(grid(withCells([[1, 0, 'D']])), 'E'), { ok: false, reason: 'drop' });
    assert.deepEqual(check(grid(withCells([[1, 0, 'P']])), 'E'), { ok: true }, 'a drop of 8 into water is fine');
    assert.deepEqual(check(grid(withCells([[1, 0, 'C']])), 'E'), { ok: true }, 'a drop of 3 is fine');
    assert.deepEqual(check(grid(withCells([[1, 0, '2']])), 'E'), { ok: false, reason: 'climb' });
    assert.deepEqual(check(grid(withCells([[1, 0, '1']])), 'E'), { ok: true });
    assert.deepEqual(check(grid(withCells([[1, 0, '?']])), 'E'), { ok: false, reason: 'unknown' });
    assert.deepEqual(check(grid(withCells([[0, -1, '2']])), 'NE'), { ok: false, reason: 'corner' });
    assert.deepEqual(check(grid(withCells([[1, -1, '1']])), 'NE'), { ok: false, reason: 'diagonal climb' });
    assert.deepEqual(check(grid(withCells([[1, 0, '1']])), 'NE'), { ok: false, reason: 'corner' });
    assert.deepEqual(check(grid(withCells([[0, -1, '!']])), 'NE'), { ok: false, reason: 'corner' });
    assert.deepEqual(check(grid(flatRows()), 'SW'), { ok: true });
    assert.deepEqual(check(grid(flatRows()), 'wait'), { ok: true });
});

test('veto agrees with the golden window', () => {
    const g = parseGrid(golden.state);
    // the bot is at x = 1: west of it is still on the map, and the pond is to its north
    assert.deepEqual(check(g, 'E'), { ok: true });
    assert.deepEqual(check(g, 'W'), { ok: true });
    assert.deepEqual(check(g, 'N'), { ok: true }, 'north is the pond (water, level)');
});
