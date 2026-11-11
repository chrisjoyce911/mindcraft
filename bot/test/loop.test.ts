// 3.4: the JobStack, the actuators' abort/ceiling/missing-item contract, the safety activities and the
// director loop's priorities (specs/bot-runtime), with the old bot's test/laya_director, laya_defend,
// laya_fix_round3 and laya_fix_round4 parts ported.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JobStack, jobView } from '../src/director/stack.js';
import { eatFood } from '../src/actuators/eat.js';
import { avoidMobs } from '../src/actuators/avoid.js';
import { escape } from '../src/actuators/escape.js';
import { bestWeapon, handChoice } from '../src/actuators/equip.js';
import { runHeal, runEat, NO_FOOD_TEXT, type ActivityCtx } from '../src/director/activities.js';
import { Motion } from '../src/core/motion.js';
import { sleep } from '../src/core/abort.js';
import { DEFAULT_TIMING } from '../src/director/activities.js';
import type { JobRunner } from '../src/director/jobs.js';
import { world, mobFact, until, flush, baseFacts, type World } from './fakeact.js';

// ---- JobStack (old laya_director "job stack: start, pause under an activity, resume, replace, clear") ----

test('job stack: start, pause, resume, replace, end, clear', () => {
    let t = 1000;
    const st = new JobStack(() => t);
    const job = st.start({ kind: 'mine', ore: 'iron', count: 9 }, 'player', { mined: 3 }, 'tester');
    job.left = () => 6;
    assert.deepEqual(st.running(), { kind: 'mine', item: 'iron_ore', left: 6 });
    assert.equal(job.startedAt, 1000);
    t = 2000;
    st.paused(job);
    assert.equal(st.running(), null);
    assert.equal(st.pausedKind(), 'mine');
    assert.equal(st.last, 'interrupted');
    assert.equal(job.pausedAt, 2000);
    st.resumed(job);
    assert.deepEqual(st.running(), { kind: 'mine', item: 'iron_ore', left: 6 });
    const b = st.start({ kind: 'farm', crop: 'wheat', goal: 'forever' }, 'player', {});
    assert.deepEqual(st.entries, [b], 'a new command replaces the top job');
    assert.deepEqual(jobView(b), { kind: 'farm', item: 'wheat', left: 'any' });
    st.ended(b, { how: 'failed', reason: 'no-path' });
    assert.equal(st.last, 'failed');
    st.start({ kind: 'craft', item: 'torch', count: 4 }, 'chore', {});
    assert.equal(st.last, 'none');
    assert.deepEqual(jobView({ ...b, spec: { kind: 'hunt', mob: 'cow', item: 'beef', count: 3 } }), { kind: 'attack', item: 'cow', left: 3 });
    st.clear();
    assert.equal(st.job(), null);
    assert.equal(st.depth, 0);
});

// ---- actuators ----

test('hand: best weapon (sword over axe, better tier), handChoice', () => {
    assert.equal(bestWeapon(['stone_axe', 'iron_sword', 'wooden_sword']), 'iron_sword');
    assert.equal(bestWeapon(['iron_pickaxe', 'stone_axe']), 'stone_axe');
    assert.equal(bestWeapon(['iron_pickaxe']), null);
    assert.equal(handChoice(['iron_sword'], 'iron_sword'), null);
    assert.deepEqual(handChoice(['arrow', 'stone_pickaxe'], 'arrow'), { equip: 'stone_pickaxe' });
    assert.deepEqual(handChoice(['torch'], 'torch'), { empty: true });
});

test('eatFood: missing-item, ok, abort settles within 250 ms though consume never does, ceiling → timeout', async () => {
    const w = world({ items: [{ name: 'bread', count: 2 }] });
    const c = new AbortController();
    assert.deepEqual(await eatFood(w.act.bot, 'apple', c.signal), { ok: false, reason: 'missing-item', detail: 'apple' });
    assert.deepEqual(await eatFood(w.act.bot, 'bread', c.signal), { ok: true });
    w.consumeMs = Infinity;
    const p = eatFood(w.act.bot, 'bread', c.signal);
    await flush(20);
    const t0 = Date.now();
    c.abort();
    assert.equal((await p).ok === false && (await p as { reason: string }).reason, 'cancelled');
    assert.ok(Date.now() - t0 < 250);
    assert.ok(w.calls.some(x => x.what === 'deactivate'), 'the item is let go');
    const o = await eatFood(w.act.bot, 'bread', new AbortController().signal, 60);
    assert.deepEqual(o, { ok: false, reason: 'timeout' });
});

