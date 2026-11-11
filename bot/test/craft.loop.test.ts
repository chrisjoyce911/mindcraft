// 5.1 the craft loop (a port of test/laya_craft_loop.test.js and the craft parts of test/laya_fix_round3.test.js and
// test/laya_fix_round4.test.js) on the step runner: one model step per job step, driven to its end by runCraft.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, plan, situation, ingredientFromChest, type CraftItem, type Counts } from '../src/models/craft/index.js';
import { settle } from '../src/actuators/settle.js';
import { answer, fakeWorld, runCraft, type OldDeps } from './craftfake.js';

test('crafts, then stops when the model says done with the goal carried', async () => {
    const w = fakeWorld({ oak_planks: 2 }, { script: [answer('craft', 'stick', 1), answer('done', 'none', 1)] });
    const r = await runCraft('stick', 4, w.deps);
    assert.deepEqual({ ok: r.ok, reason: r.reason, steps: r.steps }, { ok: true, reason: 'done', steps: 1 });
    assert.deepEqual(w.calls, [['craft', 'stick', 1]]);
    assert.match(w.states[0]!, /^Craft\.\nGoal stick x4\nHave planks x2\n/);
    assert.match(w.states[1]!, /\nHave stick x4\n/);
});

test('a step the bot cannot do is replaced by the recipe rules', async () => {
    const w = fakeWorld({ wooden_pickaxe: 1 }, { script: [answer('gather', 'raw_iron', 3)] });
    const r = await runCraft('raw_iron', 3, w.deps);
    assert.equal(r.reason, 'no-answer'); // the fake model has nothing more to say
    assert.deepEqual(w.calls, [['gather', 'cobblestone', 3]]); // for a stone pickaxe first
});

