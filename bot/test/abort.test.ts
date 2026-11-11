import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sleep, race, withTimeout, timedOut, AbortedError, isAborted } from '../src/core/abort.js';

test('sleep rejects at once on abort', async () => {
    const c = new AbortController();
    const t0 = Date.now();
    const p = sleep(10000, c.signal);
    c.abort();
    await assert.rejects(p, AbortedError);
    assert.ok(Date.now() - t0 < 50);
    await assert.rejects(sleep(10, c.signal), AbortedError);   // already aborted
});

test('race rejects on abort and runs onAbort once', async () => {
    const c = new AbortController();
    let stops = 0;
    const p = race(new Promise(() => {}), c.signal, () => { stops++; });
    c.abort(); c.abort();
    await assert.rejects(p, e => isAborted(e));
    assert.equal(stops, 1);
    assert.equal(await race(Promise.resolve(3), new AbortController().signal), 3);
});

test('withTimeout aborts after ms with a timeout reason, or with the parent', async () => {
    const t = withTimeout(20);
    await new Promise(r => t.signal.addEventListener('abort', r));
    assert.ok(timedOut(t.signal));
    const parent = new AbortController();
    const u = withTimeout(10000, parent.signal);
    parent.abort();
    assert.ok(u.signal.aborted);
    assert.ok(!timedOut(u.signal));
    u.dispose(); t.dispose();
});
