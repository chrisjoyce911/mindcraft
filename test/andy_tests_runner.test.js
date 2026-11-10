import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeWorld, fakeSession } from './helpers/andy_fakes.js';
import { runTest, runSuite, disabledTasks } from '../tools/andy-tests/lib/runner.js';
import { parseScenarios } from '../tools/andy-tests/lib/scenarios.js';

const defaults = { timeout: 120000, grace: 5000, settle: 3000 };
const one = t => parseScenarios(JSON.stringify({ tests: [t] })).tests[0];

const craftTest = one({
    name: 'craft-wooden-pickaxe', tags: ['quick'], timeout: 60000,
    setup: [{ tp: { dx: 2 } }, { cmd: '/clear {andy}' }, { cmd: '/give {andy} oak_log 3' }],
    action: [{ say: 'andy make a wooden pickaxe' }],
    checks: [{ type: 'inventory', item: 'wooden_pickaxe', min: 1 }, { type: 'idle' }],
});

// andy who crafts a pickaxe 10 s after being asked
function crafter(world, { works = true } = {}) {
    world.onCommand = cmd => {
        const m = cmd.match(/^\/give andy (\w+) (\d+)/);
        if (m) { world.give(m[1], +m[2]); return [`Gave ${m[2]} [${m[1]}] to andy`]; }
        if (cmd === '/clear andy') { world.andy.inventory.counts = {}; return ['Removed items from andy']; }
        return [];
    };
    world.onMessage = text => {
        if (!/pickaxe/.test(text)) return;
        world.after(500, w => w.busy('action:layaCraft'));
        world.after(10000, w => {
            if (works) { w.give('oak_log', -3); w.give('wooden_pickaxe', 1); w.say('I made a wooden pickaxe.'); }
            else w.say("I couldn't make it.");
            w.idle();
        });
    };
}

test('a passing test: setup relative to andy, chat action, inventory delta, report', async () => {
    const { world, session, report } = fakeSession();
    crafter(world);
    const r = await runTest(session, craftTest, { defaults, report });
    assert.equal(r.status, 'pass', r.reason);
    assert.deepEqual(r.anchor, { x: 10, y: 64, z: -5 });
    assert.deepEqual(world.said, ['andy make a wooden pickaxe']);
    assert.ok(world.commands.includes('/give andy oak_log 3'));
    assert.deepEqual(world.tester, { x: 12.5, y: 64, z: -4.5 }); // 2 east of andy
    assert.deepEqual(r.inventoryChange, { oak_log: -3, wooden_pickaxe: 1 });
    assert.deepEqual(r.replies, ['I made a wooden pickaxe.']);
    assert.ok(r.waited.wasBusy && r.waited.idle);
    assert.match(report.text, /## PASS craft-wooden-pickaxe/);
    assert.match(report.text, /Inventory after: .*wooden_pickaxe 1/);
    assert.equal(report.events.at(-1).type, 'test');
});

test('a failing test says why', async () => {
    const { world, session } = fakeSession();
    crafter(world, { works: false });
    const r = await runTest(session, craftTest, { defaults });
    assert.equal(r.status, 'fail');
    assert.match(r.reason, /inventory: wooden_pickaxe \+0, wanted ≥ \+1/);
    assert.deepEqual(r.replies, ["I couldn't make it."]);
});

test('timeout: andy still busy fails the idle check', async () => {
    const { world, session } = fakeSession();
    world.onMessage = () => world.after(100, w => w.busy('action:layaMine'));
    const t = one({ name: 'slow', timeout: 20000, action: [{ andy: '!layaMine("coal", 5)' }], checks: [{ type: 'idle' }] });
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'fail');
    assert.match(r.reason, /still busy at the timeout \(action:layaMine\)/);
    assert.ok(r.ms >= 20000 && r.ms < 30000);
    assert.deepEqual(world.sent[0], { message: '!layaMine("coal", 5)', from: 'tester' });
});

test('waiting for idle rides over a short idle while a job resumes', async () => {
    const { world, session } = fakeSession();
    world.busy('action:layaFarm');
    world.after(4000, w => w.idle());                     // a fight interrupts…
    world.after(5000, w => w.busy('action:layaFarm'));    // …and the job resumes
    world.after(15000, w => w.idle());
    const w = await session.waitIdle({ timeout: 60000, grace: 1000, settle: 3000 });
    assert.equal(w.idle, true);
    assert.ok(w.ms >= 18000, `ended at ${w.ms}`);
    assert.deepEqual(w.actions, ['action:layaFarm', 'Idle', 'action:layaFarm', 'Idle']);
});

test('a test whose Laya task is disabled is skipped', async () => {
    const { world, session } = fakeSession();
    const t = one({ name: 'farm', requires: ['farm', 'mine'], action: [{ say: 'andy farm' }], checks: [] });
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'skip');
    assert.match(r.reason, /farm disabled/);
    assert.equal(world.said.length, 0);
    assert.deepEqual(disabledTasks(['farm'], {}), []); // unknown settings: run it
    assert.deepEqual(disabledTasks(['eat'], { decision_models: { tasks: {} } }), ['eat']);
});

