// Fix round 3 (live play 2026-11-11): director activities that stop at
// once, interrupts that end a stuck collect, saved places, the craft chest
// bookkeeping, store keep-list, goal carried, ingredients from the chest,
// the hand, count replies, the Laya client's back-off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import http from 'node:http';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { pause, performActivity } from '../src/agent/laya/activities.js';
import { Director } from '../src/agent/laya/director.js';
import { interruptBot } from '../src/agent/interrupt.js';
import { MemoryBank } from '../src/agent/memory_bank.js';
import { runCraft, check, ingredientFromChest } from '../src/agent/laya/craft.js';
import { situation } from '../src/agent/laya/craft_state.js';
import { plan as commandPlan, keepWhenStoring, named } from '../src/agent/laya/command.js';
import { handChoice, bestWeapon } from '../src/agent/laya/hand.js';
import { jobFailedMessage } from '../src/agent/laya/job_message.js';
import { createLayaClient, BACKOFF_MIN_MS } from '../src/models/laya.js';

// ---- 1. director activities stop promptly ----

test('pause: ends within a step of stopped()', async () => {
    let stop = false;
    const t0 = Date.now();
    setTimeout(() => { stop = true; }, 50);
    assert.equal(await pause(10000, () => stop), true);
    assert.ok(Date.now() - t0 < 400, `took ${Date.now() - t0} ms`);
    assert.equal(await pause(30, () => false), false);
});

test('heal with no food: an interrupt ends the 10 s wait at once (the skeleton death)', async () => {
    let stop = false, said = [];
    const deps = { stopped: () => stop, health: () => 3, food: () => 4, eat: async () => false, nearestDist: () => 12,
        say: m => said.push(m), askedFoodAt: () => 0, setAskedFoodAt: () => {} };
    const t0 = Date.now();
    const run = performActivity('heal', deps);
    setTimeout(() => { stop = true; }, 100); // laya_defending interrupts
    assert.equal(await run, 'stopped');
    assert.ok(Date.now() - t0 < 600, `took ${Date.now() - t0} ms`);
    assert.equal(said.length, 1, 'asks for food');
});

test('heal waiting to regenerate: an interrupt ends it; a mob within 8 ends it; eating stops on interrupt', async () => {
    let stop = false;
    const deps = { stopped: () => stop, health: () => 5, food: () => 20, eat: async () => true, nearestDist: () => null };
    const run = performActivity('heal', deps);
    setTimeout(() => { stop = true; }, 80);
    const t0 = Date.now();
    assert.equal(await run, 'stopped');
    assert.ok(Date.now() - t0 < 500);
    assert.equal(await performActivity('heal', { ...deps, stopped: () => false, nearestDist: () => 6 }), 'mob-near');
    let food = 2, eaten = 0;
    stop = false;
    const eating = performActivity('heal', { ...deps, stopped: () => stop, food: () => food, eat: async () => { eaten++; food += 1; if (eaten === 2) stop = true; return true; } });
    assert.equal(await eating, 'stopped');
    assert.equal(eaten, 2);
    assert.equal(await performActivity('eat', { stopped: () => true, eat: async () => assert.fail('no eating when stopped') }), 'stopped');
    assert.equal(await performActivity('unload', { stopped: () => true, unload: async () => assert.fail('no unload when stopped') }), 'stopped');
});

test('Director: a different answer stops the running heal; a resumed job is not stopped', async () => {
    const calm = { health: 20, food: 20, armed: 'none', armor: 0, hostiles: 0, nearest: null, light: 15, night: false, under: false,
        free: 20, home: null, valuables: 0, foodItems: 0, danger: 'none' };
    let sit = { ...calm, health: 5 };
    let release;
    const stops = [];
    const d = new Director({ read: () => sit, idle: () => true, now: () => 0,
        perform: () => new Promise(r => { release = r; }),
        resume: () => new Promise(() => {}),
        stop: a => { stops.push(a); release(); } });
    assert.equal((await d.tick()).activity, 'heal');
    assert.equal(d.performing, 'heal');
    await d.tick(); // still heal: nothing stopped
    assert.deepEqual(stops, []);
    sit = { ...calm, health: 5, hostiles: 1, nearest: { kind: 'skeleton', dist: 3 } }; // flee-hostile
    assert.equal((await d.tick()).activity, 'flee');
    assert.deepEqual(stops, ['heal'], 'heal stopped for flee');
    // a resumed job runs as performing 'resume': continue doesn't stop it
    const d2 = new Director({ read: () => calm, idle: () => true, now: () => 0, resume: () => new Promise(() => {}), stop: a => stops.push(`2:${a}`) });
    const job = d2.stack.start('layaMine', ['iron', 4]);
    d2.stack.paused(job);
    assert.equal((await d2.tick()).activity, 'resume');
    assert.equal(d2.performing, 'resume');
    d2.stack.resumed(job);
    assert.equal((await d2.tick()).activity, 'continue');
    assert.deepEqual(stops, ['heal']);
});

