import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineWithLaya } from '../src/agent/laya/mine.js';
import { ORES } from '../src/agent/laya/mine_state.js';

const EMPTY = new Set(['air', 'torch', 'lava', 'water']);

// fakeWorld is solid stone with set blocks; the bot stands at feet (0, y, 0)
// in a short tunnel heading east.
function fakeWorld(y, blocks = {}) {
    const m = new Map(Object.entries(blocks));
    for (const [x, z] of [[0, 0], [-1, 0]]) {
        for (const k of [`${x},${y},${z}`, `${x},${y + 1},${z}`]) if (x === 0 || !m.has(k)) m.set(k, 'air');
    }
    return {
        m,
        blockAt: (x, yy, z) => {
            const name = m.get(`${x},${yy},${z}`) ?? 'stone';
            return { name, boundingBox: EMPTY.has(name) ? 'empty' : 'block' };
        },
    };
}

// answer is a laya-client answer for an action.
const answer = (action, p = 0.9) => ({ model: 'fake', ms: 2, answers: {
    Action: { type: 'choice', top: action, topProbability: p, confident: p >= 0.4 },
    Hazard: { type: 'noul', probability: 0.1, confident: true },
} });

function setup({ y = 16, blocks = {}, inv = { stone_pickaxe: 1, torch: 5, cobblestone: 10 }, decide, craftOk = true, ore = 'iron' } = {}) {
    const w = fakeWorld(y, blocks);
    const bot = { entity: { position: { x: 0.5, y, z: 0.5 }, yaw: -Math.PI / 2 }, interrupt_code: false };
    const calls = { decide: [], dug: [], moves: [], placed: [], crafted: [], collected: 0, logs: [] };
    const inventory = { ...inv };
    const deps = {
        client: { decide: async (task, state) => { calls.decide.push(state); return decide(state, calls.decide.length); } },
        task: { log_steps: false, max_steps: 40 },
        blockAt: w.blockAt,
        inventory: () => ({ ...inventory }),
        nearestOre: (names, range) => {
            const p = bot.entity.position;
            let best = null;
            for (const [k, name] of w.m) {
                if (!names.includes(name)) continue;
                const [x, yy, z] = k.split(',').map(Number);
                const d = Math.hypot(x - p.x, yy - p.y, z - p.z);
                if (d <= range && (!best || d < best.d)) best = { x, y: yy, z, d };
            }
            return best;
        },
        craft: async (item, n) => { calls.crafted.push(item); if (craftOk) inventory[item] = (inventory[item] || 0) + n; return craftOk; },
        collect: async names => {
            for (const [k, name] of w.m) if (names.includes(name)) {
                w.m.set(k, 'air');
                inventory[ORES[ore].drop] = (inventory[ORES[ore].drop] || 0) + 1;
                calls.collected++;
                return true;
            }
            return false;
        },
        dig: async (x, yy, z) => { calls.dug.push([x, yy, z]); w.m.set(`${x},${yy},${z}`, 'air'); return true; },
        moveTo: async (x, yy, z) => { calls.moves.push([x, yy, z]); bot.entity.position = { x: x + 0.5, y: yy, z: z + 0.5 }; return true; },
        place: async (item, x, yy, z) => { calls.placed.push([item, x, yy, z]); w.m.set(`${x},${yy},${z}`, item === 'torch' ? 'torch' : 'stone'); inventory[item]--; return true; },
        sleep: async () => {},
        log: msg => calls.logs.push(msg),
        stepLog: null,
    };
    return { bot, deps, calls, w, inventory };
}

// seenOrTunnel collects when the state says the ore is in sight, else tunnels east.
const seenOrTunnel = state => answer(state.includes('\nSeen none\n') ? 'tunnel E' : 'collect');

test('tunnels east until the ore is in sight, then collects it', async () => {
    const { bot, deps, calls } = setup({ blocks: { '24,16,0': 'iron_ore' }, decide: seenOrTunnel });
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.equal(r.ok, true, r.reason);
    assert.equal(r.collected, 1);
    assert.deepEqual(calls.moves[0], [1, 16, 0]);
    assert.ok(calls.moves.length >= 8, `${calls.moves.length} tunnel steps`);
    assert.ok(calls.dug.every(([, y]) => y === 16 || y === 17), 'a tunnel digs feet and head only');
    assert.equal(calls.collected, 1);
    assert.equal(r.counters.model, calls.decide.length);
});