test('avoidMobs: runs while a mob is near, ok once none; ceiling → timeout; abort → cancelled', async () => {
    const w = world();
    const zombie = { id: 5, name: 'zombie', position: { x: 4, y: 64, z: 0 } };
    let n = 0;
    assert.deepEqual(await avoidMobs(w.act, () => (n++ < 2 ? zombie : null), new AbortController().signal), { ok: true });
    assert.equal(w.calls.filter(c => c.what === 'moveFor').length, 2);
    assert.deepEqual(await avoidMobs(w.act, () => zombie, new AbortController().signal, 24, 50), { ok: false, reason: 'timeout' });
    const c = new AbortController();
    const p = avoidMobs(w.act, () => zombie, c.signal);
    setTimeout(() => c.abort(), 30);
    assert.deepEqual(await p, { ok: false, reason: 'cancelled' });
});

test('escape: drowning swims up until the head is out of water; abort → cancelled; jump released', async () => {
    const w = world();
    let water = true;
    w.act.bot.blockAt = () => (water ? { name: 'water' } : { name: 'air' });
    setTimeout(() => { water = false; }, 50);
    assert.deepEqual(await escape(w.act, 'drowning', new AbortController().signal), { ok: true });
    assert.ok(w.calls.some(c => c.what === 'control jump true'));
    assert.equal(w.calls.at(-1)?.what, 'control jump false');
    water = true;
    const c = new AbortController();
    const p = escape(w.act, 'drowning', c.signal);
    setTimeout(() => c.abort(), 30);
    assert.deepEqual(await p, { ok: false, reason: 'cancelled' });
    // burning with no bucket and no water near: move 5 away
    assert.deepEqual(await escape(w.act, 'fire', new AbortController().signal), { ok: true });
    assert.deepEqual(w.calls.filter(c => c.what === 'goTo').at(-1)?.arg, { invert: { near: 0.5, range: 5 } });
});

test('Motion.moveFor: sets a dynamic goal for ms then clears it; abort clears it at once', async () => {
    const goals: unknown[] = [];
    const m = new Motion({ pathfinder: { goto: async () => {}, setGoal: (g: unknown) => { goals.push(g); } }, stopDigging: () => {}, clearControlStates: () => {} });
    assert.deepEqual(await m.moveFor('g', 20, new AbortController().signal), { ok: true });
    assert.deepEqual(goals, ['g', null]);
    const c = new AbortController();
    const p = m.moveFor('h', 60000, c.signal);
    assert.equal(m.moving, true);
    const t0 = Date.now();
    c.abort();
    assert.deepEqual(await p, { ok: false, reason: 'cancelled' });
    assert.ok(Date.now() - t0 < 50);
    assert.equal(m.moving, false);
});

// ---- activities (old laya_fix_round3: heal and pause) ----

function ctxOf(w: World): ActivityCtx {
    return {
        act: w.act, facts: () => w.facts, eatModel: null, defendModel: null, say: t => w.said.push(t),
        log: { eat: (d, o) => w.eats.push(`${d.food ?? 'none'} ${o}`), defend: () => {} },
        timing: DEFAULT_TIMING, now: Date.now, askedFoodAt: 0,
    };
}

test('heal with no food: asks once, an abort ends the 10 s wait at once (the skeleton death)', async () => {
    const w = world({ facts: { health: 3, food: 4 } });
    const ctx = ctxOf(w);
    const c = new AbortController();
    const t0 = Date.now();
    const run = runHeal(ctx, c.signal);
    setTimeout(() => c.abort(), 100);
    assert.equal(await run, 'stopped');
    assert.ok(Date.now() - t0 < 400, `took ${Date.now() - t0} ms`);
    assert.deepEqual(w.said, [NO_FOOD_TEXT]);
    const again = runHeal(ctx, AbortSignal.timeout(50));
    assert.equal(await again, 'stopped');
    assert.equal(w.said.length, 1, 'at most every 2 min');
});

