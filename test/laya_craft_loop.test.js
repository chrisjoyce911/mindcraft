import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runCraft, check } from '../src/agent/laya/craft.js';
import { situation } from '../src/agent/laya/craft_state.js';

const answer = (action, item, count, p = 0.9) => ({
    answers: { Action: { top: action, topProbability: p }, Item: { top: item, topProbability: p }, Count: { top: String(count), topProbability: p } },
    ms: 3,
});

// fakeWorld is an inventory the fake actions change, a chest and stations.
function fakeWorld(inv, { near = {}, chest = null, script = [] } = {}) {
    const calls = [];
    const add = (name, n) => { inv[name] = (inv[name] || 0) + n; };
    const states = [];
    const deps = {
        client: { decide: async (task, state) => { states.push(state); return script.shift() ?? null; } },
        task: { log_steps: false },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => near,
        readChest: async () => { calls.push(['readChest']); return chest; },
        act: {
            gather: async (g, n) => { calls.push(['gather', g, n]); add(g === 'log' ? 'oak_log' : g, n); return true; },
            craft: async (g, t) => { calls.push(['craft', g, t]); if (g === 'stick') { inv.oak_planks -= 2 * t; add('stick', 4 * t); } return true; },
            smelt: async (g, n) => { calls.push(['smelt', g, n]); return true; },
            place: async g => { calls.push(['place', g]); inv[g]--; near[{ crafting_table: 'table', furnace: 'furnace', chest: 'chest' }[g]] = true; return true; },
            take: async (g, n) => { calls.push(['take', g, n]); add(g, n); return true; },
            store: async (g, n) => { calls.push(['store', g, n]); inv[g] = 0; return true; },
        },
    };
    return { deps, calls, states, inv };
}

test('crafts, then stops when the model says done with the goal carried', async () => {
    const w = fakeWorld({ oak_planks: 2 }, { script: [answer('craft', 'stick', 1), answer('done', 'none', 1)] });
    const r = await runCraft('stick', 4, w.deps);
    assert.deepEqual(r, { ok: true, reason: 'done', steps: 1 });
    assert.deepEqual(w.calls, [['craft', 'stick', 1]]);
    assert.match(w.states[0], /^Craft\.\nGoal stick x4\nHave planks x2\n/);
    assert.match(w.states[1], /\nHave stick x4\n/);
});

test('a step the bot cannot do stops the run without acting', async () => {
    const w = fakeWorld({ wooden_pickaxe: 1 }, { script: [answer('gather', 'raw_iron', 3)] });
    const r = await runCraft('raw_iron', 3, w.deps);
    assert.equal(r.ok, false);
    assert.match(r.reason, /needs-pickaxe/);
    assert.deepEqual(w.calls, []);
});

test('no answer, low confidence, early done and too many steps stop', async () => {
    let w = fakeWorld({}, { script: [] });
    assert.equal((await runCraft('stick', 4, w.deps)).reason, 'no-answer');
    w = fakeWorld({}, { script: [answer('gather', 'log', 1, 0.1)] });
    assert.equal((await runCraft('stick', 4, w.deps)).reason, 'low-confidence');
    w = fakeWorld({}, { script: [answer('done', 'none', 1)] });
    assert.match((await runCraft('stick', 4, w.deps)).reason, /goal-not-carried/);
    w = fakeWorld({}, { script: Array.from({ length: 5 }, () => answer('gather', 'log', 1)) });
    w.deps.task.max_steps = 3;
    assert.deepEqual(await runCraft('log', 64, w.deps), { ok: false, reason: 'max-steps', steps: 3 });
    assert.equal((await runCraft('cake', 1, w.deps)).ok, false);
});

test('stores junk in a near chest (all of it), reading the chest once', async () => {
    const w = fakeWorld({ dirt: 40 }, { near: { chest: true }, chest: {}, script: [answer('store', 'dirt', 48), answer('gather', 'log', 3), answer('done', 'none', 1)] });
    const r = await runCraft('log', 3, w.deps);
    assert.equal(r.ok, true);
    assert.deepEqual(w.calls, [['readChest'], ['store', 'dirt', -1], ['gather', 'log', 3]]);
});

test('places a carried chest and storage then works', async () => {
    const w = fakeWorld({ chest: 1, dirt: 64 }, { script: [answer('place', 'chest', 1), answer('store', 'dirt', 64), answer('done', 'none', 1)] });
    w.inv.oak_log = 3;
    const r = await runCraft('log', 3, w.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(w.calls.map(c => c[0]), ['place', 'store']);
});

test('check: tools, stations, fuel and storage rules', () => {
    const s = (inv, near = {}, goal = 'iron_pickaxe') => situation(Object.entries(inv).map(([name, count]) => ({ name, count })), goal, 1, near);
    assert.equal(check(s({ stone_pickaxe: 1 }), { action: 'gather', item: 'raw_iron', count: 3 }), null);
    assert.equal(check(s({}), { action: 'craft', item: 'stick', count: 1 }), 'needs-planks');
    assert.equal(check(s({ oak_planks: 3, stick: 2 }), { action: 'craft', item: 'wooden_pickaxe', count: 1 }), 'needs-table');
    assert.equal(check(s({ oak_planks: 3, stick: 2 }, { table: true }), { action: 'craft', item: 'wooden_pickaxe', count: 1 }), null);
    assert.equal(check(s({ raw_iron: 3 }, { furnace: true }), { action: 'smelt', item: 'iron_ingot', count: 3 }), 'needs-fuel');
    assert.equal(check(s({ raw_iron: 3, coal: 1 }), { action: 'smelt', item: 'iron_ingot', count: 3 }), 'needs-furnace');
    assert.equal(check(s({ dirt: 5 }), { action: 'store', item: 'dirt', count: 6 }), 'no-chest');
    assert.equal(check(s({ dirt: 5 }, { chest: true }), { action: 'store', item: 'dirt', count: 6 }), null);
    assert.equal(check(s({ bread: 5 }, { chest: true }), { action: 'store', item: 'bread', count: 6 }), 'bad-item');
    assert.equal(check(s({ oak_planks: 4 }), { action: 'place', item: 'stick', count: 1 }), 'not-placeable');
    assert.equal(check(s({}), { action: 'craft', item: 'cake', count: 1 }), 'bad-item');
});
