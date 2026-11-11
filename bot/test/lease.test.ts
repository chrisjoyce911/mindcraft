import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BodyLease, type LeaseEvent } from '../src/core/lease.js';
import { sleep, AbortedError } from '../src/core/abort.js';

test('a cooperative runner settles within 250 ms of losing the lease', async () => {
    const lease = new BodyLease();
    const first = await lease.take('mine-step', signal => sleep(60000, signal));
    assert.equal(lease.holderName, 'mine-step');
    const t0 = Date.now();
    await lease.take('defend', signal => sleep(60000, signal));
    assert.ok(Date.now() - t0 < 250, `took ${Date.now() - t0} ms`);
    const r = await first.result;
    assert.equal(r.how, 'threw');
    assert.ok(r.how === 'threw' && r.error instanceof AbortedError);
    assert.equal(lease.holderName, 'defend');
    await lease.release();
    assert.ok(lease.isFree);
});

test('a never-settling actuator: the lease moves within 2 s, the body is reset, stop-overrun is logged', async () => {
    const events: LeaseEvent[] = [];
    let resets = 0;
    const lease = new BodyLease({ resetBody: () => { resets++; }, log: e => events.push(e) });
    const stuck = await lease.take('stuck-actuator', () => new Promise<never>(() => {}));   // ignores its signal forever
    const t0 = Date.now();
    await lease.release();                                     // a player says stop
    const ms = Date.now() - t0;
    assert.ok(ms <= 2100, `lease moved after ${ms} ms`);
    assert.ok(ms >= 1900, `waited only ${ms} ms before giving up`);
    assert.ok(lease.isFree);
    assert.equal(resets, 1);
    assert.equal(events.length, 1);
    assert.equal(events[0]!.event, 'stop-overrun');
    assert.equal(events[0]!.runner, 'stuck-actuator');
    assert.deepEqual(await stuck.result, { how: 'overrun' });
    // the process keeps running and the lease still works
    const next = await lease.take('follow', async () => 'ok');
    assert.deepEqual(await next.result, { how: 'settled', value: 'ok' });
});

test('a late result of an overrun runner is ignored (it does not free the new holder)', async () => {
    let finishLate!: () => void;
    const lease = new BodyLease({ overrunMs: 50 });
    await lease.take('slow', () => new Promise<void>(r => { finishLate = r; }));
    await lease.take('eat', signal => sleep(60000, signal));
    finishLate();
    await sleep(10);
    assert.equal(lease.holderName, 'eat');
    await lease.release();
});

test('a runner that ends by itself frees the body; takes are serialised', async () => {
    const lease = new BodyLease();
    const order: string[] = [];
    const a = lease.take('a', async () => { order.push('a'); return 1; });
    const b = lease.take('b', async () => { order.push('b'); return 2; });
    const [ha, hb] = await Promise.all([a, b]);
    assert.deepEqual(await ha.result, { how: 'settled', value: 1 });
    assert.deepEqual(await hb.result, { how: 'settled', value: 2 });
    assert.deepEqual(order, ['a', 'b']);
    await sleep(5);
    assert.ok(lease.isFree);
});

test('a runner that throws synchronously is reported, not thrown', async () => {
    const lease = new BodyLease();
    const h = await lease.take('bad', () => { throw new Error('boom'); });
    const r = await h.result;
    assert.equal(r.how, 'threw');
});
