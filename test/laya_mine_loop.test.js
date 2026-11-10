import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mineWithLaya, pickOre, oreSafe, canMakeTorches, pickUpDrop } from '../src/agent/laya/mine.js';
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
        task: { log_steps: false, max_steps: 40, prompt: 'v1' },
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

// ---- prompt v2: the mine plan and unloading ----

// v2 sets a v2 run up: the rules answer (no model) unless decide is given.
function v2(opts = {}) {
    const s = setup({ decide: () => null, ...opts });
    Object.assign(s.deps.task, { prompt: 'v2', max_steps: opts.steps ?? 20 });
    s.calls.chat = [];
    s.calls.walks = [];
    s.calls.home = [];
    s.calls.deposited = [];
    const moveTo = s.deps.moveTo;
    s.deps.moveTo = async (x, y, z, ms) => { if (ms) s.calls.walks.push([x, y, z]); return moveTo(x, y, z); };
    s.deps.place = async (item, x, y, z, on) => { s.calls.placed.push([item, x, y, z, on]); s.w.m.set(`${x},${y},${z}`, item === 'torch' ? 'torch' : 'stone'); s.inventory[item]--; return true; };
    s.deps.chat = msg => s.calls.chat.push(msg);
    s.deps.freeSlots = () => opts.free ?? 20;
    s.deps.home = () => opts.home ?? null;
    s.deps.hostiles = () => 0;
    s.deps.isFood = n => n === 'bread';
    s.deps.goHome = async h => { s.calls.home.push(h); s.bot.entity.position = { x: h.x + 0.5, y: h.y, z: h.z + 1.5 }; return true; };
    s.deps.deposit = async items => {
        s.calls.deposited.push(items);
        for (const { name, count } of items) s.inventory[name] -= count;
        return true;
    };
    return s;
}

test('v2: says where the mine starts, then stairs down ahead', async () => {
    const { bot, deps, calls } = v2({ y: 60, steps: 3 });
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.match(calls.chat[0], /iron mine starts at 0 60 0, heading E/);
    assert.deepEqual(calls.moves, [[1, 59, 0], [2, 58, 0], [3, 57, 0]]);
    assert.deepEqual(r.entrance, { x: 0, y: 60, z: 0 });
    assert.equal(r.counters.asked, 3);
});

test('v2: the plan line goes to the model; an off-plan move is overruled', async () => {
    const { bot, deps, calls } = v2({ y: 20, steps: 2, decide: () => answer('tunnel S') });
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.match(calls.decide[0], /\nPlan tunnel E\nPack 20 Home none Health 20 Food 20 Hostiles 0 Valuables 0\n/);
    assert.deepEqual(calls.moves, [[1, 20, 0], [2, 20, 0]]);
    assert.equal(r.counters.rules['off-plan'], 2);
});

test('v2: collects ore off the line, then walks back to the plan', async () => {
    const { bot, deps, calls, w, inventory } = v2({ y: 20, steps: 3, blocks: { '2,20,3': 'iron_ore' } });
    deps.collect = async () => {
        w.m.set('2,20,3', 'air');
        inventory.raw_iron = (inventory.raw_iron || 0) + 1;
        bot.entity.position = { x: 2.5, y: 20, z: 3.5 };
        return true;
    };
    await mineWithLaya(bot, 'iron', 2, deps);
    assert.deepEqual(calls.walks, [[0, 20, 0]]);
    assert.deepEqual(calls.moves.at(-1), [1, 20, 0], 'then the main tunnel goes on');
});

test('v2: lava in a branch: a detour, the branch is abandoned, the next branch starts', async () => {
    const { bot, deps, calls } = v2({ y: 20, steps: 9, blocks: { '3,20,-3': 'lava' } });
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    // main x 1..3, branch N to z -1, the lava is behind z -2: detour, walk back, branch S
    assert.equal(r.counters.abandoned, 1);
    assert.ok(!calls.dug.some(([x, , z]) => x === 3 && z <= -2), JSON.stringify(calls.dug));
    assert.deepEqual(calls.walks, [[3, 20, 0]]);
    assert.ok(calls.moves.some(([x, , z]) => x === 3 && z === 1), 'the south branch: ' + JSON.stringify(calls.moves));
});

