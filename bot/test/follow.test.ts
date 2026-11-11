// 4.2 the follow model and job: the old test/laya_follow_state.test.js (state text against laya-go's golden v1
// and v2 requests, the alphabet, columns, the veto) and test/laya_follow_loop.test.js (the follow loop, now one
// decision per runner step), plus laya-follow.jsonl byte for byte (the live fixture and one line per branch
// recorded from the old JS by tools/laya-logs/record-follow.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    cellChar, check, FOLLOW_QUESTIONS, parseCell, parseGrid, playerLine, readColumn, readWindow,
    type BlockAt, type FollowBlock, type MobColumn,
} from '../src/models/follow/index.js';
import { followRunner, summary, FOLLOW_DEFAULTS, type FollowSettings, type FollowStepper, type JobDeps } from '../src/jobs/index.js';
import type { Act, ActEntity } from '../src/actuators/bot.js';
import { followLine, stamp, type FollowLine } from '../src/log/jsonl.js';
import type { DecideResult, JobState, Outcome, Vec3Like } from '../src/types/index.js';
import { baseFacts } from './fakeact.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const fixture = (rel: string) => fs.readFileSync(path.join(REPO, 'test/fixtures', rel), 'utf8');
const golden = JSON.parse(fixture('laya-follow-v1/request.json')) as { state: string; questions: unknown };
const goldenV2 = JSON.parse(fixture('laya-follow-v2/request.json')) as { state: string; questions: unknown };

const AIR: FollowBlock = { name: 'air', boundingBox: 'empty' };
const STONE: FollowBlock = { name: 'stone', boundingBox: 'block' };
const GRASS: FollowBlock = { name: 'grass_block', boundingBox: 'block' };
const WATER: FollowBlock = { name: 'water', boundingBox: 'empty' };
const LAVA: FollowBlock = { name: 'lava', boundingBox: 'empty' };

// worldFromRows: a fake world from laya-go world.Parse rows ('.' ground at 0, '1'–'9' up, 'a'–'i' down, '~'
// water at 0, 'v' water at −6, 'L' lava at 0); outside the rows nothing is loaded. Heights offset by Y0.
const Y0 = 64;
function worldFromRows(rows: string[]): BlockAt {
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
        const c = cols[z]?.[x];
        if (!c) return null;
        const top = Y0 + c.h;
        if (y > top) return AIR;
        if (y === top) return c.top;
        return STONE;
    };
}
const SAMPLE = ['..1122233', '.~~.1122a', '.~~..112b', '....L.1bc', '..d.....b', '..d..12..', '.....23..'];

test('golden state: matches laya-go v1 byte for byte; questions too', () => {
    const { state } = readWindow(worldFromRows(SAMPLE), 1, Y0 + 1, 3, 13 - 1, 0 - 3);
    assert.equal(state, golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(FOLLOW_QUESTIONS)), golden.questions);
});

test('golden v2 state with mobs: matches laya-go byte for byte', () => {
    const mobs: MobColumn[] = [{ kind: 'skeleton', x: 9, z: 9 }, { kind: 'zombie', x: 5, z: 1 }, { kind: 'cow', x: 2, z: 2 }];
    const { state } = readWindow(worldFromRows(SAMPLE), 1, Y0 + 1, 3, 13 - 1, 0 - 3, mobs);
    assert.equal(state, goldenV2.state);
    assert.deepEqual(JSON.parse(JSON.stringify(FOLLOW_QUESTIONS)), goldenV2.questions);
    assert.deepEqual(parseGrid(state), parseGrid(golden.state), 'the grid reads the same with a Mobs line');
});