// ---- 2. interrupts end a stuck collect; places are saved ----

test('interruptBot: clears the path goal (a stuck bot never reaches a node) and cancels a collect once', async () => {
    const bot = new EventEmitter();
    const calls = [];
    let finish;
    bot.stopDigging = () => calls.push('stopDigging');
    bot.pathfinder = { goal: { x: 1 }, stop: () => calls.push('stop'), setGoal: g => { calls.push(['setGoal', g]); bot.pathfinder.goal = g; } };
    bot.collectBlock = { cancelTask: () => { calls.push('cancelTask'); return new Promise(r => { finish = r; }); } };
    bot.pvp = { stop: () => calls.push('pvp') };
    for (let i = 0; i < 12; i++) interruptBot(bot); // ActionManager.stop() every 300 ms
    assert.equal(bot.interrupt_code, true);
    assert.deepEqual(calls.filter(c => Array.isArray(c)), [['setGoal', null]], 'the goal is cleared once (then there is none)');
    assert.equal(calls.filter(c => c === 'cancelTask').length, 1, 'one cancelTask while it is pending (no listener leak)');
    finish();
    await new Promise(r => setTimeout(r, 0));
    interruptBot(bot);
    assert.equal(calls.filter(c => c === 'cancelTask').length, 2, 'asked again once the first finished');
    finish();
    await new Promise(r => setTimeout(r, 0));
    // a rejected cancel doesn't throw
    bot.collectBlock.cancelTask = () => Promise.reject(new Error('error event'));
    interruptBot(bot);
    await new Promise(r => setTimeout(r, 0));
    assert.equal(bot._cancellingCollect, false);
});

test('MemoryBank: every change is saved; loadJson keeps only places', () => {
    const saved = [];
    const m = new MemoryBank(p => saved.push(JSON.parse(JSON.stringify(p))));
    m.rememberPlace('home_chest', 166, 70, 172);
    m.forgetPlace('nothing');
    m.forgetPlace('home_chest');
    assert.deepEqual(saved, [{ home_chest: [166, 70, 172] }, {}]);
    m.loadJson({ home_chest: [1, 2, 3], bad: [1, 'x', 3], junk: 'no' });
    assert.deepEqual(m.recallPlace('home_chest'), [1, 2, 3]);
    assert.equal(m.getKeys(), 'home_chest');
    m.loadJson(null);
    assert.deepEqual(m.getJson(), {});
    const throws = new MemoryBank(() => { throw new Error('disk full'); });
    throws.rememberPlace('a', 1, 2, 3); // never throws
    assert.deepEqual(throws.recallPlace('a'), [1, 2, 3]);
});

test('History.save writes the places; load gives them back (a restart keeps the home chest)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'places-'));
    const cwd = process.cwd();
    process.chdir(dir);
    try {
        const { History } = await import('../src/agent/history.js');
        const agent = { name: 'andy', self_prompter: { state: 0, isStopped: () => true }, task: { taskStartTime: 1 }, last_sender: null };
        agent.memory_bank = new MemoryBank(() => agent.history.save());
        agent.history = new History(agent);
        agent.memory_bank.rememberPlace('home_chest', 166, 70, 172);
        const file = JSON.parse(readFileSync(join(dir, 'bots/andy/memory.json'), 'utf8'));
        assert.deepEqual(file.places, { home_chest: [166, 70, 172] });
        const again = new History({ ...agent });
        const data = again.load();
        const bank = new MemoryBank();
        bank.loadJson(data.places);
        assert.deepEqual(bank.recallPlace('home_chest'), [166, 70, 172]);
    } finally {
        process.chdir(cwd);
    }
});