test('v2: torches go on the left wall going out', async () => {
    const { bot, deps, calls } = v2({ y: 20, steps: 10 });
    await mineWithLaya(bot, 'iron', 1, deps);
    // 3 main blocks east, then the north branch: left of north is the west wall
    const torch = calls.placed.find(([item]) => item === 'torch');
    assert.deepEqual(torch, ['torch', 3, 21, -5, 'west']);
});

test('v2: unloads at home when the pack is full, keeping tools, food, torches and 32 blocks', async () => {
    const inv = { stone_pickaxe: 1, torch: 5, cobblestone: 50, bread: 3, raw_iron: 2, andesite: 10 };
    const { bot, deps, calls } = v2({ y: 20, steps: 3, free: 1, home: { x: 0, y: 64, z: 10 }, inv });
    deps.freeSlots = () => (calls.deposited.length ? 20 : 1);
    const r = await mineWithLaya(bot, 'iron', 3, deps);
    assert.deepEqual(calls.home, [{ x: 0, y: 64, z: 10 }]);
    assert.deepEqual(calls.deposited[0], [{ name: 'cobblestone', count: 18 }, { name: 'andesite', count: 10 }, { name: 'raw_iron', count: 2 }]);
    assert.equal(r.counters.unloads, 1);
    assert.deepEqual(calls.walks[0], [0, 20, 0], 'walks back to the plan');
    assert.equal(r.collected, 0, 'the iron it had before is not counted');
});

test('v2: the model decides Unload when sure; a completely full pack always unloads', async () => {
    const withUnload = p => () => { const a = answer('tunnel E'); a.answers.Unload = { type: 'noul', probability: p, confident: true }; return a; };
    let s = v2({ y: 20, steps: 2, free: 1, home: { x: 0, y: 20, z: 5 }, decide: withUnload(0.05) });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(s.calls.home.length, 0, 'the model says not yet');
    s = v2({ y: 20, steps: 1, free: 0, home: { x: 0, y: 20, z: 5 }, decide: withUnload(0.05) });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(s.calls.home.length, 1, 'full: unload anyway');
    s = v2({ y: 20, steps: 1, free: 30, home: { x: 0, y: 20, z: 5 }, decide: withUnload(0.95) });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(s.calls.home.length, 1, 'the model says go');
    s = v2({ y: 20, steps: 2, free: 0, decide: withUnload(0.95) });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(s.calls.home.length, 0, 'no home chest known');
});

// ---- v2 bug fixes: bounded, safe collecting; partial unloads; torch batches ----

test('pickOre: near the plan, within budget, away from water and lava', () => {
    const w = fakeWorld(20, { '3,20,4': 'water' });
    const opts = { feet: { x: 0, y: 20, z: 0 }, anchor: { x: 0, y: 20, z: 0 }, range: 8, budget: 24, blockAt: w.blockAt };
    assert.deepEqual(pickOre([{ x: 12, y: 20, z: 0 }, { x: 2, y: 20, z: 1 }], opts), { x: 2, y: 20, z: 1 }, 'the far one is past range');
    assert.equal(pickOre([{ x: 3, y: 20, z: 3 }], opts), null, 'water touches the ore');
    assert.equal(pickOre([{ x: 6, y: 20, z: 7 }], opts), null, 'water on the way');
    assert.equal(pickOre([{ x: 5, y: 20, z: 0 }], { ...opts, budget: 4 }), null, 'past the budget');
    assert.equal(pickOre([{ x: 5, y: 20, z: 0 }], { ...opts, skip: () => true }), null);
    assert.equal(oreSafe(w.blockAt, { x: 0, y: 20, z: 0 }, { x: 5, y: 20, z: 0 }), true);
});