test('low confidence and early done follow the recipe rules; no answer and too many steps stop', async () => {
    let w = fakeWorld({}, { script: [] });
    assert.equal((await runCraft('stick', 4, w.deps)).reason, 'no-answer');
    w = fakeWorld({}, { script: [answer('gather', 'log', 1, 0.1)] });
    await runCraft('stick', 4, w.deps);
    assert.deepEqual(w.calls, [['gather', 'log', 1]]);
    w = fakeWorld({ oak_planks: 2 }, { script: [answer('done', 'none', 1), answer('done', 'none', 1)] });
    const early = await runCraft('stick', 4, w.deps);
    assert.deepEqual([early.ok, early.reason, early.steps], [true, 'done', 1]);
    assert.deepEqual(w.calls, [['craft', 'stick', 1]]);
    w = fakeWorld({}, { script: Array.from({ length: 5 }, () => answer('gather', 'log', 1)) });
    w.deps.task.max_steps = 3;
    const many = await runCraft('log', 64, w.deps);
    assert.deepEqual([many.ok, many.reason, many.steps], [false, 'max-steps', 3]);
    const cake = await runCraft('cake', 1, w.deps);
    assert.equal(cake.ok, false);
    assert.equal(cake.say, "I couldn't make 1 cake: the craft model doesn't know cake.");
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

const sit = (inv: Record<string, number>, near = {}, goal: CraftItem = 'iron_pickaxe', count = 1, chest: Counts = {}) =>
    situation(Object.entries(inv).map(([name, c]) => ({ name, count: c })), goal, count, near, chest);

test('check: tools, stations, fuel and storage rules', () => {
    const s = (inv: Record<string, number>, near = {}) => sit(inv, near);
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

test('plan: the recipe rules pick the next step', () => {
    assert.deepEqual(plan(sit({}, {}, 'wooden_pickaxe')), { action: 'gather', item: 'log', count: 1 });
    assert.deepEqual(plan(sit({ oak_planks: 7 }, {}, 'wooden_pickaxe')), { action: 'craft', item: 'stick', count: 1 });
    assert.deepEqual(plan(sit({ oak_planks: 3, stick: 2 }, {}, 'wooden_pickaxe')), { action: 'gather', item: 'log', count: 1 }); // for a table
    assert.deepEqual(plan(sit({ oak_planks: 3, stick: 2 }, { table: true }, 'wooden_pickaxe')), { action: 'craft', item: 'wooden_pickaxe', count: 1 });
    assert.deepEqual(plan(sit({ stick: 1 }, { table: true, chest: true }, 'wooden_hoe', 1, { planks: 18, stick: 7 })), { action: 'take', item: 'planks', count: 2 });
    assert.deepEqual(plan(sit({ oak_planks: 2, stick: 1 }, { table: true, chest: true }, 'wooden_hoe', 1, { planks: 18, stick: 7 })), { action: 'take', item: 'stick', count: 1 });
    assert.deepEqual(plan(sit({ wooden_pickaxe: 1 }, {}, 'iron_ingot', 2)), { action: 'gather', item: 'cobblestone', count: 3 });
    assert.deepEqual(plan(sit({ oak_log: 3 }, {}, 'log', 13)), { action: 'gather', item: 'log', count: 10 });
    assert.equal(plan(sit({ oak_log: 13 }, {}, 'log', 13)), null);
});

test('settle: waits for the crafted items to show, then a quiet time', async () => {
    let t = 0, planks = 4;
    const sleep = async (ms: number) => { t += ms; if (t >= 200) planks = 12; };
    assert.equal(await settle(() => planks >= 12, { sleep }), true);
    assert.ok(t >= 200 + 150, 'waited for the update and the quiet time');
    t = 0;
    assert.equal(await settle(() => false, { ms: 500, sleep }), false, 'gives up after ms');
    assert.equal(t, 650);
    // an abort ends the wait at once
    const c = new AbortController();
    setTimeout(() => c.abort(), 20);
    const t0 = Date.now();
    assert.equal(await settle(() => false, { ms: 5000, signal: c.signal }), false);
    assert.ok(Date.now() - t0 < 250, `settled ${Date.now() - t0} ms`);
});

test('a failed extra step after the goal is carried still counts as done (director-b recheck 22:05)', async () => {
    // the stone pickaxe is made, then the model asks for planks and that fails
    const w = fakeWorld({ cobblestone: 109, stick: 2, oak_log: 1 }, { near: { table: true }, script: [answer('craft', 'stone_pickaxe', 1), answer('craft', 'planks', 1)] });
    w.deps.act.craft = async (g, t) => {
        w.calls.push(['craft', g, t]);
        if (g === 'stone_pickaxe') { w.inv.cobblestone! -= 3; w.inv.stick! -= 2; w.inv.stone_pickaxe = 1; return true; }
        return false;
    };
    const r = await runCraft('stone_pickaxe', 1, w.deps);
    assert.deepEqual([r.ok, r.reason, r.steps], [true, 'done', 2]);
    // without the goal carried, a failed step still fails
    const w2 = fakeWorld({ cobblestone: 1 }, { script: [answer('craft', 'planks', 1)] });
    w2.deps.act.craft = async () => false;
    assert.equal((await runCraft('stone_pickaxe', 1, w2.deps)).ok, false);
});

// ---- fix round 3: what a take really moved, a retry, goal carried, ingredients ----

function world(inv: Record<string, number>, chest: Counts, script: ReturnType<typeof answer>[], { takeMin = 8, failTake = (_g: string): boolean => false } = {}) {
    const calls: unknown[][] = [];
    const add = (name: string, n: number) => { inv[name] = (inv[name] || 0) + n; };
    const deps: OldDeps = {
        client: { decide: async () => script.shift() ?? null },
        task: { log_steps: false },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => ({ table: true, chest: true }),
        readChest: async () => { calls.push(['readChest']); return { ...chest }; },
        act: {
            take: async (g, n) => {
                calls.push(['take', g, n]);
                const k = Math.min(chest[g] || 0, Math.max(n, takeMin)); // bulk, like TAKE_IN_BULK
                if (!k || failTake(g)) return false;
                chest[g]! -= k; add(g === 'planks' ? 'oak_planks' : g, k);
                return true;
            },
            craft: async (g, t) => {
                calls.push(['craft', g, t]);
                if (g === 'stick') { inv.oak_planks! -= 2 * t; add('stick', 4 * t); }
                if (g === 'wooden_sword') { inv.oak_planks! -= 2; inv.stick! -= 1; add('wooden_sword', 1); }
                if (g === 'torch') { inv.coal! -= t; inv.stick! -= t; add('torch', 4 * t); }
                if (g === 'stone_pickaxe') { inv.cobblestone! -= 3; inv.stick! -= 2; add('stone_pickaxe', 1); }
                return true;
            },
            gather: async () => true, smelt: async () => true, place: async () => true, store: async () => true,
        },
    };
    return { deps, calls, inv, chest };
}

test('craft sword: a take that took all 5 planks counts 5, so the next step sees the chest empty (2026-11-11)', async () => {
    const w = world({ wooden_pickaxe: 1 }, { planks: 5, stick: 14, coal: 11 },
        [answer('take', 'planks', 1), answer('take', 'planks', 1), answer('take', 'stick', 1), answer('craft', 'wooden_sword', 1), answer('done', 'none', 1)]);
    const r = await runCraft('wooden_sword', 1, w.deps);
    assert.equal(r.ok, true, JSON.stringify([r, w.calls]));
    assert.equal(w.inv.wooden_sword, 1);
    // the second "take planks" was refused (not-in-chest) and the rules took over
    assert.equal(w.calls.filter(c => c[0] === 'take' && c[1] === 'planks').length, 1);
});

test('craft: a take the chest could not give re-reads the chest once and goes on', async () => {
    let fails = 1;
    const w = world({ oak_planks: 2 }, { stick: 4 }, [answer('take', 'stick', 1), answer('take', 'stick', 1), answer('craft', 'wooden_sword', 1), answer('done', 'none', 1)],
        { failTake: () => fails-- > 0 });
    const r = await runCraft('wooden_sword', 1, w.deps);
    assert.equal(r.ok, true, JSON.stringify([r, w.calls]));
    assert.equal(w.calls.filter(c => c[0] === 'readChest').length, 2, 'read again after the failed take');
    // two failures of the same take end the job with the reason
    const w2 = world({ oak_planks: 2 }, { stick: 4 }, [answer('take', 'stick', 1), answer('take', 'stick', 1)], { failTake: () => true });
    const r2 = await runCraft('wooden_sword', 1, w2.deps);
    assert.deepEqual([r2.ok, r2.reason, r2.steps], [false, 'take stick failed', 2]);
    assert.equal(r2.say, "I couldn't make 1 wooden sword: take stick failed.");
});

test('craft: no second stone pickaxe for a goal of 1 (goal-carried)', async () => {
    const s = situation([{ name: 'stone_pickaxe', count: 1 }, { name: 'cobblestone', count: 3 }, { name: 'stick', count: 5 }], 'stone_pickaxe', 1, { table: true }, {});
    assert.equal(check(s, { action: 'craft', item: 'stone_pickaxe', count: 1 }), 'goal-carried');
    assert.equal(check(s, { action: 'done', item: 'none', count: 1 }), null);
    const w = world({ cobblestone: 6, stick: 7, oak_planks: 5 }, {}, [answer('craft', 'stone_pickaxe', 1), answer('craft', 'stone_pickaxe', 1, 0.66), answer('done', 'none', 1)]);
    const r = await runCraft('stone_pickaxe', 1, w.deps);
    assert.equal(r.ok, true);
    assert.equal(w.inv.stone_pickaxe, 1, 'one pickaxe');
    assert.equal(w.calls.filter(c => c[0] === 'craft').length, 1);
});

test('craft torch with coal in the chest: take the coal, then craft (not needs-coal)', async () => {
    const s = situation([{ name: 'stick', count: 3 }], 'torch', 4, { table: true, chest: true }, { coal: 11 });
    s.chestKnown = true;
    const step = { action: 'craft' as const, item: 'torch', count: 1 };
    assert.equal(check(s, step), 'needs-coal');
    assert.deepEqual(ingredientFromChest(s, step, 'needs-coal'), { action: 'take', item: 'coal', count: 1 });
    assert.equal(ingredientFromChest(s, step, 'needs-stick'), null, 'not in the chest');
    assert.equal(ingredientFromChest(s, { action: 'gather', item: 'coal', count: 1 }, 'needs-pickaxe'), null);
    const w = world({ stick: 3 }, { coal: 11, torch: 4 }, [answer('craft', 'torch', 1), answer('craft', 'torch', 1), answer('done', 'none', 1)]);
    const r = await runCraft('torch', 4, w.deps);
    assert.equal(r.ok, true, JSON.stringify([r, w.calls]));
    assert.deepEqual(w.calls.filter(c => c[0] !== 'readChest').slice(0, 2), [['take', 'coal', 1], ['craft', 'torch', 1]]);
    assert.equal(w.chest.torch, 4, "the chest's torches stay");
});

// ---- fix round 4: the craft chain without the player kit; rules-only chains ----

function craftFake(have: Record<string, number>, chest: Counts, answers: [string, string, number, number?][] = []) {
    const did: string[] = [];
    const items = () => Object.entries(have).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count }));
    const recipes: Record<string, [number, Record<string, number>]> = { planks: [4, { log: 1 }], stick: [4, { planks: 2 }], stone_sword: [1, { cobblestone: 2, stick: 1 }], torch: [4, { coal: 1, stick: 1 }] };
    const deps: OldDeps = {
        client: answers.length ? { decide: async () => {
            const [action, item, count, p = 0.9] = answers.shift() || ['done', 'none', 1];
            return answer(action, item, count, p, 1);
        } } : null,
        task: { log_steps: false },
        items,
        near: () => ({ table: true, furnace: true, chest: true }),
        readChest: async () => ({ ...chest }),
        act: {
            craft: async (g, times) => {
                const [out, needs] = recipes[g]!;
                for (const [n, c] of Object.entries(needs)) { if ((have[n] || 0) < c * times) return false; }
                for (const [n, c] of Object.entries(needs)) have[n]! -= c * times;
                have[g] = (have[g] || 0) + out * times;
                did.push(`craft ${g}`);
                return true;
            },
            take: async g => { did.push(`take ${g}`); return false; },
            gather: async g => { did.push(`gather ${g}`); return false; },
            smelt: async () => false, place: async () => false, store: async () => false,
        },
    };
    return { did, deps };
}

test('craft: 80 logs, 1 plank, 0 sticks, the kit sword in the chest: logs → planks → sticks → the stone sword', async () => {
    // the model's "take stick" (live play 3, p 0.92): not in the chest → the recipe rules
    const f = craftFake({ log: 80, planks: 1, cobblestone: 122 }, {}, [['take', 'stick', 1]]);
    const r = await runCraft('stone_sword', 1, f.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(f.did, ['craft planks', 'craft stick', 'craft stone_sword']);
    assert.ok(!f.did.some(d => d.startsWith('take')), 'never reaches for the kit');
});

test('craft: torches with no sticks; the model says done short of the goal; rules only (no model) chain too', async () => {
    let f = craftFake({ log: 80, planks: 1, coal: 31, torch: 14 }, {}, [['done', 'none', 1, 0.999]]);
    let r = await runCraft('torch', 18, f.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(f.did, ['craft planks', 'craft stick', 'craft torch']);
    f = craftFake({ log: 3, cobblestone: 2 }, {});
    r = await runCraft('stone_sword', 1, f.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(f.did, ['craft planks', 'craft stick', 'craft stone_sword']);
});

// ---- new in 5.1 ----

test('resume: the target is kept, so a resumed job makes nothing twice', async () => {
    // the job started with 0 sticks for 4: target 4; it made 4, then paused before the model said done
    const p: { target?: number; steps?: number } = {};
    const w2 = fakeWorld({ oak_planks: 2 }, { script: [answer('craft', 'stick', 1), answer('craft', 'stick', 1), answer('done', 'none', 1)] });
    // a fresh job: target = carried (0 sticks) + 4
    const step1 = await runCraftSteps(w2.deps, 'stick', 4, p, 1);
    assert.equal(step1, 'more');
    assert.deepEqual(p.target, 4);
    assert.equal(w2.inv.stick, 4);
    // the runner is rebuilt on resume with the saved progress: the model's second craft is refused (goal-carried)
    // and the rules see the goal carried: done, with no second craft
    const r = await runCraft('stick', 4, w2.deps, { progress: p });
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(w2.calls.filter(x => x[0] === 'craft').length, 1);
});

/** runCraftSteps runs n steps of a fresh job asking for count more of item; the last step's how. */
async function runCraftSteps(deps: OldDeps, item: string, count: number, progress: object, n: number): Promise<string> {
    const { craftStep } = await import('../src/jobs/craft.js');
    const { CRAFT_DEFAULTS } = await import('../src/jobs/deps.js');
    let how = '';
    for (let i = 0; i < n; i++) {
        const r = await craftStep({
            kind: 'craft', item, count, purpose: 'player', progress,
            settings: () => ({ ...CRAFT_DEFAULTS, enabled: true, log_steps: false, model: deps.client }),
            world: () => ({ items: deps.items, near: () => ({ table: false, furnace: false, chest: false, ...deps.near() }), readChest: async () => null, act: deps.act }),
            log: () => {}, checkpoint: () => {},
        }, new AbortController().signal);
        how = r.how;
    }
    return how;
}

test('a take cut short by an abort is counted on the next step from the pack, never twice', async () => {
    const chest: Counts = { planks: 20 };
    const inv: Record<string, number> = { stick: 2 };
    const c = new AbortController();
    const deps: OldDeps = {
        client: { decide: async () => answer('take', 'planks', 3) },
        task: { log_steps: false },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => ({ table: true, chest: true }),
        readChest: async () => ({ ...chest }),
        act: {
            // the take moves 8 planks, then hangs until aborted
            take: async (_g, _n, signal) => { inv.oak_planks = 8; await new Promise<void>(r => { signal.addEventListener('abort', () => r(), { once: true }); }); return false; },
            craft: async () => true, gather: async () => true, smelt: async () => true, place: async () => true, store: async () => true,
        },
    };
    const progress: { chest?: Counts | null; moving?: unknown; steps?: number } = { };
    const run = runCraftStepsWith(deps, 'wooden_pickaxe', 1, progress, c.signal);
    await new Promise(r => setTimeout(r, 20));
    c.abort();
    const t0 = Date.now();
    assert.equal(await run, 'more');
    assert.ok(Date.now() - t0 < 250);
    assert.ok(progress.moving, 'the take under way is kept');
    assert.equal(progress.chest!.planks, 20);
    // the next step (a resume) counts the 8 planks that came out
    deps.client = { decide: async () => null };
    await runCraftStepsWith(deps, 'wooden_pickaxe', 1, progress, new AbortController().signal);
    assert.equal(progress.moving, undefined);
    assert.equal(progress.chest!.planks, 12);
});

async function runCraftStepsWith(deps: OldDeps, item: string, count: number, progress: object, signal: AbortSignal): Promise<string> {
    const { craftStep } = await import('../src/jobs/craft.js');
    const { CRAFT_DEFAULTS } = await import('../src/jobs/deps.js');
    const r = await craftStep({
        kind: 'craft', item, count, purpose: 'player', progress,
        settings: () => ({ ...CRAFT_DEFAULTS, enabled: true, log_steps: false, model: deps.client }),
        world: () => ({ items: deps.items, near: () => ({ table: false, furnace: false, chest: false, ...deps.near() }),
            readChest: async s => deps.readChest!(s), act: deps.act }),
        log: () => {}, checkpoint: () => {},
    }, signal);
    return r.how;
}

test('the task off, an unknown item, a chore that would gather', async () => {
    const w = fakeWorld({}, { script: [answer('gather', 'log', 1)] });
    w.deps.task.enabled = false;
    const off = await runCraft('stick', 4, w.deps);
    assert.equal(off.say, "I couldn't make 1 stick: the craft task is off (settings.decision models.tasks.craft)."); // the old message's _ → space
    const { craftStep } = await import('../src/jobs/craft.js');
    const { CRAFT_DEFAULTS } = await import('../src/jobs/deps.js');
    const w2 = fakeWorld({}, { script: [answer('gather', 'log', 1)] });
    const r = await craftStep({
        kind: 'gather', item: 'log', count: 4, purpose: 'chore', progress: {},
        settings: () => ({ ...CRAFT_DEFAULTS, enabled: true, model: w2.deps.client }),
        world: () => ({ items: w2.deps.items, near: () => ({ table: false, furnace: false, chest: false }), readChest: async () => null, act: w2.deps.act }),
        log: () => {}, checkpoint: () => {},
    }, new AbortController().signal);
    assert.deepEqual(r, { how: 'end', end: { how: 'failed', reason: 'need_log' } });
    assert.deepEqual(w2.calls, [], 'a chore never gathers itself');
});
