import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Motion, type MotionBot } from '../src/core/motion.js';

// a pathfinder like mineflayer-pathfinder: goto() only ends when the goal is reached or changed
function fakeBot() {
    const calls = { setGoalNull: 0, stopDigging: 0, clear: 0 };
    let reject: ((e: Error) => void) | null = null;
    const bot: MotionBot = {
        pathfinder: {
            goto: () => new Promise((_res, rej) => { reject = rej; }),
            setGoal: (g: unknown) => {
                if (g === null) { calls.setGoalNull++; const r = reject; reject = null; r?.(Object.assign(new Error('The goal was changed before it could be completed!'), { name: 'GoalChanged' })); }
            },
        },
        stopDigging: () => { calls.stopDigging++; },
        clearControlStates: () => { calls.clear++; },
    };
    return { bot, calls };
}

test('abort while pathing: goal cleared once, goTo resolves cancelled within 250 ms', async () => {
    const { bot, calls } = fakeBot();
    const m = new Motion(bot);
    const c = new AbortController();
    const p = m.goTo({}, c.signal);
    await new Promise(r => setTimeout(r, 20));
    const t0 = Date.now();
    c.abort();
    const o = await p;
    assert.ok(Date.now() - t0 < 250);
    assert.deepEqual(o, { ok: false, reason: 'cancelled' });
    assert.equal(calls.setGoalNull, 1);
    assert.equal(calls.stopDigging, 1);
    assert.equal(calls.clear, 1);
});

test('goTo times out with reason timeout', async () => {
    const { bot } = fakeBot();
    const o = await new Motion(bot).goTo({}, new AbortController().signal, { timeoutMs: 30 });
    assert.deepEqual(o, { ok: false, reason: 'timeout' });
});

test('goTo reports success and no-path', async () => {
    const ok: MotionBot = { pathfinder: { goto: async () => {}, setGoal: () => {} }, stopDigging() {}, clearControlStates() {} };
    assert.deepEqual(await new Motion(ok).goTo({}, new AbortController().signal), { ok: true });
    const np: MotionBot = { pathfinder: { goto: async () => { throw Object.assign(new Error('No path to the goal!'), { name: 'NoPath' }); }, setGoal: () => {} }, stopDigging() {}, clearControlStates() {} };
    const o = await new Motion(np).goTo({}, new AbortController().signal);
    assert.equal(o.ok, false);
    assert.equal(!o.ok && o.reason, 'no-path');
});