test('heal: eats (the eat rules) until food ≥ 18, then waits until health > 8; a mob within 8 ends it; an abort ends the wait', async () => {
    const w = world({ facts: { health: 5, food: 10, foodItems: 4, items: [{ name: 'bread', count: 4 }] }, items: [{ name: 'bread', count: 4 }] });
    const ctx = ctxOf(w);
    // food rises by 5 per bread in the fake: 10 → 15 → 20, then health comes back
    setTimeout(() => { w.facts = { ...w.facts, health: 12 }; }, 600);
    assert.equal(await runHeal(ctx, new AbortController().signal), 'done');
    assert.deepEqual(w.eats, ['bread ate', 'bread ate']);
    assert.equal(w.facts.food, 20);
    w.facts = { ...w.facts, health: 5 };
    w.addMob(mobFact(9, 'zombie', 6, 0, false));
    assert.equal(await runHeal(ctx, new AbortController().signal), 'mob-near');
    w.removeMob(9);
    const c = new AbortController();
    const p = runHeal(ctx, c.signal);
    setTimeout(() => c.abort(), 60);
    const t0 = Date.now();
    assert.equal(await p, 'stopped');
    assert.ok(Date.now() - t0 < 250);
    assert.equal(await runEat(ctx, AbortSignal.abort()), 'stopped', 'no eating when stopped');
});

// ---- the director: priorities and the lease ----

test('a creeper at 6, nobody hurt: no defend, nothing attacked', async () => {
    const w = world();
    w.addMob(mobFact(7, 'creeper', 6, 0, false));
    const d = await w.director.decide('tick');
    assert.notEqual(d?.answer, 'defend');
    await flush(50);
    assert.equal(w.calls.filter(c => c.what === 'attack').length, 0);
    assert.equal(w.director.holder, null);
});

test('a zombie hits a player 10 away: defend-player, andy fights that zombie only', async () => {
    const w = world({ items: [{ name: 'iron_sword', count: 1 }], facts: { armed: 'sword' } });
    w.entities[1001] = { id: 1001, name: 'player', username: 'tester', position: { x: 10, y: 64, z: 3 } };
    w.onGoTo = () => { w.facts = { ...w.facts, pos: { x: 9, y: 64, z: 1 } }; };   // andy goes to tester
    w.addMob(mobFact(11, 'zombie', 10, 1, true));    // hit tester
    w.addMob(mobFact(12, 'zombie', 2, 1, false));    // near andy, attacking nobody
    w.facts = { ...w.facts, player: { name: 'tester', dist: 10, attacked: { by: 'zombie', entityId: 11, at: 0, dist: 10 } }, nearestPlayer: 10 };
    const d = await w.director.decide('hurt');
    assert.equal(d?.answer, 'defend');
    assert.equal(d?.rule, 'defend-player');
    assert.equal(w.director.holder, 'director:defend');
    assert.ok(await until(() => w.calls.some(c => c.what === 'attack')), 'it attacks');
    assert.deepEqual(w.calls.filter(c => c.what === 'attack').map(c => c.arg), [11], 'only the attacker');
    assert.ok(w.calls.some(c => c.what === 'equip' && c.arg === 'iron_sword'), 'best weapon first');
    assert.ok(await until(() => w.director.holder === null), 'the activity ends (calm) and frees the body');
    assert.ok(w.defends[0]?.startsWith('fight zombie 1'), w.defends.join());
    assert.deepEqual(w.said, ["Hang on tester, I'm coming for that zombie!"]);
});

test('defend-player: an attacker beyond reach → go to the player first, saying so once', async () => {
    const w = world();
    w.entities[1001] = { id: 1001, name: 'player', username: 'tester', position: { x: 22, y: 64, z: 0 } };
    w.addMob(mobFact(21, 'husk', 25, 0, true));
    w.facts = { ...w.facts, player: { name: 'tester', dist: 22, attacked: { by: 'zombie', entityId: 21, at: 0, dist: 25 } }, nearestPlayer: 22 };
    const d = await w.director.decide('hurt');
    assert.equal(d?.answer, 'defend');
    assert.ok(await until(() => w.calls.some(c => c.what === 'goTo')));
    await flush(60);
    assert.deepEqual(w.said, ["Hang on tester, I'm coming for that husk!"]);
    await w.director.stop();
});