test('canMakeTorches: coal or charcoal, and sticks or wood', () => {
    assert.equal(canMakeTorches({ coal: 1, stick: 1 }), true);
    assert.equal(canMakeTorches({ charcoal: 2, oak_log: 1 }), true);
    assert.equal(canMakeTorches({ coal: 3, cobblestone: 5 }), false);
    assert.equal(canMakeTorches({ stick: 3, spruce_planks: 5 }), false);
});

test('v2: ore far from the plan is left; ore chains never pull the bot away', async () => {
    // a line of ore going east from the plan's first branch, away from the mine
    const blocks = { '2,20,3': 'iron_ore', '14,20,3': 'iron_ore', '26,20,3': 'iron_ore', '38,20,3': 'iron_ore' };
    // 4 steps: collect, walk back, tunnel to x 1, tunnel to x 2 (the next ore
    // comes within 12 of the tunnel only after that)
    const { bot, deps, calls, w, inventory } = v2({ y: 20, steps: 4, blocks, decide: () => answer('collect') });
    const collected = [];
    deps.ores = names => [...w.m].filter(([, n]) => names.includes(n)).map(([k]) => {
        const [x, y, z] = k.split(',').map(Number);
        return { x, y, z };
    }).sort((a, b) => Math.hypot(a.x - bot.entity.position.x, a.z - bot.entity.position.z) - Math.hypot(b.x - bot.entity.position.x, b.z - bot.entity.position.z));
    deps.collect = async (names, n, o) => {
        collected.push(o);
        w.m.set(`${o.x},${o.y},${o.z}`, 'air');
        inventory.raw_iron = (inventory.raw_iron || 0) + 1;
        bot.entity.position = { x: o.x + 0.5, y: o.y, z: o.z + 0.5 };
        return true;
    };
    await mineWithLaya(bot, 'iron', 4, deps);
    assert.deepEqual(collected.map(o => o.x), [2], 'only the ore within 12 of the plan cell');
    assert.deepEqual(calls.walks, [[0, 20, 0]], 'walks back to the plan');
    assert.deepEqual(calls.moves.slice(-2), [[1, 20, 0], [2, 20, 0]], 'and the plan goes on');
});

test('v2: a full home chest after taking some is a partial unload, not a failure', async () => {
    const inv = { stone_pickaxe: 1, torch: 5, cobblestone: 50, raw_iron: 2, andesite: 10 };
    const { bot, deps, calls } = v2({ y: 20, steps: 4, free: 0, home: { x: 0, y: 20, z: 10 }, inv });
    deps.deposit = async items => {
        calls.deposited.push(items);
        deps.inventory = (orig => () => ({ ...orig(), andesite: 0 }))(deps.inventory);
        return false; // full after the andesite
    };
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.equal(calls.home.length, 1, 'no unload again straight away');
    assert.equal(r.counters.failures, 0);
    assert.ok(calls.logs.some(l => /home chest is full/.test(l)));
});

test('v2: crafts a torch batch when low and it carries coal and sticks; backs off after a failure', async () => {
    let s = v2({ y: 20, steps: 3, inv: { stone_pickaxe: 1, torch: 2, coal: 2, stick: 4, cobblestone: 10 } });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.deepEqual(s.calls.crafted, ['torch'], 'once: then it has 6');
    s = v2({ y: 20, steps: 5, craftOk: false, inv: { stone_pickaxe: 1, torch: 1, coal: 2, stick: 4, cobblestone: 10 } });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.deepEqual(s.calls.crafted, ['torch'], 'a failed craft is not retried every step');
});

