// 4.2 the simple jobs through the director (come, stay, give, store, home, follow) with the fake act: the old
// messages, the old action labels on the lease, ended() for a plan of several jobs, a real runner paused by
// defend and resumed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRunner, FOLLOW_DEFAULTS, type JobDeps } from '../src/jobs/index.js';
import type { PlaceBook } from '../src/home/places.js';
import type { Places, Vec3Like } from '../src/types/index.js';
import { handleChat, type CommandDeps } from '../src/command/handle.js';
import { world, until, mobFact, flush, type World } from './fakeact.js';

function book(init: Places = {}): PlaceBook & { places: Places } {
    const places: Places = { ...init };
    return {
        places,
        all: () => ({ ...places }),
        recall: n => places[n] ?? null,
        remember: (n, p: Vec3Like) => { places[n] = [p.x, p.y, p.z]; },
        forget: n => { delete places[n]; },
    };
}

function jobWorld(o: { items?: { name: string; count: number }[]; places?: Places } = {}) {
    const places = book(o.places);
    const notes: string[] = [];
    const deps = (w: World): JobDeps => ({
        act: () => w.act, places, follow: () => ({ ...FOLLOW_DEFAULTS, model: null }),
        followLog: () => {}, note: t => notes.push(t),
    });
    const w = world({ items: o.items ?? [], jobs: x => e => makeRunner(e, deps(x)) });
    w.players.tester = { id: 9, username: 'tester', position: { x: 6.5, y: 64, z: 0.5 } };
    return { w, places, notes };
}

test('come: walks to the player (goToPlayer label) and says so; a missing player fails with the old text', async () => {
    const { w } = jobWorld();
    const job = await w.director.startJob({ kind: 'come', player: 'tester', distance: 2 }, 'player', {}, 'tester');
    assert.ok(job);
    assert.equal(w.director.holder, 'action:goToPlayer');
    assert.deepEqual(await w.director.ended(job), { how: 'done' });
    assert.deepEqual(w.said, ['You have reached tester.']);
    assert.deepEqual(w.calls.find(c => c.what === 'goTo'), { what: 'goTo', arg: { follow: 9, range: 2 }, holder: 'action:goToPlayer' });
    const lost = await w.director.startJob({ kind: 'come', player: 'nobody', distance: 0 }, 'player', {});
    assert.deepEqual(await w.director.ended(lost!), { how: 'failed', reason: 'Could not find nobody.' });
    assert.equal(w.said.at(-1), 'Could not find nobody.');
    assert.equal(w.director.stack.last, 'failed');
    await w.director.stop();
});

test('stay: stands for the seconds asked, then says how long; stop ends it at once', async () => {
    const { w } = jobWorld();
    const job = await w.director.startJob({ kind: 'stay', seconds: 0.1 }, 'player', {});
    assert.equal(w.director.holder, 'action:stay');
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.match(w.said.at(-1)!, /^Stayed for 0\.1\d* seconds\.$/);
    const forever = await w.director.startJob({ kind: 'stay', seconds: -1 }, 'player', {});
    await flush(50);
    assert.equal(w.director.holder, 'action:stay');
    const t0 = Date.now();
    const end = w.director.ended(forever!);
    await w.director.stop();
    assert.deepEqual(await end, { how: 'cancelled' });
    assert.ok(Date.now() - t0 < 300);
    assert.equal(w.lease.isFree, true);
});