test('health 5, a skeleton at 10, no food: flee only (flee-ranged), nothing else acts', async () => {
    const w = world({ facts: { health: 5, food: 20 } });
    w.addMob(mobFact(30, 'skeleton', 10, 0, false));
    const d = await w.director.decide('tick');
    assert.deepEqual([d?.answer, d?.rule], ['flee', 'flee-ranged']);
    assert.equal(w.director.holder, 'director:flee');
    assert.ok(await until(() => w.calls.some(c => c.what === 'moveFor')));
    assert.equal(w.calls.filter(c => c.what === 'attack').length, 0);
    await w.director.stop();
});

test('flee with Danger fire runs escape', async () => {
    const w = world({ facts: { danger: 'fire' } });
    const d = await w.director.decide('tick');
    assert.deepEqual([d?.answer, d?.rule], ['flee', 'flee-danger']);
    assert.equal(w.director.holder, 'director:escape');
    await w.director.stop();
});

test('the eat model alongside an idle director: eats bread at 15 (one body owner)', async () => {
    const w = world({ facts: { food: 15, saturation: 0, foodItems: 8, items: [{ name: 'bread', count: 8 }] }, items: [{ name: 'bread', count: 8 }] });
    const d = await w.director.decide('tick');
    assert.equal(d?.answer, 'idle');
    assert.equal(w.logs.at(-1)?.acted, 'eat-model');
    assert.equal(w.director.holder, 'director:eat');
    assert.ok(await until(() => w.eats.includes('bread ate')), w.eats.join());
    assert.equal(w.items[0]?.count, 7);
});

test('stop clears the stack and frees the body within 2 s even when the activity never settles (stop-overrun)', async () => {
    const w = world({ facts: { food: 15, saturation: 0, foodItems: 8, items: [{ name: 'bread', count: 8 }] }, items: [{ name: 'bread', count: 8 }] });
    w.consumeMs = Infinity;
    // an activity that ignores its signal: replace eat's consume race by a stuck equip
    w.act.bot.equip = () => new Promise(() => {});
    w.director.stack.start({ kind: 'stay', seconds: -1 }, 'player', {});
    await w.director.decide('tick');
    assert.equal(w.director.holder, 'director:eat');
    const t0 = Date.now();
    await w.director.stop();
    const ms = Date.now() - t0;
    assert.ok(ms < 2200, `${ms} ms`);
    assert.equal(w.lease.isFree, true);
    assert.equal(w.director.stack.depth, 0);
    // eatFood races equip against the signal, so it settles at once: no overrun here
    assert.ok(ms < 300, `the eat activity settles at once (${ms} ms)`);
});

test('a never-settling activity: stop frees the lease within 2 s and logs stop-overrun', async () => {
    const w = world({ overrunMs: 300 });
    await w.lease.take('director:heal', () => new Promise<never>(() => {}));
    const t0 = Date.now();
    await w.director.stop();
    assert.ok(Date.now() - t0 < 500);
    assert.deepEqual(w.notes, ['stop-overrun director:heal']);
    assert.equal(w.lease.isFree, true);
});

test('death clears the stack; the next decision starts empty', async () => {
    const w = world();
    w.director.stack.start({ kind: 'mine', ore: 'coal', count: 4 }, 'player', {});
    w.director.event('death');
    await flush(10);
    assert.equal(w.director.stack.depth, 0);
    const d = await w.director.decide('spawn');
    assert.equal(d?.answer, 'idle');
});