// ---- 3 and 5. craft: what a take really moved, a retry, goal carried, ingredients ----

const answer = (action, item, count, p = 0.9) => ({
    answers: { Action: { top: action, topProbability: p }, Item: { top: item, topProbability: p }, Count: { top: String(count), topProbability: p } },
    ms: 3,
});

function world(inv, chest, script, { takeMin = 8, failTake = () => false } = {}) {
    const calls = [];
    const add = (name, n) => { inv[name] = (inv[name] || 0) + n; };
    const deps = {
        client: { decide: async () => script.shift() ?? null },
        task: { log_steps: false },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => ({ table: true, chest: true }),
        readChest: async () => { calls.push(['readChest']); return { ...chest }; },
        act: {
            take: async (g, n) => {
                calls.push(['take', g, n]);
                const k = Math.min(chest[g] || 0, Math.max(n, takeMin)); // bulk, like skills' TAKE_IN_BULK
                if (!k || failTake(g)) return false;
                chest[g] -= k; add(g === 'planks' ? 'oak_planks' : g, k);
                return true;
            },
            craft: async (g, t) => {
                calls.push(['craft', g, t]);
                if (g === 'stick') { inv.oak_planks -= 2 * t; add('stick', 4 * t); }
                if (g === 'wooden_sword') { inv.oak_planks -= 2; inv.stick -= 1; add('wooden_sword', 1); }
                if (g === 'torch') { inv.coal -= t; inv.stick -= t; add('torch', 4 * t); }
                if (g === 'stone_pickaxe') { inv.cobblestone -= 3; inv.stick -= 2; add('stone_pickaxe', 1); }
                return true;
            },
            gather: async () => true, smelt: async () => true, place: async () => true, store: async () => true,
        },
    };
    return { deps, calls, inv, chest };
}