test('give: tosses only the asked count at the player, the old texts on every branch', async () => {
    const { w } = jobWorld({ items: [{ name: 'coal', count: 3 }, { name: 'coal', count: 4 }, { name: 'dirt', count: 9 }] });
    let job = await w.director.startJob({ kind: 'give', player: 'tester', item: 'coal', count: 5 }, 'player', {}, 'tester');
    assert.equal(w.director.holder, 'action:givePlayer');
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.equal(w.said.at(-1), 'tester received coal.');
    assert.deepEqual(w.tossed, [{ name: 'coal', count: 5 }]);
    assert.deepEqual(w.items, [{ name: 'coal', count: 2 }, { name: 'dirt', count: 9 }]);
    const look = w.calls.findIndex(c => c.what === 'look'), toss = w.calls.findIndex(c => c.what === 'toss');
    assert.ok(look >= 0 && look < toss, 'looked at the player before the toss');
    for (const [spec, text] of [
        [{ player: 'andy', item: 'coal', count: 1 }, 'You cannot give items to yourself.'],
        [{ player: 'nobody', item: 'coal', count: 1 }, 'Could not find nobody.'],
        [{ player: 'tester', item: 'diamond', count: 1 }, 'You do not have any diamond.'],
    ] as const) {
        job = await w.director.startJob({ kind: 'give', ...spec }, 'player', {});
        assert.deepEqual(await w.director.ended(job!), { how: 'failed', reason: text });
        assert.equal(w.said.at(-1), text);
    }
    w.collects = false;
    job = await w.director.startJob({ kind: 'give', player: 'tester', item: 'dirt', count: 2 }, 'player', {});
    assert.deepEqual(await w.director.ended(job!), { how: 'failed', reason: 'Failed to give dirt to tester, it was never received.' });
    assert.equal(w.tossed.length, 2, 'nothing else tossed');
    await w.director.stop();
});

test('give: a player too close that andy can\'t back away from fails "too close" without a toss', async () => {
    const { w } = jobWorld({ items: [{ name: 'coal', count: 3 }] });
    w.players.tester!.position = { x: 1, y: 64, z: 0.5 };
    const job = await w.director.startJob({ kind: 'give', player: 'tester', item: 'coal', count: 1 }, 'player', {});
    assert.deepEqual(await w.director.ended(job!), { how: 'failed', reason: 'Failed to give coal to tester, too close.' });
    assert.deepEqual(w.tossed, []);
    assert.ok(w.calls.some(c => c.what === 'moveFor' && JSON.stringify(c.arg) === JSON.stringify({ invert: { follow: 9, range: 5 } })));
    await w.director.stop();
});

test('store: the nearest chest within 32, the count capped at what andy has; the chest is always closed', async () => {
    const { w } = jobWorld({ items: [{ name: 'cobblestone', count: 20 }] });
    let job = await w.director.startJob({ kind: 'store', item: 'cobblestone', count: 64 }, 'player', {});
    assert.deepEqual(await w.director.ended(job!), { how: 'failed', reason: 'Could not find a chest nearby.' });
    w.blocks['30,64,0'] = { name: 'chest' };
    w.blocks['4,64,2'] = { name: 'chest' };
    w.blocks['1,64,1'] = { name: 'barrel' };
    job = await w.director.startJob({ kind: 'store', item: 'cobblestone', count: 64 }, 'player', {});
    assert.equal(w.director.holder, 'action:putInChest');
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.equal(w.said.at(-1), 'Successfully put 20 cobblestone in the chest.');
    assert.deepEqual(w.chests, { '4,64,2': { cobblestone: 20 } });
    assert.deepEqual(w.calls.filter(c => ['open', 'deposit', 'close'].includes(c.what)).map(c => c.what), ['open', 'deposit', 'close']);
    job = await w.director.startJob({ kind: 'store', item: 'cobblestone', count: 1 }, 'player', {});
    assert.deepEqual(await w.director.ended(job!), { how: 'failed', reason: 'You do not have any cobblestone to put in the chest.' });
    w.items.push({ name: 'dirt', count: 3 });
    w.openFails = true;
    job = await w.director.startJob({ kind: 'store', item: 'dirt', count: 3 }, 'player', {});
    const end = await w.director.ended(job!);
    assert.equal(end.how, 'failed');
    assert.match(w.said.at(-1)!, /^Could not put dirt in the chest: error\.$/);
    assert.deepEqual(w.items.find(i => i.name === 'dirt'), { name: 'dirt', count: 3 }, 'nothing lost');
    await w.director.stop();
});