test('v2: a stair step with no floor: a detour, then the staircase goes on from there (no walk back)', async () => {
    // down E from (0, 60, 0) lands on (1, 59, 0): no floor under it
    const { bot, deps, calls } = v2({ y: 60, steps: 6, blocks: { '1,58,0': 'air', '1,57,0': 'air' } });
    const r = await mineWithLaya(bot, 'iron', 1, deps);
    assert.deepEqual(calls.walks, [], 'never walks back to the cell without a floor');
    assert.ok(r.counters.abandoned >= 1);
    assert.equal(calls.moves.length, 6, 'every step moves on');
    assert.ok(calls.moves.at(-1)[1] <= 55, 'and down: ' + JSON.stringify(calls.moves));
});

test('pickOre: not more than collect_below under the plan cell', () => {
    const w = fakeWorld(20);
    const opts = { feet: { x: 0, y: 20, z: 0 }, anchor: { x: 0, y: 20, z: 0 }, range: 12, budget: 24, blockAt: w.blockAt, below: 4 };
    assert.equal(pickOre([{ x: 3, y: 15, z: 0 }], opts), null, '5 below');
    assert.deepEqual(pickOre([{ x: 3, y: 15, z: 0 }, { x: 3, y: 16, z: 0 }], opts), { x: 3, y: 16, z: 0 });
    assert.deepEqual(pickOre([{ x: 3, y: 26, z: 0 }], opts), { x: 3, y: 26, z: 0 }, 'above is fine');
});

test('v2: the walk back fails twice: the plan starts again from where the bot stands', async () => {
    const { bot, deps, calls, w, inventory } = v2({ y: 20, steps: 6, blocks: { '2,20,3': 'iron_ore' } });
    deps.collect = async () => {
        w.m.set('2,20,3', 'air');
        inventory.raw_iron = (inventory.raw_iron || 0) + 1;
        bot.entity.position = { x: 2.5, y: 20, z: 3.5 };
        return true;
    };
    const moveTo = deps.moveTo;
    deps.moveTo = async (x, y, z, ms) => (ms ? (calls.walks.push([x, y, z]), false) : moveTo(x, y, z)); // walks back fail
    const r = await mineWithLaya(bot, 'iron', 5, deps);
    assert.deepEqual(calls.walks, [[0, 20, 0], [0, 20, 0]], 'two tries, then no more walking back');
    assert.equal(r.counters.restarts, 1);
    assert.ok(calls.logs.some(l => /starting it again from 2 20 3/.test(l)));
    assert.ok(calls.moves.some(([x, y, z]) => x === 3 && y === 20 && z === 3), 'the new plan tunnels on from there: ' + JSON.stringify(calls.moves));
});

test('pickUpDrop: waits for the drop, fetches a left item, and says when it never came', async () => {
    let n = 5, fetched = 0;
    const sleep = async () => {};
    assert.equal(await pickUpDrop({ count: () => n, before: 5, findItem: () => ({}), fetch: async () => { fetched++; n = 6; }, sleep }), true);
    assert.equal(fetched, 1);
    n = 5; fetched = 0;
    assert.equal(await pickUpDrop({ count: () => n, before: 5, findItem: () => ({}), fetch: async () => { fetched++; }, sleep, tries: 3 }), false, 'drop left lying');
    assert.equal(fetched, 3);
    assert.equal(await pickUpDrop({ count: () => 6, before: 5, findItem: () => null, fetch: async () => {}, sleep }), true);
});

test('dropBelow: air under the floor, and under a one-block floor over a cave', async () => {
    const { dropBelow } = await import('../src/agent/laya/mine.js');
    const w = fakeWorld(20, { '1,19,0': 'air', '1,18,0': 'air', '2,18,0': 'air', '2,17,0': 'air', '2,16,0': 'air', '2,15,0': 'air' });
    assert.equal(dropBelow(w.blockAt, 0, 20, 0), 0);
    assert.equal(dropBelow(w.blockAt, 1, 20, 0), 2);
    assert.equal(dropBelow(w.blockAt, 2, 20, 0), 4, 'a thin floor over 4 air');
});