test('craft sword: a take that took all 5 planks counts 5, so the next step sees the chest empty (2026-11-11)', async () => {
    // the live log: take planks x1 (took 5), take planks x1 again → failed, no sword
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
    assert.deepEqual(await runCraft('wooden_sword', 1, w2.deps), { ok: false, reason: 'take stick failed', steps: 2 });
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
    const step = { action: 'craft', item: 'torch', count: 1 };
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

test('a failed job says why', () => {
    assert.equal(jobFailedMessage({ name: 'layaCraft', args: ['wooden_sword', 1] }, { ok: false, reason: 'take planks failed' }),
        "I couldn't make 1 wooden sword: take planks failed.");
    assert.equal(jobFailedMessage({ name: 'layaMine', args: ['iron', 4] }, false), "I couldn't mine 4 iron.");
    assert.equal(jobFailedMessage({ name: 'hunt', args: ['cow', 'beef', 3] }, { ok: false, reason: 'no cow nearby' }), "I couldn't hunt for 3 beef: no cow nearby.");
    assert.equal(jobFailedMessage({ name: 'layaFarm', args: ['any'] }, undefined, { success: false }), "I couldn't farm any: something went wrong.");
});

// ---- 4. store everything keeps coal, torches, sticks, tools, weapons, armour, food ----

const cmd = (command, item = 'none', count = 'any') => ({ answers: {
    Addressed: { probability: 1 }, Command: { top: command, topProbability: 1 }, Item: { top: item }, Tier: { top: 'none' }, Count: { top: count } } });

test('store everything keeps what the mine and fights need (2026-11-11: coal stored)', () => {
    for (const n of ['coal', 'charcoal', 'torch', 'stick', 'stone_pickaxe', 'iron_axe', 'wooden_sword', 'bow', 'crossbow', 'shield',
        'iron_helmet', 'leather_boots', 'bread', 'cooked_beef']) assert.ok(keepWhenStoring(n), n);
    for (const n of ['cobblestone', 'dirt', 'oak_log', 'raw_iron', 'arrow', 'bone', 'oak_planks', 'crafting_table'])
        assert.ok(!keepWhenStoring(n), n);
    const carry = [['coal', 9], ['arrow', 1], ['bone', 2], ['oak_planks', 1], ['crafting_table', 2], ['torch', 5], ['stick', 3],
        ['cobblestone', 30], ['stone_pickaxe', 1], ['bread', 4]].map(([item, count]) => ({ item, count }));
    const p = commandPlan(cmd('store', 'none', 'all'), { speaker: 'p', carry, has: () => true, opts: {} });
    assert.equal(p.kind, 'run');
    assert.deepEqual(p.lines, ['!putInChest("arrow", 1)', '!putInChest("bone", 2)', '!putInChest("oak_planks", 1)',
        '!putInChest("crafting_table", 2)', '!putInChest("cobblestone", 30)']);
    // asked by name, coal is stored
    const coal = commandPlan(cmd('store', 'coal', 'all'), { speaker: 'p', carry, has: () => true, opts: {} });
    assert.deepEqual(coal.lines, ['!putInChest("coal", 9)']);
});

// ---- 6. the hand ----

test('handChoice: best weapon, else keep a tool, else a pickaxe, else empty', () => {
    assert.equal(bestWeapon(['wooden_sword', 'iron_sword', 'diamond_axe']), 'iron_sword');
    assert.equal(bestWeapon(['stone_axe', 'iron_pickaxe']), 'stone_axe');
    assert.equal(bestWeapon(['iron_pickaxe']), null);
    assert.deepEqual(handChoice(['arrow', 'wooden_sword'], 'arrow'), { equip: 'wooden_sword' });
    assert.equal(handChoice(['wooden_sword'], 'wooden_sword'), null);
    assert.deepEqual(handChoice(['torch', 'stone_pickaxe', 'wooden_pickaxe'], 'torch'), { equip: 'stone_pickaxe' });
    assert.equal(handChoice(['stone_pickaxe'], 'stone_pickaxe'), null);
    assert.equal(handChoice(['shears', 'dirt'], 'shears'), null);
    assert.deepEqual(handChoice(['arrow', 'dirt'], 'arrow'), { empty: true });
    assert.equal(handChoice(['dirt'], null), null);
});

// ---- 7. replies say the count the job uses ----

test('chat with count any says the count the job is using', () => {
    const ctx = { speaker: 'p', carry: [], has: () => true, arity: () => ({ min: 2, max: 2 }), opts: {} };
    const mine = commandPlan(cmd('mine', 'iron'), ctx);
    assert.match(mine.lines[0], /^!layaMine\("iron", \d+\)$/);
    assert.equal(mine.say, `Mining ${mine.lines[0].match(/(\d+)\)$/)[1]} iron.`);
    const gather = commandPlan(cmd('gather', 'wood'), ctx);
    assert.match(gather.say, /^Gathering \d+ logs\.$/);
    assert.equal(gather.say.match(/\d+/)[0], gather.lines[0].match(/(\d+)\)$/)[1]);
    const craft = commandPlan(cmd('craft', 'sword'), ctx);
    assert.equal(craft.say, 'Making 1 wooden sword.');
    assert.equal(named('log', 1), 'log');
    assert.equal(named('raw_iron', 4), 'raw iron');
});

// ---- 8. an unreachable model server: retry once, back off, log, no throw ----

test('Laya client: unreachable server is retried once, then backed off (rules meanwhile) and logged', async () => {
    const srv = http.createServer();
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}`;
    await new Promise(r => srv.close(r)); // nothing listens: connection refused
    let t = 0;
    const logs = [];
    const fetches = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (...a) => { fetches.push(a[0]); return realFetch(...a); };
    try {
        const cfg = { servers: { golaya: { url } }, tasks: { director: { enabled: true, server: 'golaya', model: 'director', timeout_ms: 500 } } };
        const client = createLayaClient(() => cfg, { log: m => logs.push(m), now: () => t });
        const q = { Activity: { criteria: ['idle'], type: 'choice' } };
        assert.equal(await client.decide('director', 'Director.', q), null);
        assert.equal(fetches.length, 2, 'one retry');
        assert.ok(logs.some(l => /unreachable .*asking again in 1 s/.test(l)), logs.join('\n'));
        assert.equal(await client.decide('director', 'Director.', q), null);
        assert.equal(fetches.length, 2, 'not asked while backing off');
        t += BACKOFF_MIN_MS + 1;
        assert.equal(await client.decide('director', 'Director.', q), null);
        assert.equal(fetches.length, 4);
        assert.ok(logs.some(l => /asking again in 2 s/.test(l)), 'the back-off doubles');
        assert.equal(client.stats('director').failed.unreachable, 3);
    } finally {
        globalThis.fetch = realFetch;
    }
});