test('home: the chest nearest the speaker within 8 becomes home_chest; table and chores centre forgotten', async () => {
    const { w, places } = jobWorld({ places: { home_table: [1, 2, 3], chores_centre: [4, 5, 6], spawn: [0, 64, 0] } });
    let job = await w.director.startJob({ kind: 'home' }, 'player', {}, 'tester');
    assert.deepEqual(await w.director.ended(job!), { how: 'failed', reason: "I can't see a chest near you." });
    assert.equal(w.said.at(-1), "I can't see a chest near you.");
    w.blocks['9,64,0'] = { name: 'chest' };   // 2.5 from tester, 8.5 from andy
    w.blocks['-2,64,0'] = { name: 'chest' };  // near andy only
    job = await w.director.startJob({ kind: 'home' }, 'player', {}, 'tester');
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.equal(w.said.at(-1), 'Home chest set at 9 64 0.');
    assert.deepEqual(places.places, { spawn: [0, 64, 0], home_chest: [9, 64, 0] });
    job = await w.director.startJob({ kind: 'home' }, 'player', {}, undefined, { doneSay: "That's my chest now." });
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.equal(w.said.at(-1), "That's my chest now.", 'the plan\'s doneSay instead of the runner\'s line');
    assert.deepEqual(places.places.home_chest, [-2, 64, 0], 'no speaker: the chest nearest andy');
    await w.director.stop();
});

test('ended: a replaced job ends cancelled; the kinds not built yet start nothing and keep the running job', async () => {
    const { w } = jobWorld();
    const a = await w.director.startJob({ kind: 'stay', seconds: -1 }, 'player', {});
    const aEnd = w.director.ended(a!);
    const b = await w.director.startJob({ kind: 'stay', seconds: -1 }, 'player', {});
    assert.deepEqual(await aEnd, { how: 'cancelled' });
    assert.deepEqual(await w.director.ended(a!), { how: 'cancelled' }, 'not on the stack: at once');
    assert.equal(await w.director.startJob({ kind: 'farm', crop: 'wheat', goal: { count: 3 } }, 'player', {}), null);
    assert.equal(w.director.stack.depth, 0, 'the director replaces the top job: main checks makeRunner first');
    void b;
    await w.director.stop();
});

test('a plan of several jobs: handleChat stops at the first that doesn\'t end done', async () => {
    const ran: string[] = [];
    const deps: CommandDeps = {
        me: 'andy', model: { client: { decide: async () => ({ model: 'f', ms: 1, answers: {
            Addressed: { type: 'noul', probability: 0.99, top: 'true', topProbability: 0.99, confident: true },
            Command: { type: 'choice', top: 'store', topProbability: 0.99, confident: true, probabilities: {} },
            Item: { type: 'choice', top: 'none', topProbability: 0.9, confident: true, probabilities: {} },
            Tier: { type: 'choice', top: 'none', topProbability: 0.9, confident: true, probabilities: {} },
            Count: { type: 'choice', top: 'all', topProbability: 0.9, confident: true, probabilities: {} },
        } }) }, prompt: 'v2.1' },
        carry: () => [{ name: 'dirt', count: 5 }, { name: 'sand', count: 3 }, { name: 'gravel', count: 2 }],
        nearestHostile: () => null, say: () => {}, log: () => {},
        run: async c => { ran.push(c.kind === 'job' && c.job.kind === 'store' ? c.job.item : c.kind); return ran.length < 2; },
    };
    await handleChat('tester', 'andy store everything', deps);
    assert.deepEqual(ran, ['dirt', 'sand'], 'gravel never started');
});

test('follow: a real runner is paused by defend and resumed (action:followPlayer again)', async () => {
    const { w } = jobWorld({ items: [{ name: 'stone_sword', count: 1 }] });
    const job = await w.director.startJob({ kind: 'follow', player: 'tester', distance: 3 }, 'player', {}, 'tester');
    assert.equal(w.director.holder, 'action:followPlayer');
    assert.ok(await until(() => w.calls.some(c => c.what === 'moveFor' && c.holder === 'action:followPlayer')));
    w.addMob(mobFact(40, 'zombie', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 40, at: 0, dist: 2 } };
    const d = await w.director.decide('hurt');
    assert.equal(d?.answer, 'defend');
    assert.equal(job!.status, 'paused');
    assert.ok(await until(() => w.director.holder === 'action:followPlayer'), `holder ${w.director.holder}`);
    assert.equal(job!.status, 'running');
    assert.ok(w.logs.some(l => l.answer === 'resume'));
    const moves = w.calls.filter(c => c.what === 'moveFor' || c.what === 'goTo' || c.what === 'moveUntil');
    assert.ok(moves.every(c => c.holder !== null), 'nothing moved the body outside the lease');
    await w.director.stop();
    assert.equal(w.lease.isFree, true);
});