test('v2 heal: hurt, so eat to 18, wait to regenerate, then go on (rule heal)', async () => {
    const s = v2({ y: 20, steps: 3 });
    s.bot.health = 6; s.bot.food = 12;
    let ate = 0;
    s.deps.eat = async () => { ate++; s.bot.food = Math.min(20, s.bot.food + 4); return true; };
    s.deps.sleep = async ms => { if (ms >= 1000) s.bot.health += 1; };
    const r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(ate, 2, 'food 12 → 20');
    assert.equal(s.bot.health, 9);
    assert.equal(r.counters.rules.heal, 1);
    assert.ok(s.calls.moves.length >= 1, 'then mining goes on');
});

test('v2 heal: hurt with no food: stop and ask; hostiles: retreat up the staircase', async () => {
    const s = v2({ y: 60, steps: 5 });
    s.bot.health = 4; s.bot.food = 16;
    s.deps.eat = async () => false;
    s.deps.hostiles = () => 1;
    const r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'hurt with no food');
    assert.match(s.calls.chat.at(-1), /no food/);
    assert.deepEqual(s.calls.walks.at(-1), [0, 60, 0], 'back to the entrance');
});

test('v2: never steps onto a drop; two floor vetoes on the staircase start the level there', async () => {
    // a cave under the plan's tunnel east at Y 20: the rules go another way
    let s = v2({ y: 20, steps: 1, blocks: { '1,18,0': 'air', '1,17,0': 'air', '1,16,0': 'air', '1,15,0': 'air' } });
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.notDeepEqual(s.calls.moves[0], [1, 20, 0]);
    // staircase east from Y 60 with a hollow under every next stair cell
    const blocks = {};
    for (let x = 1; x <= 4; x++) for (let z = -3; z <= 3; z++) for (let y = 50; y <= 57; y++) blocks[`${x},${y},${z}`] = "air";
    s = v2({ y: 60, steps: 4, blocks });
    const r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(r.counters.rules['stop-descent'], 1);
});

test('mine memory: nearestMine, upsertMine, mineStore', async () => {
    const { nearestMine, upsertMine, mineStore } = await import('../src/agent/laya/mine_memory.js');
    const a = { entrance: { x: 0, y: 70, z: 0 }, heading: 'E' }, b = { entrance: { x: 100, y: 70, z: 0 }, heading: 'N', last: { x: 30, y: 20, z: 0 } };
    assert.equal(nearestMine([a, b], { x: 10, y: 70, z: 5 }), a);
    assert.equal(nearestMine([a, b], { x: 40, y: 70, z: 0 }), b, 'near where the bot last was in it');
    assert.equal(nearestMine([a, b], { x: 60, y: 70, z: 60 }), null);
    let list = upsertMine([a, b], { ...a, ores: ['iron'] });
    assert.equal(list.length, 2);
    assert.deepEqual(list[0].ores, ['iron']);
    let saved = null;
    const st = mineStore({ load: () => { throw new Error('no file'); }, save: l => { saved = l; } });
    assert.equal(st.find({ x: 0, y: 0, z: 0 }), null);
    st.save(a);
    assert.deepEqual(saved, [a]);
});

test('v2: a mine job near a saved mine goes on with it: same entrance, dug cells skipped', async () => {
    let saved = [];
    const store = { find: () => saved[0] || null, save: rec => { saved = [rec]; } };
    // first job: a staircase from Y 60 heading E
    let s = v2({ y: 60, steps: 4 });
    s.deps.mines = store;
    let r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(r.reused, false);
    assert.deepEqual(saved[0].entrance, { x: 0, y: 60, z: 0 });
    assert.equal(saved[0].heading, 'E');
    const dug = new Map(s.w.m);
    // second job 3 blocks away, facing north: goes on with the mine at its 5th stair cell
    s = v2({ y: 60, steps: 2 });
    for (const [k, v] of dug) s.w.m.set(k, v);
    s.bot.entity.position = { x: 0.5, y: 60, z: 3.5 };
    s.bot.entity.yaw = 0;
    s.deps.mines = store;
    r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(r.reused, true);
    assert.match(s.calls.chat[0], /Going on with the mine at 0 60 0 \(heading E\) for iron/);
    assert.deepEqual(s.calls.walks[0], [4, 56, 0], 'walks to the bottom of the dug staircase');
    assert.deepEqual(saved[0].ores, ['iron']);
});