test('resume after a fight: the job is paused under defend and resumes with its progress kept', async () => {
    const steps: number[] = [];
    let allowed = 0, used = 0;
    const runners = (entry: { progress: unknown }): JobRunner => ({
        entry: entry as JobRunner['entry'],
        step: async (_f, signal) => {
            while (allowed <= used) await sleep(5, signal);   // a step waits for the test's go
            used++;
            const p = entry.progress as { n: number };
            p.n++;
            steps.push(p.n);
            return p.n >= 3 ? { how: 'end', end: { how: 'done' } } : { how: 'more' };
        },
    });
    const w = world({ runners: runners as never, items: [{ name: 'stone_sword', count: 1 }] });
    const job = await w.director.startJob({ kind: 'farm', crop: 'wheat', goal: { count: 3 } }, 'player', { n: 0 });
    assert.ok(job);
    assert.equal(w.director.holder, 'job:farm');
    allowed = 1;
    assert.ok(await until(() => steps.length === 1));
    // a zombie hits andy: defend pauses the job
    w.addMob(mobFact(40, 'zombie', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 40, at: 0, dist: 2 } };
    const d = await w.director.decide('hurt');
    assert.equal(d?.answer, 'defend');
    assert.equal(w.director.holder, 'director:defend');
    assert.equal(job.status, 'paused');
    assert.equal(w.director.stack.last, 'interrupted');
    // the zombie dies (the fake attack kills it), defend ends calm, the director answers resume
    assert.ok(await until(() => w.director.holder === 'job:farm'), `holder ${w.director.holder}`);
    assert.ok(w.logs.some(l => l.answer === 'resume' && l.event === 'defend-done'), 'resume answered after the fight');
    assert.equal(job.status, 'running');
    allowed = 2;
    assert.ok(await until(() => steps.length === 2));
    assert.deepEqual(steps, [1, 2], 'progress kept: the second step, not a restart');
    allowed = 3;
    assert.ok(await until(() => w.director.stack.depth === 0));
    assert.equal(w.director.stack.last, 'done');
    await w.director.stop();
});

test('a different safety answer preempts the running activity; the same answer leaves it running', async () => {
    const w = world({ facts: { health: 5, food: 20 } });
    w.director.timing.healMs = 60000;
    let d = await w.director.decide('tick');
    assert.equal(d?.answer, 'heal');
    assert.equal(w.director.holder, 'director:heal');
    d = await w.director.decide('tick');
    assert.equal(w.director.holder, 'director:heal', 'still heal: not restarted');
    w.addMob(mobFact(50, 'skeleton', 3, 0, false)); // flee-hostile (health 5, within 4)
    d = await w.director.decide('tick');
    assert.equal(d?.answer, 'flee');
    assert.equal(w.director.holder, 'director:flee');
    await w.director.stop();
});

test('defend ends calm → no quiet spell (only ignore starts one); the 1 s restart hold stops a hot loop', async () => {
    const w = world();
    // a spider by day attacked andy: the defend rules say calm (spiders are calm by day)
    w.addMob(mobFact(60, 'spider', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'spider', entityId: 60, at: 0, dist: 2 } };
    const d = await w.director.decide('hurt');
    assert.equal(d?.answer, 'defend');
    assert.ok(await until(() => w.logs.length === 2), 'the decision after the activity ends');
    assert.deepEqual([w.logs[1]?.event, w.logs[1]?.answer, w.logs[1]?.acted], ['defend-done', 'defend', 'hold']);
    assert.equal(w.director.holder, null);
    assert.deepEqual(w.defends, [], 'the defend rules say calm: nothing to log or do');
});

test('a second attacker right after a kill is defended at once (no quiet after calm/gone; a hit breaks quiet)', async () => {
    const w = world({ items: [{ name: 'iron_sword', count: 1 }], facts: { armed: 'sword' } });
    w.director.timing.quietMs = 60000;
    w.addMob(mobFact(80, 'zombie', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 80, at: 0, dist: 2 } };
    assert.equal((await w.director.decide('hurt'))?.answer, 'defend');
    assert.ok(await until(() => w.calls.some(c => c.what === 'attack' && c.arg === 80)), 'fights the first');
    assert.ok(await until(() => w.director.holder === null), 'the first dies: defend ends');
    // within quiet_ms (and the restart hold) a second zombie hits andy
    w.addMob(mobFact(81, 'zombie', 2, 1, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 81, at: 0, dist: 2 } };
    const d = await w.director.decide('hurt');
    assert.equal(d?.answer, 'defend');
    assert.equal(w.logs.at(-1)?.acted, undefined, 'acted on, not held');
    assert.ok(await until(() => w.calls.some(c => c.what === 'attack' && c.arg === 81)), 'fights the second at once');
    await w.director.stop();
});