test('alphabet round trip and clamping', () => {
    for (let h = -8; h <= 8; h++) {
        for (const surface of ['ground', 'water'] as const) {
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

const column = (blocks: [number, FollowBlock][]): BlockAt => {
    const m = new Map(blocks);
    return (x, y) => (x === 0 ? (m.get(y) ?? AIR) : null);
};

test('columns from the world', () => {
    const flat: BlockAt = (_x, y) => (y <= 64 ? STONE : AIR);
    assert.deepEqual(readColumn((_x, y) => (y <= 65 ? STONE : AIR), 0, 0, 64), { surface: 'ground', height: 65 });
    assert.equal(cellChar(readColumn((_x, y) => (y <= 75 ? STONE : AIR), 0, 0, 64), 64), '8');
    assert.equal(cellChar(readColumn(column([[63, STONE], [64, { name: 'magma_block', boundingBox: 'block' }]]), 0, 0, 64), 64), '!');
    assert.equal(cellChar(readColumn((_x, y) => (y <= 64 ? STONE : y === 65 ? { name: 'fire', boundingBox: 'empty' } : AIR), 0, 0, 64), 64), '!');
    const fence: BlockAt = (_x, y) => (y <= 64 ? STONE : y === 65 ? { name: 'oak_fence', boundingBox: 'block' } : AIR);
    assert.equal(cellChar(readColumn(fence, 0, 0, 64), 64), '2');
    assert.equal(cellChar(readColumn(() => AIR, 0, 0, 64), 64), 'H');
    assert.equal(cellChar(readColumn(() => null, 0, 0, 64), 64), '?');
    const roof: BlockAt = (_x, y) => (y <= 64 || y === 69 ? STONE : AIR);
    assert.deepEqual(readColumn(roof, 0, 0, 64), { surface: 'ground', height: 64 });
    assert.equal(cellChar(readColumn((_x, y) => (y <= 60 ? STONE : y <= 63 ? WATER : AIR), 0, 0, 64), 64), 'I');
    assert.equal(cellChar(readColumn(flat, 0, 0, 64), 64), '0');
    const door: BlockAt = (_x, y) => (y <= 64 ? STONE : y === 65 ? { name: 'oak_door', boundingBox: 'block', getProperties: () => ({ open: false }) } : AIR);
    assert.equal(cellChar(readColumn(door, 0, 0, 64), 64), '2', 'a closed door is a wall');
});

test('a swimming bot is W', () => {
    const pond: BlockAt = (_x, y) => (y <= 60 ? STONE : y <= 64 ? WATER : AIR);
    const rows = readWindow(pond, 0, 64, 0, 5, 0).state.split('\n').slice(2);
    assert.equal(rows[4]![4], 'W');
});

const grid = (rows: string[]) => parseGrid(['Follow.', 'Player E9 S0', ...rows].join('\n'))!;
const flatRows = () => Array.from({ length: 9 }, () => '000000000');
const withCells = (cells: [number, number, string][]) => {
    const rows = flatRows().map(r => [...r]);
    for (const [dx, dz, ch] of cells) rows[4 + dz]![4 + dx] = ch;
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

test('veto agrees with the golden window; refuses steps a mob can hit', () => {
    const g = parseGrid(golden.state)!;
    assert.deepEqual(check(g, 'E'), { ok: true });
    assert.deepEqual(check(g, 'W'), { ok: true });
    assert.deepEqual(check(g, 'N'), { ok: true }, 'north is the pond (water, level)');
    const f = grid(flatRows());
    assert.deepEqual(check(f, 'E', [{ kind: 'zombie', dx: 2, dz: 0 }]), { ok: false, reason: 'mob' });
    assert.deepEqual(check(f, 'W', [{ kind: 'zombie', dx: 2, dz: 0 }]), { ok: true });
    assert.deepEqual(check(f, 'E', [{ kind: 'creeper', dx: 3, dz: 1 }]), { ok: false, reason: 'mob' });
    assert.deepEqual(check(f, 'E', [{ kind: 'skeleton', dx: 4, dz: 0 }]), { ok: true });
});

// ---- the follow job (old laya_follow_loop.test.js) ----

/** A flat world at Y0, 30 × 9, with optional lava columns. */
function flatWorld(lava: [number, number][] = []): BlockAt {
    const isLava = new Set(lava.map(([x, z]) => `${x},${z}`));
    return (x, y, z) => {
        if (x < 0 || x >= 30 || z < 0 || z >= 9) return null;
        if (y > Y0) return AIR;
        if (y === Y0 && isLava.has(`${x},${z}`)) return LAVA;
        return STONE;
    };
}

function answer(move: string, p = 0.9, ms = 3, hazard = 0.1): DecideResult {
    return { model: 'fake', ms, answers: {
        Move: { type: 'choice', top: move, topProbability: p, confident: p >= 0.4, probabilities: { [move]: p } },
        Hazard: { type: 'noul', top: hazard > 0.5 ? 'true' : 'false', probability: hazard, topProbability: Math.max(hazard, 1 - hazard), confident: true },
    } };
}

interface Rig {
    runner: FollowStepper; pos: Vec3Like; calls: { decide: number; steps: [number, number][]; fallbacks: number; notes: string[]; lines: FollowLine[] };
    run(stop: () => boolean, max?: number): Promise<void>;
}

/** rig: andy at column (2, 4), the player at (14, 4); stepTo moves andy unless stuck. */
function rig(decide: () => DecideResult | null, o: { blockAt?: BlockAt; stuck?: boolean; player?: string; settings?: Partial<FollowSettings>; model?: boolean; entities?: Record<string, ActEntity> } = {}): Rig {
    const pos = { x: 2.5, y: Y0 + 1, z: 4.5 };
    const tester: ActEntity = { id: 7, username: 'tester', position: { x: 14.5, y: Y0 + 1, z: 4.5 } };
    const calls: Rig['calls'] = { decide: 0, steps: [], fallbacks: 0, notes: [], lines: [] };
    const blockAt = o.blockAt ?? flatWorld();
    const act = {
        bot: {
            get entity() { return { position: pos }; }, entities: o.entities ?? {}, health: 20, username: 'andy',
            player: (n: string) => (n === 'tester' ? tester : null),
            blockAt: (x: number, y: number, z: number) => blockAt(x, y, z),
        },
        goals: { xz: (x: number, z: number) => ({ xz: [x, z] }), follow: () => ({ follow: true }) },
        motion: {
            moveUntil: async (g: { xz: [number, number] }, _ms: number, done: () => boolean): Promise<Outcome> => {
                calls.steps.push(g.xz);
                if (!o.stuck) { pos.x = g.xz[0] + 0.5; pos.z = g.xz[1] + 0.5; }
                return done() ? { ok: true } : { ok: false, reason: 'stuck' };
            },
            moveFor: async (): Promise<Outcome> => { calls.fallbacks++; return { ok: true }; },
        },
    } as unknown as Act;
    const settings: FollowSettings = { ...FOLLOW_DEFAULTS, step_ms: 0, fallback_ms: 0, stuck_ms: 1, model: null, ...o.settings };
    if (o.model !== false) settings.model = { decide: async () => { calls.decide++; return decide(); } };
    const deps: JobDeps = {
        act: () => act, places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} },
        follow: () => settings, followLog: l => calls.lines.push(l), note: t => calls.notes.push(t),
    };
    const job = { id: 'j', spec: { kind: 'follow', player: o.player ?? 'tester', distance: 3 }, origin: 'player', progress: {}, status: 'running', startedAt: 0 } as JobState as Parameters<typeof followRunner>[0];
    const runner = followRunner(job, deps);
    const signal = new AbortController().signal;
    return {
        runner, pos, calls,
        async run(stop, max = 60) {
            for (let i = 0; i < max && !stop(); i++) {
                const r = await runner.step(baseFacts(), signal);
                if (r.how === 'end') break;
            }
            runner.close?.();
        },
    };
}

test('follow: steps east to the player, then waits there without asking', async () => {
    const r = rig(() => answer('E'));
    await r.run(() => r.runner.counters.arrivedTicks >= 1);
    assert.equal(r.runner.counters.stepped, 9); // from x = 2 to x = 11, within 3 of 14
    assert.deepEqual(r.calls.steps[0], [3, 4]);
    assert.equal(r.calls.decide, 9);
    assert.match(r.calls.notes.at(-1)!, /stepped 9/);
    assert.match(r.calls.notes[0]!, /following player tester, stepping with the Laya follow model/);
});

test('follow: server down, low confidence, lava vetoed, wait×2, stuck all fall back', async () => {
    let r = rig(() => null);
    await r.run(() => r.calls.fallbacks >= 1);
    assert.equal(r.runner.counters.fallbacks['no-answer'], 1);
    assert.equal(r.calls.steps.length, 0);
    r = rig(() => answer('E', 0.2));
    await r.run(() => r.calls.fallbacks >= 1);
    assert.equal(r.runner.counters.fallbacks['low-confidence'], 1);
    r = rig(() => answer('E'), { blockAt: flatWorld([[3, 4]]) });
    await r.run(() => r.calls.fallbacks >= 1);
    assert.equal(r.runner.counters.fallbacks.veto, 1);
    assert.equal(r.runner.counters.vetoes.harmful, 1);
    assert.equal(r.calls.steps.length, 0);
    r = rig(() => answer('wait'));
    await r.run(() => r.calls.fallbacks >= 1);
    assert.equal(r.runner.counters.fallbacks.wait, 1);
    assert.equal(r.calls.decide, 3);
    r = rig(() => answer('E'), { stuck: true });
    await r.run(() => r.calls.fallbacks >= 1);
    assert.equal(r.runner.counters.fallbacks.stuck, 1);
    assert.ok(r.runner.counters.stuckSeconds >= 0);
});

test('follow: arrived waits without asking', async () => {
    const r = rig(() => answer('E'));
    r.pos.x = 13.5;
    await r.run(() => r.runner.counters.arrivedTicks >= 3);
    assert.equal(r.calls.decide, 0);
    assert.equal(r.calls.steps.length, 0);
});

test('follow: player not found ends failed with the old message; the model off follows with the pathfinder', async () => {
    const r = rig(() => answer('E'), { player: 'nobody' });
    const end = await r.runner.step(baseFacts(), new AbortController().signal);
    assert.deepEqual(end, { how: 'end', end: { how: 'failed', reason: 'Could not find nobody.' }, say: 'Could not find nobody.' });
    const off = rig(() => answer('E'), { model: false });
    await off.run(() => off.calls.fallbacks >= 2);
    assert.equal(off.calls.decide, 0);
    assert.equal(off.runner.counters.asked, 0);
    assert.deepEqual(off.calls.notes, ['You are now actively following player tester.'], 'no summary line without the model');
});

test('follow: steps are logged only with log_steps', async () => {
    let r = rig(() => answer('E'));
    await r.run(() => r.runner.counters.arrivedTicks >= 1);
    assert.equal(r.calls.lines.length, 9);
    assert.equal(r.calls.lines[0]!.outcome, 'stepped');
    assert.equal(r.calls.lines[0]!.move, 'E');
    assert.match(r.calls.lines[0]!.state, /^Follow\.\nPlayer E12 S0\n/);
    r = rig(() => answer('E'), { settings: { log_steps: false } });
    await r.run(() => r.runner.counters.arrivedTicks >= 1);
    assert.equal(r.calls.lines.length, 0);
});

test('follow: v2 writes the Mobs line from the entities', async () => {
    let r = rig(() => answer('wait'), { settings: { prompt: 'v2' } });
    await r.run(() => r.calls.decide >= 1);
    assert.match(r.calls.lines[0]!.state, /^Follow\.\nPlayer E12 S0\nMobs none\n/);
    r = rig(() => answer('wait'), { settings: { prompt: 'v2' }, entities: {
        3: { id: 3, name: 'zombie', position: { x: 6.2, y: 65, z: 2.7 } }, 4: { id: 4, name: 'cow', position: { x: 3, y: 65, z: 4 } },
        7: { id: 7, name: 'player', username: 'tester', position: { x: 14.5, y: 65, z: 4.5 } } } });
    await r.run(() => r.calls.decide >= 1);
    assert.match(r.calls.lines[0]!.state, /^Follow\.\nPlayer E12 S0\nMobs zombie E4 N2\n/);
});

test('follow: abort mid-question settles within 250 ms', async () => {
    const slow = { decide: () => new Promise<DecideResult>(res => setTimeout(() => res(answer('E')), 3000)) };
    const deps: JobDeps = {
        act: () => ({ bot: { entity: { position: { x: 2.5, y: 65, z: 4.5 } }, entities: {}, health: 20, player: () => ({ id: 1, position: { x: 14.5, y: 65, z: 4.5 } }), blockAt: flatWorld() } } as unknown as Act),
        places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} },
        follow: () => ({ ...FOLLOW_DEFAULTS, model: slow }), followLog: () => {}, note: () => {},
    };
    const runner = followRunner({ id: 'j', spec: { kind: 'follow', player: 'tester', distance: 3 }, origin: 'player', progress: {}, status: 'running', startedAt: 0 }, deps);
    const c = new AbortController();
    const t0 = Date.now();
    const p = runner.step(baseFacts(), c.signal);
    setTimeout(() => c.abort(), 30);
    assert.deepEqual(await p, { how: 'more' });
    assert.ok(Date.now() - t0 < 280, `settled in ${Date.now() - t0} ms`);
});

test('summary line', () => {
    const line = summary({ asked: 3, stepped: 2, vetoes: { harmful: 1 }, damage: 0, stuckSeconds: 0, fallbacks: { veto: 1, stuck: 0 } });
    assert.equal(line, 'Laya follow: asked 3, stepped 2, fallbacks: veto 1; vetoes: harmful 1; damage 0, stuck 0.0 s');
});

// ---- laya-follow.jsonl byte for byte ----

const timeOf = (line: string): Date => new Date((JSON.parse(line) as { time: string }).time);
const lines = (rel: string) => fixture(rel).split('\n').filter(Boolean);

test('golden: laya-follow.jsonl (wait) byte for byte', () => {
    const [want] = lines('laya-logs/laya-follow.jsonl');
    const old = JSON.parse(want!) as { state: string };
    const line = followLine({ state: old.state, asked: { move: 'wait', p: 1, hazard: 0, ms: 79 }, outcome: 'wait' });
    assert.equal(stamp(line, timeOf(want!)), want);
});

test('branches: follow — stepped, wait, fallback no-answer / low-confidence / wait / veto / stuck', async () => {
    const want = lines('laya-logs/branches/follow.jsonl');
    const got: FollowLine[] = [];
    // the sessions tools/laya-logs/record-follow.mjs ran on the old followWithLaya, in its order
    const session = async (replies: (DecideResult | null)[], o: { blockAt?: BlockAt; stuck?: boolean } = {}) => {
        let i = 0;
        const r = rig(() => replies[i++] ?? null, o);
        await r.run(() => i >= replies.length && (r.calls.lines.length > 0 || r.calls.fallbacks > 0) && r.calls.decide >= replies.length);
        got.push(...r.calls.lines);
    };
    const hz = (move: string, p = 0.9, ms = 3) => answer(move, p, ms, 0.125);
    await session([hz('E', 0.9, 41)]);
    await session([hz('wait', 0.8, 40)]);
    await session([null]);
    await session([hz('E', 0.2, 39)]);
    await session([hz('wait'), hz('wait'), hz('wait', 0.7, 44)]);
    await session([hz('E', 0.95, 38)], { blockAt: flatWorld([[3, 4]]) });
    await session([hz('E', 0.9, 37)], { stuck: true });
    assert.equal(got.length, want.length);
    got.forEach((l, i) => assert.equal(stamp(l, timeOf(want[i]!)), want[i], `line ${i}`));
});