test('vetoes a step beside lava and takes the rule answer', async () => {
    const { bot, deps, calls } = setup({ blocks: { '2,16,0': 'lava' }, decide: () => answer('tunnel E') });
    deps.task.max_steps = 1;
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.equal(r.counters.vetoes['fluid behind'], 1);
    assert.deepEqual(calls.moves[0], [0, 16, 1], 'tunnel S instead');
});

test('never digs straight down: going down is a staircase', async () => {
    const { bot, deps, calls } = setup({ y: 60, decide: () => answer('down E') });
    deps.task.max_steps = 3;
    await mineWithLaya(bot, 'iron', 1, deps);
    assert.deepEqual(calls.moves, [[1, 59, 0], [2, 58, 0], [3, 57, 0]]);
    calls.moves.forEach(([x], i) => {
        const dug = calls.dug.slice(3 * i, 3 * i + 3);
        assert.ok(dug.every(([dx]) => dx === x), `step ${i} digs only the column ahead: ${JSON.stringify(dug)}`);
    });
});

test('crafts the pickaxe it needs before starting, or gives up', async () => {
    let s = setup({ inv: { wooden_pickaxe: 1 }, decide: seenOrTunnel, blocks: { '3,16,0': 'iron_ore' } });
    let r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.deepEqual(s.calls.crafted, ['stone_pickaxe']);
    assert.equal(r.ok, true);
    s = setup({ inv: { stone_pickaxe: 1 }, decide: seenOrTunnel, craftOk: false });
    r = await mineWithLaya(s.bot, 'diamond', 1, s.deps);
    assert.deepEqual(s.calls.crafted, ['iron_pickaxe']);
    assert.equal(r.ok, false);
    assert.match(r.reason, /iron_pickaxe/);
    assert.equal(s.calls.decide.length, 0);
});

test('blocks lava touching the bot with a carried block', async () => {
    const { bot, deps, calls } = setup({ blocks: { '0,16,1': 'lava' }, decide: () => answer('block') });
    deps.task.max_steps = 1;
    await mineWithLaya(bot, 'iron', 1, deps);
    assert.deepEqual(calls.placed, [['cobblestone', 0, 16, 1]]);
});

test('crafts torches when they run out in the dark, and places one behind', async () => {
    const { bot, deps, calls } = setup({ inv: { stone_pickaxe: 1, cobblestone: 5 }, decide: (state) => answer(/Dark ([89]|1\d)/.test(state) ? 'torch' : 'tunnel E') });
    deps.task.max_steps = 10;
    await mineWithLaya(bot, 'iron', 1, deps);
    assert.deepEqual(calls.crafted, ['torch']);
    assert.ok(calls.placed.some(([item, x, y]) => item === 'torch' && y === 16 && x === 7), JSON.stringify(calls.placed));
});

test('no answer or a low-confidence answer: the rules decide', async () => {
    const { bot, deps, calls } = setup({ decide: (s, n) => (n === 1 ? null : answer('stop', 0.2)) });
    deps.task.max_steps = 2;
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.deepEqual(r.counters.rules, { 'no-answer': 1, 'low-confidence': 1 });
    assert.deepEqual(calls.moves, [[1, 16, 0], [2, 16, 0]]);
});

test('trapped: stops', async () => {
    const blocks = {};
    for (let x = -3; x <= 3; x++) for (let y = 13; y <= 19; y++) for (let z = -3; z <= 3; z++) blocks[`${x},${y},${z}`] = 'bedrock';
    const { bot, deps, calls } = setup({ blocks, decide: () => answer('stop') });
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.equal(r.ok, false);
    assert.match(r.reason, /trapped/);
    assert.equal(calls.dug.length, 0);
});

test('an unknown ore is refused', async () => {
    const { bot, deps } = setup({ decide: seenOrTunnel });
    const r = await mineWithLaya(bot, 'emerald', 1, deps);
    assert.equal(r.ok, false);
    assert.match(r.reason, /unknown ore/);
});