/** pauseByDefend: a zombie hits andy now, so defend takes the lease from the running job. */
function pauseByDefend(w: World): void {
    w.addMob(mobFact(40, 'zombie', 2, 0, true));
    w.facts = { ...w.facts, me: { by: 'zombie', entityId: 40, at: 0, dist: 2 } };
    void w.director.decide('hurt');
}

for (const collects of [true, false]) {
    test(`give: paused by defend during the pickup wait, resumed, tosses only once (${collects ? 'received' : 'never received'})`, async () => {
        const { w } = jobWorld({ items: [{ name: 'coal', count: 7 }, { name: 'stone_sword', count: 1 }] });
        w.collects = collects;
        w.collectMs = 150;
        let paused = false;
        w.onToss = () => { pauseByDefend(w); };
        const job = await w.director.startJob({ kind: 'give', player: 'tester', item: 'coal', count: 3 }, 'player', {}, 'tester');
        assert.ok(await until(() => job!.status === 'paused'), 'defend paused the give');
        paused = true;
        const end = await w.director.ended(job!);
        assert.ok(paused);
        assert.deepEqual(end, collects ? { how: 'done' } : { how: 'failed', reason: 'Failed to give coal to tester, it was never received.' });
        assert.deepEqual(w.tossed, [{ name: 'coal', count: 3 }], 'one toss, the asked count');
        assert.equal(w.calls.filter(c => c.what === 'toss').length, 1);
        assert.deepEqual(w.items.find(i => i.name === 'coal'), { name: 'coal', count: 4 });
        assert.ok(w.logs.some(l => l.answer === 'resume'));
        await w.director.stop();
    });
}

test('store: paused by defend during a deposit, resumed, deposits the asked count once', async () => {
    const { w } = jobWorld({ items: [{ name: 'cobblestone', count: 20 }, { name: 'stone_sword', count: 1 }] });
    w.blocks['4,64,2'] = { name: 'chest' };
    w.depositMs = 100;
    w.onDeposit = () => { w.onDeposit = undefined; pauseByDefend(w); };
    const job = await w.director.startJob({ kind: 'store', item: 'cobblestone', count: 12 }, 'player', {});
    assert.ok(await until(() => job!.status === 'paused'), 'defend paused the store');
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.equal(w.said.at(-1), 'Successfully put 12 cobblestone in the chest.');
    assert.deepEqual(w.chests, { '4,64,2': { cobblestone: 12 } });
    assert.equal(w.calls.filter(c => c.what === 'deposit').length, 1, 'never deposited again');
    assert.deepEqual(w.items.find(i => i.name === 'cobblestone'), { name: 'cobblestone', count: 8 });
    await w.director.stop();
});

test('store: paused before the deposit, resumed, deposits the rest of the asked count', async () => {
    const { w } = jobWorld({ items: [{ name: 'cobblestone', count: 20 }, { name: 'stone_sword', count: 1 }] });
    w.blocks['4,64,2'] = { name: 'chest' };
    let first = true;
    w.onGoTo = () => { if (first) { first = false; pauseByDefend(w); } };
    const job = await w.director.startJob({ kind: 'store', item: 'cobblestone', count: 5 }, 'player', {});
    assert.deepEqual(await w.director.ended(job!), { how: 'done' });
    assert.deepEqual(w.chests, { '4,64,2': { cobblestone: 5 } });
    assert.equal(w.said.at(-1), 'Successfully put 5 cobblestone in the chest.');
    await w.director.stop();
});

test('dispose: a plan awaiting ended() is settled cancelled, not left hanging', async () => {
    const { w } = jobWorld();
    const job = await w.director.startJob({ kind: 'stay', seconds: -1 }, 'player', {});
    const end = w.director.ended(job!);
    await w.director.dispose();
    assert.deepEqual(await end, { how: 'cancelled' });
});