test('v2: ore in sight with room in the pack is collected before unloading; a failed unload backs off', async () => {
    const inv = { stone_pickaxe: 1, torch: 5, cobblestone: 10, dirt: 40 };
    let s = v2({ y: 20, steps: 2, free: 1, home: { x: 0, y: 20, z: 10 }, inv, blocks: { '2,20,1': 'iron_ore' } });
    s.deps.ores = () => [{ x: 2, y: 20, z: 1 }];
    s.deps.collect = async () => { s.w.m.set('2,20,1', 'air'); s.inventory.raw_iron = (s.inventory.raw_iron || 0) + 1; return true; };
    const r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(r.ok, true);
    assert.equal(s.calls.home.length, 0, 'collected first');
    // unload fails (no chest there): no retry for unload_fail_steps
    s = v2({ y: 20, steps: 12, free: 2, home: { x: 0, y: 20, z: 10 }, inv });
    s.deps.deposit = async () => false;
    await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.equal(s.calls.home.length, 1);
    assert.ok(s.calls.moves.length > 5, 'mining went on');
});

test('a failed torch place waits a few moves before trying again', async () => {
    const s = v2({ y: 20, steps: 14, inv: { stone_pickaxe: 1, torch: 5, cobblestone: 10 } });
    s.deps.place = async (item, x, y, z, on) => { s.calls.placed.push([item, x, y, z, on]); return false; };
    const r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    // 8 moves, a failed torch, 3 moves, a failed torch, 2 moves
    assert.equal(r.counters.steps.torch, 2);
    assert.equal(r.counters.steps.tunnel, 12);
});

test('pickOre: ore 5–8 below is taken only when open to the air (a pocket beside the stair)', () => {
    const w = fakeWorld(50, { '3,44,0': 'iron_ore', '3,43,0': 'air', '5,44,0': 'iron_ore' });
    const opts = { feet: { x: 0, y: 50, z: 0 }, anchor: { x: 0, y: 50, z: 0 }, range: 12, budget: 24, blockAt: w.blockAt, below: 4, belowOpen: 8 };
    assert.deepEqual(pickOre([{ x: 5, y: 44, z: 0 }, { x: 3, y: 44, z: 0 }], opts), { x: 3, y: 44, z: 0 }, 'the buried one 6 below is left');
    assert.equal(pickOre([{ x: 5, y: 44, z: 0 }], opts), null);
    assert.equal(pickOre([{ x: 3, y: 41, z: 0 }], { ...opts, blockAt: fakeWorld(50, { '3,41,0': 'iron_ore', '3,40,0': 'air' }).blockAt }), null, '9 below: too deep');
    assert.equal(pickOre([{ x: 3, y: 44, z: 0 }], { ...opts, belowOpen: 4 }), null, 'collect_below alone');
});

test('v2.1: a stop with rule low-health takes the heal path, not "needs a pickaxe"', async () => {
    // heal_health 0: the loop-top heal is off, so the rules' low-health stop decides
    const s = v2({ y: 60, steps: 3 });
    Object.assign(s.deps.task, { prompt: 'v2.1', heal_health: 0 });
    s.bot.health = 6; s.bot.food = 20;
    s.deps.sleep = async ms => { if (ms >= 1000) s.bot.health = 20; };
    const r = await mineWithLaya(s.bot, 'iron', 1, s.deps);
    assert.notEqual(r.reason, 'needs a stone_pickaxe');
    assert.equal(s.bot.health, 20);
    assert.ok(s.calls.moves.length >= 1, 'healed, then down the staircase');
    const { decide } = await import('../src/agent/laya/mine_state.js');
    assert.ok(decide);
});
