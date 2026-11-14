// The hunt job (5.4): the old huntUntil tests (test/laya_command.test.js "huntUntil") on huntStep with a fake world,
// plus the target kept across a resume, an abort mid-kill, attack (item null), a wool hunt and a failed kill.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { huntStep, maxTries, type HuntProgress, type HuntWorld } from '../src/jobs/hunt.js';
import type { ActEntity } from '../src/actuators/bot.js';
import { fail, OK, type JobSpec, type Outcome, type StepResult } from '../src/types/index.js';

type HuntSpec = Extract<JobSpec, { kind: 'hunt' }>;

interface Fake extends HuntWorld { inv: Record<string, number>; mobs: number; kills: number; pickups: number; notes: string[] }

/** fake: mobs of the kind near; each kill adds drop to the pack (or what kill returns instead). */
function fake(o: { mobs?: number; inv?: Record<string, number>; drop?: Record<string, number>; kill?: (signal: AbortSignal) => Promise<Outcome> } = {}): Fake {
    const w: Fake = {
        inv: { ...(o.inv ?? {}) }, mobs: o.mobs ?? 99, kills: 0, pickups: 0, notes: [],
        have: item => w.inv[item] ?? 0,
        nearest: mob => (w.mobs > 0 ? { id: 100 + w.kills, name: mob, position: { x: 3, y: 64, z: 0 } } as ActEntity : null),
        kill: async (_e, signal) => {
            const r = o.kill ? await o.kill(signal) : OK;
            if (!r.ok) return r;
            w.mobs--; w.kills++;
            for (const [k, n] of Object.entries(o.drop ?? {})) w.inv[k] = (w.inv[k] ?? 0) + n;
            return OK;
        },
        pickup: async () => { w.pickups++; },
    };
    return w;
}

const spec = (mob: string, item: string | null, count: number): HuntSpec => ({ kind: 'hunt', mob, item, count });

/** run steps until the job ends (or limit steps). */
async function run(s: HuntSpec, w: Fake, p: HuntProgress = {}, signal = new AbortController().signal, limit = 100): Promise<{ r: StepResult; steps: number; p: HuntProgress }> {
    const ctx = { note: (t: string) => w.notes.push(t) };
    for (let i = 1; i <= limit; i++) {
        const r = await huntStep(s, p, w, signal, ctx);
        if (r.how === 'end') return { r, steps: i, p };
    }
    throw new Error('never ended');
}

test('huntUntil: attacks until the count, stops when none are near or after maxKills (the old test)', async () => {
    const w = fake({ mobs: 3, drop: { beef: 2 } });
    let { r, p } = await run(spec('cow', 'beef', 4), w);
    assert.deepEqual(r, { how: 'end', end: { how: 'done' }, say: 'Hunted 2 cow: I have 4 beef.' });
    assert.equal(p.kills, 2);
    // 10 more with one cow left: none near
    ({ r } = await run(spec('cow', 'beef', 10), w));
    assert.deepEqual(r, { how: 'end', end: { how: 'failed', reason: 'none near' }, say: "I couldn't hunt for 10 beef: none near." });
    // kills that never drop anything: max count*3+4 tries
    const dry = fake();
    ({ r, p } = await run(spec('cow', 'beef', 2), dry));
    assert.equal(p.kills, maxTries(2));
    assert.equal(maxTries(2), 10);
    assert.deepEqual(r, { how: 'end', end: { how: 'failed', reason: 'only 0 of 2 after 10 kills' }, say: "I couldn't hunt for 2 beef: only 0 of 2 after 10 kills." });
});

test('none near but the count was reached on the last pickup: done', async () => {
    const w = fake({ mobs: 0 });
    w.pickup = async () => { w.inv.beef = 3; };
    const { r } = await run(spec('cow', 'beef', 3), w);
    assert.equal(r.how === 'end' && r.end.how, 'done');
});

test('the target is fixed on the first step: a resumed hunt (a rebuilt runner, the saved progress) adds no more', async () => {
    const w = fake({ inv: { beef: 5 }, drop: { beef: 1 } });
    const p: HuntProgress = {};
    const ctx = { note: () => {}, checkpoint: () => { checkpoints++; } };
    let checkpoints = 0;
    await huntStep(spec('cow', 'beef', 3), p, w, new AbortController().signal, ctx);
    assert.equal(p.target, 8, 'have 5 + 3');
    assert.equal(checkpoints, 1, 'the target is on disk at once');
    assert.equal(w.inv.beef, 6);
    // restart: the saved progress comes back; andy carries 6 now, so a recomputed target would be 9
    const saved = JSON.parse(JSON.stringify(p)) as HuntProgress;
    const { r } = await run(spec('cow', 'beef', 3), w, saved);
    assert.equal(r.how === 'end' && r.end.how, 'done');
    assert.equal(w.inv.beef, 8, 'ends at the old target, not target + 3');
    assert.equal(w.kills, 3);
});

test('an abort mid-kill: more, no kill or try counted, no pickup', async () => {
    const c = new AbortController();
    const w = fake({ kill: async signal => { c.abort(); return signal.aborted ? fail('cancelled') : OK; } });
    const p: HuntProgress = {};
    const r = await huntStep(spec('cow', 'beef', 2), p, w, c.signal, { note: () => {} });
    assert.deepEqual(r, { how: 'more' });
    assert.equal(p.kills, undefined);
    assert.equal(p.tries, undefined);
    assert.equal(w.pickups, 0);
});

test('attack (item null): one kill and done; none near says the old line', async () => {
    const w = fake({ mobs: 3 });
    const { r, steps } = await run(spec('pig', null, 1), w);
    assert.deepEqual(r, { how: 'end', end: { how: 'done' }, say: 'Successfully killed pig.' });
    assert.equal(w.kills, 1);
    assert.equal(steps, 2);
    const none = await run(spec('zombie', null, 1), fake({ mobs: 0 }));
    assert.deepEqual(none.r, { how: 'end', end: { how: 'failed', reason: 'none near' }, say: 'Could not find any zombie to attack.' });
});

test('a wool hunt counts only white_wool', async () => {
    const w = fake({ drop: { black_wool: 1, white_wool: 1, mutton: 1 } });
    const { r, p } = await run(spec('sheep', 'white_wool', 2), w);
    assert.equal(r.how === 'end' && r.end.how, 'done');
    assert.equal(p.kills, 2);
    assert.equal(w.inv.black_wool, 2, 'the other wool is kept, it just doesn\'t count');
});

test('a kill that fails (timeout) is a try: noted, picked up after, and the tries stay bounded', async () => {
    const w = fake({ kill: async () => fail('timeout', 'kill') });
    const { r, p } = await run(spec('cow', 'beef', 1), w);
    assert.equal(p.tries, maxTries(1));
    assert.equal(p.kills, undefined);
    assert.equal(w.pickups, maxTries(1));
    assert.match(w.notes[0]!, /cow 100 not killed: timeout \(kill\)/);
    assert.deepEqual(r, { how: 'end', end: { how: 'failed', reason: 'only 0 of 1 after 0 kills' }, say: "I couldn't hunt for 1 beef: only 0 of 1 after 0 kills." });
    const att = await run(spec('pig', null, 1), fake({ kill: async () => fail('unreachable', 'pig ran off') }));
    assert.deepEqual(att.r, { how: 'end', end: { how: 'failed', reason: 'no kill after 7 tries' }, say: "I couldn't kill the pig." });
});