test('after an ignore end the quiet spell holds a tick\'s defend answer, but a hurt event breaks it', async () => {
    const w = world();
    w.director.timing.quietMs = 60000;
    (w.director as unknown as { quietUntil: number }).quietUntil = Date.now() + 60000;   // as after 'ignore'
    w.addMob(mobFact(90, 'zombie', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 90, at: 0, dist: 2 } };
    await w.director.decide('tick');
    assert.equal(w.logs.at(-1)?.acted, 'quiet');
    assert.equal(w.director.holder, null);
    await w.director.decide('hurt');
    assert.equal(w.director.holder, 'director:defend');
    await w.director.stop();
});

test('events never move the body: every actuator call happens under the lease', async () => {
    const w = world({ items: [{ name: 'bread', count: 3 }, { name: 'iron_sword', count: 1 }], facts: { food: 14, saturation: 0, foodItems: 3, items: [{ name: 'bread', count: 3 }] } });
    await w.director.decide('tick');               // eat (eat model)
    await until(() => w.director.holder === null);
    w.addMob(mobFact(70, 'zombie', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 70, at: 0, dist: 2 } };
    w.director.event('hurt');                      // defend
    await until(() => w.calls.some(c => c.what === 'attack'));
    await until(() => w.director.holder === null);
    assert.ok(w.calls.length > 0);
    for (const c of w.calls) assert.ok(c.holder?.startsWith('director:'), `${c.what} outside the lease (${c.holder})`);
    await w.director.stop();
});

test('quiet logging: repeated idle on tick is logged once', async () => {
    const w = world();
    await w.director.decide('tick');
    await w.director.decide('tick');
    await w.director.decide('chat');
    assert.deepEqual(w.logs.map(l => `${l.event} ${l.answer}`), ['tick idle', 'chat idle']);
    assert.match(w.logs[0]!.state, /^Director\./);
    void baseFacts;
});

test('heal waiting: hunger drops below 18 → eats again (no regeneration below 18); health 8.4 shows as 8: still hurt', async () => {
    const w = world({ facts: { health: 8.4, food: 19, saturation: 0, foodItems: 4, items: [{ name: 'bread', count: 4 }] }, items: [{ name: 'bread', count: 4 }] });
    const ctx = ctxOf(w);
    setTimeout(() => { w.facts = { ...w.facts, food: 15 }; }, 50);
    setTimeout(() => { w.facts = { ...w.facts, health: 9 }; }, 1300);
    assert.equal(await runHeal(ctx, new AbortController().signal), 'done');
    assert.deepEqual(w.eats, ['bread ate']);
});

test('an activity that ended by itself is not restarted at once for the same answer (no hot loop)', async () => {
    const w = world({ facts: { health: 5, food: 20 } });
    // heal ends at once ('done') because its own check sees health 9 while the director still answers heal
    w.director.timing.healMs = 0;
    await w.director.decide('tick');
    assert.ok(await until(() => w.logs.some(l => l.event === 'heal-done')));
    const after = w.logs.filter(l => l.event === 'heal-done');
    assert.equal(after.length, 1, 'one decision after the end, not a loop');
    assert.equal(after[0]?.acted, 'hold');
    await flush(100);
    assert.equal(w.logs.filter(l => l.event === 'heal-done').length, 1);
});

test('the eat model refuses (rotten flesh, not starving): the director\'s eat answer is held, not looped', async () => {
    const w = world({ facts: { health: 15, food: 15, foodItems: 2, items: [{ name: 'rotten_flesh', count: 2 }] }, items: [{ name: 'rotten_flesh', count: 2 }] });
    w.director.timing.checkMs = 60000;   // the eat model alongside isn't due again
    const d = await w.director.decide('tick');
    assert.deepEqual([d?.answer, d?.rule], ['eat', 'eat-idle']);
    assert.ok(await until(() => w.logs.some(l => l.event === 'eat-done')));
    assert.ok(w.eats.length >= 1 && w.eats.every(e => e === 'none no-eat'), w.eats.join());   // alongside + the activity
    await flush(1100);   // past the restart hold
    await w.director.decide('tick');
    assert.equal(w.logs.at(-1)?.acted, 'eat-refused');
    assert.equal(w.director.holder, null);
    w.facts = { ...w.facts, food: 6 };   // hungrier: asked again (and the rules eat bad food when starving)
    await w.director.decide('tick');
    assert.equal(w.director.holder, 'director:eat');
    assert.ok(await until(() => w.eats.includes('rotten_flesh ate')), w.eats.join());
});