test('busy andy gets !stop before the test', async () => {
    const { world, session } = fakeSession();
    world.busy('action:followPlayer');
    world.onMessage = m => { if (m === '!stop') world.after(200, w => w.idle()); };
    const t = one({ name: 'x', action: [{ andy: '!inventory' }], checks: [] });
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'pass', r.reason);
    assert.deepEqual(world.sent.map(s => s.message), ['!stop', '!inventory']);
});

test('steps: waitReply, waitFor, snapshot, repeat, chest delta, cleanup after failure', async () => {
    const { world, session } = fakeSession();
    world.chests['13 64 -5'] = { cobblestone: 0 };
    world.onMessage = m => {
        if (m === '!setHomeChest') world.after(300, w => w.say('Home chest set at 13 64 -5.'));
        if (m.startsWith('!layaMine')) {
            world.after(500, w => w.busy('action:layaMine'));
            world.after(8000, w => { w.give('cobblestone', -1952); w.chests['13 64 -5'] = { cobblestone: 1952 }; });
        }
        if (m === '!stop') world.after(100, w => w.idle());
    };
    world.onCommand = cmd => { const m = cmd.match(/^\/give andy (\w+) (\d+)/); if (m) world.give(m[1], +m[2]); return []; };
    const t = one({
        name: 'unload', timeout: 120000, grace: 1000,
        setup: [{ andy: '!setHomeChest' }, { waitReply: 'Home chest set', timeout: 5000 }, { cmd: '/give {andy} cobblestone 64', repeat: 31 }],
        action: [{ andy: '!layaMine("coal", 2)' }, { waitFor: { item: 'cobblestone', max: 200 }, timeout: 60000 }, { snapshot: 'unloaded' }, { andy: '!stop' }],
        checks: [{ type: 'chest', at: '{x+3} {y} {z}', item: 'cobblestone', min: 640, delta: true }, { type: 'inventory', item: 'cobblestone', max: -640, since: 'before' }],
        cleanup: [{ cmd: '/tp {andy} {x} {y} {z}' }],
    });
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'pass', r.reason);
    assert.equal(world.commands.filter(c => c === '/give andy cobblestone 64').length, 31);
    assert.equal(r.before.inventory.cobblestone, 1984);
    assert.ok(session.snapshots.unloaded);
    assert.ok(world.commands.includes('/tp andy 10 64 -5'));

    // a waitReply that never comes fails the test and still cleans up
    world.commands.length = 0;
    const t2 = one({ name: 'never', timeout: 30000, action: [{ waitReply: 'Found my name', timeout: 3000 }], checks: [], cleanup: [{ cmd: '/setblock {x} {y} {z} air' }] });
    const r2 = await runTest(session, t2, { defaults });
    assert.equal(r2.status, 'fail');
    assert.match(r2.reason, /andy never said \/Found my name\//);
    assert.ok(world.commands.includes('/setblock 10 64 -5 air'));
});

test('runSuite summarises and stops when the mindserver is gone', async () => {
    const { world, session, report } = fakeSession();
    const tests = parseScenarios(JSON.stringify({ tests: [
        { name: 'a', action: [{ andy: '!inventory' }], checks: [] },
        { name: 'b', action: [{ andy: '!inventory' }], checks: [{ type: 'reply', match: 'never' }] },
        { name: 'c', action: [{ andy: '!inventory' }], checks: [] },
        { name: 'd', action: [{ andy: '!inventory' }], checks: [] },
    ] })).tests;
    let n = 0;
    world.onMessage = () => { if (++n === 2) session.mind.send = () => { throw new Error('Mindserver not reachable at http://localhost:8090'); }; };
    const seen = [];
    const out = await runSuite(session, tests, { defaults, report, onResult: r => seen.push(r.status) });
    assert.deepEqual(seen, ['pass', 'fail', 'error', 'error']);
    assert.match(out.results[3].reason, /not run: .*not reachable/);
    assert.deepEqual({ ...out.summary, ms: 0 }, { pass: 1, fail: 1, error: 2, skip: 0, ms: 0 });
    assert.match(report.text, /## Summary\n\n1 passed, 1 failed, 2 errors, 0 skipped/);
    assert.deepEqual(report.events.map(e => e.type), ['suite-start', 'test', 'test', 'test', 'suite-end']);
});

test('session: chat from both sources is kept once; diff; status; connection errors', async () => {
    const { world, session, mind, tester } = fakeSession(new FakeWorld());
    await session.connect();
    mind.emit('output', 'hello', world.t);
    tester.emit('andy', 'hello', world.t + 100);
    tester.emit('andy', 'only in game', world.t + 200);
    assert.deepEqual(session.chat.map(c => c.text), ['hello', 'only in game']);
    await session.snapshot('a');
    world.give('coal', 3);
    world.andy.gameplay.position.y = 50;
    const d = await session.diff('a');
    assert.deepEqual(d.inventory, { coal: 3 });
    assert.equal(d.position.dy, -14);
    await assert.rejects(session.diff('zz'), /No snapshot "zz"/);
    const s = await session.status();
    assert.equal(s.testerDistance, 14.1);
    assert.equal(s.action.current, 'Idle');

    const bad = fakeSession();
    bad.mind.fail = 'Mindserver not reachable at http://localhost:8090 (refused). Start Mindcraft';
    await assert.rejects(bad.session.status(), /Start Mindcraft/);
});
