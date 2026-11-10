// The strict-benchmark parts of the game test harness: fail-fast waits, the
// `via` path of a chat-driven test, block checks, the JSON summary and the
// compare tool.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { FakeWorld, fakeSession } from './helpers/andy_fakes.js';
import { runTest, runSuite, viaOf, summaryRows } from '../tools/andy-tests/lib/runner.js';
import { parseScenarios } from '../tools/andy-tests/lib/scenarios.js';
import { evaluate, blockKey, describeCheck } from '../tools/andy-tests/lib/checks.js';
import { Report } from '../tools/andy-tests/lib/report.js';
import { compare, table, loadSummary } from '../tools/andy-tests/compare.js';

const defaults = { timeout: 120000, grace: 5000, settle: 3000 };
const one = t => parseScenarios(JSON.stringify({ tests: [t] })).tests[0];

test('a waitFor fails fast once andy is idle after his job, with the reason', async () => {
    const { world, session } = fakeSession();
    world.give('cobblestone', 1984);
    world.onMessage = m => {
        if (m.startsWith('!layaMine')) { world.after(500, w => w.busy('action:layaMine')); world.after(20000, w => w.idle()); }
    };
    const t = one({ name: 'unload', timeout: 900000, action: [{ andy: '!layaMine("coal", 2)' }, { waitFor: { item: 'cobblestone', max: 200 }, timeout: 600000 }], checks: [] });
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'fail');
    assert.match(r.reason, /andy's action ended and \{"item":"cobblestone","max":200\} was still not true 30s later/);
    assert.ok(r.ms < 70000, `took ${r.ms} ms`); // 20 s job + 30 s idle, not 600 s
});

test('fail fast leaves waits alone while andy never gets busy, and idleFail: false turns it off', async () => {
    const { world, session } = fakeSession();
    world.after(45000, w => { w.andy.gameplay.hunger = 14; });
    const t = one({ name: 'eat', timeout: 120000, action: [{ waitFor: { stat: 'hunger', max: 16 }, timeout: 60000 }], checks: [] });
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'pass', r.reason);

    const s2 = fakeSession();
    s2.world.onMessage = () => { s2.world.after(100, w => w.busy('action:x')); s2.world.after(2000, w => w.idle()); };
    const t2 = one({ name: 'slow', timeout: 120000, action: [{ andy: '!x' }, { waitFor: { item: 'coal', min: 1 }, timeout: 50000, idleFail: false }], checks: [] });
    const r2 = await runTest(s2.session, t2, { defaults });
    assert.match(r2.reason, /^timed out waiting for/);
    assert.ok(r2.ms >= 50000);
});

test('waitReply and waitLog fail fast too', async () => {
    const { world, session } = fakeSession();
    world.onMessage = () => { world.after(100, w => w.busy('action:layaFarm')); world.after(5000, w => w.idle()); };
    const t = one({ name: 'sign', timeout: 120000, action: [{ andy: '!layaFarm("wheat", 1)' }, { waitReply: 'Found my name', timeout: 60000, idleFail: 10000 }], checks: [] });
    const r = await runTest(session, t, { defaults });
    assert.match(r.reason, /he still hadn't said \/Found my name\/ 10s later/);
});

function logDir(entries) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-logs-'));
    fs.writeFileSync(path.join(dir, 'laya-command.jsonl'), entries.map(e => JSON.stringify(e)).join('\n') + '\n');
    return dir;
}

test('via: the command model, the LLM fallback, or a direct !command', () => {
    const say = one({ name: 'a', action: [{ say: 'andy follow me' }], checks: [] });
    const direct = one({ name: 'b', action: [{ andy: '!layaFarm("wheat", 1)' }], checks: [] });
    const t0 = Date.parse('2026-11-10T03:00:00Z');
    const at = s => new Date(t0 + s * 1000).toISOString();
    const run = { task: 'command', time: at(1), kind: 'run', lines: ['!followPlayer("tester", 3)'], command: 'follow' };
    const llm = { task: 'command', time: at(1), kind: 'llm', command: 'chat' };
    assert.deepEqual(viaOf(say, [run], t0), { via: 'model', command: '!followPlayer("tester", 3)' });
    assert.deepEqual(viaOf(say, [llm], t0), { via: 'llm', command: 'chat → LLM' });
    assert.deepEqual(viaOf(say, [{ ...run, time: at(-5) }], t0), { via: 'none' }); // before the action: not this test's
    assert.deepEqual(viaOf(say, [], t0), { via: 'none' });
    assert.deepEqual(viaOf(direct, [llm], t0), { via: 'direct' });
});

test('runTest records via from laya-command.jsonl, and the summary row has it', async () => {
    const world = new FakeWorld();
    const dir = logDir([{ time: new Date(world.t + 2000).toISOString(), kind: 'llm', command: 'chat', addressed: 1 }]);
    const { session, report } = fakeSession(world, { logDir: dir });
    world.onMessage = text => { if (/farm/.test(text)) world.after(300, w => w.say('Harvested 5 wheat.')); };
    const t = one({ name: 'farm-water', action: [{ say: 'andy farm wheat 5' }], checks: [{ type: 'reply', match: 'Harvested ([5-9]|\\d{2,}) wheat' }] });
    const r = await runTest(session, t, { defaults, report });
    assert.equal(r.status, 'pass', r.reason);
    assert.equal(r.via, 'llm');
    assert.match(report.text, /- Via: llm \(chat → LLM\)/);
    assert.deepEqual(summaryRows([r]), [{ test: 'farm-water', result: 'pass', seconds: +(r.ms / 1000).toFixed(1), via: 'llm', command: 'chat → LLM', reason: r.reason }]);
});

test('block check: counted near andy before cleanup; a failed count is a fail', async () => {
    const { world, session } = fakeSession();
    world.onMessage = m => { if (m.startsWith('!layaFarm')) world.after(1000, w => { w.blocks.water = 1; }); };
    const t = one({
        name: 'bucket', grace: 2000,
        action: [{ andy: '!layaFarm("wheat", 1)' }, { wait: 3000 }],
        checks: [{ type: 'block', block: 'water', near: 'andy', radius: 6, min: 1 }],
        cleanup: [{ cmd: '/fill {x-4} 299 {z-4} {x+4} 304 {z+4} air' }],
    });
    world.onCommand = cmd => { if (cmd.startsWith('/fill')) world.blocks.water = 0; return []; };
    const r = await runTest(session, t, { defaults });
    assert.equal(r.status, 'pass', r.reason);
    assert.equal(r.blocks['water@andy@6'].count, 1);
    assert.deepEqual(world.blockQueries[0].center, { x: 10, y: 64, z: -5 });

    const ctx = { blocks: { [blockKey({ block: 'water', radius: 6 })]: { count: 0, center: { x: 1, y: 2, z: 3 } } } };
    assert.deepEqual(evaluate({ type: 'block', block: 'water', radius: 6 }, ctx), { type: 'block', ok: false, reason: 'water blocks within 6 of 1 2 3: 0, wanted ≥ 1' });
    assert.equal(evaluate({ type: 'block', block: 'lava' }, ctx).ok, false);
    assert.equal(evaluate({ type: 'block', block: 'water' }, { blocks: { 'water@andy@6': { error: 'tester is not in the world' } } }).reason, 'blocks water near andy could not be read: tester is not in the world');
    assert.match(describeCheck({ type: 'block', block: 'water', radius: 6, min: 1 }), /water blocks within 6 of andy at the end: ≥ 1/);
});

test('serverReply none', () => {
    const ctx = { serverReplies: ['Test failed'] };
    assert.equal(evaluate({ type: 'serverReply', match: 'Test passed', none: true }, ctx).ok, true);
    assert.equal(evaluate({ type: 'serverReply', match: 'Test failed', none: true }, ctx).ok, false);
});

test('runSuite writes the JSON summary; Report names files <name>-<stamp>', async () => {
    const { session, report } = fakeSession();
    const tests = parseScenarios(JSON.stringify({ tests: [
        { name: 'a', action: [{ andy: '!inventory' }], checks: [] },
        { name: 'b', action: [{ andy: '!inventory' }], checks: [{ type: 'reply', match: 'never' }] },
    ] })).tests;
    const out = await runSuite(session, tests, { defaults, report });
    assert.deepEqual(report.summary.tests.map(t => [t.test, t.result, t.via]), [['a', 'pass', 'direct'], ['b', 'fail', 'direct']]);
    assert.equal(report.summary.summary.pass, 1);
    assert.equal(out.results[1].via, 'direct');
    assert.match(report.text, /\| Test \| Result \| Seconds \| Via \| Why \|/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-report-'));
    const rep = new Report(dir, { name: 'baseline-v1', now: () => Date.parse('2026-11-10T04:05:06Z') });
    rep.json({ tests: [] });
    assert.equal(path.basename(rep.paths().json), 'baseline-v1-2026-11-10_14-05-06.json');
    assert.ok(fs.existsSync(rep.paths().json));
    assert.throws(() => new Report(dir, { name: '../x' }), /report name/);
});

test('compare: better, worse, same, new, gone, via changes', () => {
    const a = { tests: [
        { test: 'follow', result: 'pass', seconds: 13, via: 'model' },
        { test: 'craft', result: 'fail', seconds: 10, via: 'model' },
        { test: 'farm', result: 'pass', seconds: 20, via: 'llm' },
        { test: 'eat', result: 'skip', seconds: 0, via: 'skip' },
        { test: 'old', result: 'pass', seconds: 1, via: 'direct' },
    ] };
    const b = { tests: [
        { test: 'follow', result: 'fail', seconds: 30, via: 'model' },
        { test: 'craft', result: 'pass', seconds: 9, via: 'model' },
        { test: 'farm', result: 'pass', seconds: 15, via: 'model' },
        { test: 'eat', result: 'pass', seconds: 12, via: 'direct' },
        { test: 'new', result: 'pass', seconds: 2, via: 'direct' },
    ] };
    const c = compare(a, b);
    assert.deepEqual(c.rows.map(r => [r.test, r.change]), [['follow', 'worse'], ['craft', 'better'], ['farm', 'same'], ['eat', 'skip'], ['old', 'gone'], ['new', 'new']]);
    assert.equal(c.rows.find(r => r.test === 'farm').viaChanged, true);
    assert.deepEqual({ ...c.totals }, { better: 1, worse: 1, same: 1, other: 3, passA: 3, passB: 4, nA: 5, nB: 5 });
    const out = table(c, { nameA: 'v1', nameB: 'v2' });
    assert.match(out, /^Test\s+v1\s+v2\s+Change/);
    assert.match(out, /farm\s+PASS 20\.0s llm\s+PASS 15\.0s model\s+same \(via changed\)/);
    assert.match(out, /v1: 3\/5 pass {3}v2: 4\/5 pass {3}better 1, worse 1, same 1, other 3/);

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-cmp-'));
    fs.writeFileSync(path.join(dir, 'a.json'), JSON.stringify({ summary: {}, tests: a.tests }));
    fs.writeFileSync(path.join(dir, 'bad.json'), '{"x": 1}');
    assert.equal(loadSummary(path.join(dir, 'a.json')).tests.length, 5);
    assert.throws(() => loadSummary(path.join(dir, 'bad.json')), /no "tests" list/);
});

test('reset step: test world only; andy must come back; tester back in creative', async () => {
    const t = one({ name: 'r', setup: [{ reset: true }], action: [{ andy: '!inventory' }], checks: [] });
    const a = fakeSession();
    const r1 = await runTest(a.session, t, { defaults });
    assert.equal(r1.status, 'pass', r1.reason);
    assert.match(r1.steps[0].out[0], /skipped: not the test world/);

    const b = fakeSession();
    b.session.config.world = 'test';
    b.session.testWorld = () => Promise.resolve({ sites: { sites: {} } });
    let resets = 0;
    b.session.worldReset = () => { resets++; return Promise.resolve({ ms: 9000, andy: { inGame: true }, andyMs: 3000 }); };
    const r2 = await runTest(b.session, t, { defaults });
    assert.equal(r2.status, 'pass', r2.reason);
    assert.equal(resets, 1);
    assert.ok(b.world.commands.includes('/gamemode creative tester'));
    assert.match(r2.steps[0].out[0], /reset in 9\.0s, andy back in 3\.0s/);

    b.session.worldReset = () => Promise.resolve({ ms: 9000, andy: { inGame: false, error: 'timed out' } });
    const r3 = await runTest(b.session, t, { defaults });
    assert.equal(r3.status, 'fail');
    assert.match(r3.reason, /andy wasn't back in game after the reset: timed out/);
});

test('after a reset, a job andy starts by himself is stopped before the test goes on', async () => {
    const b = fakeSession();
    b.session.config.world = 'test';
    b.session.testWorld = () => Promise.resolve({ sites: { sites: {} } });
    b.session.worldReset = () => {
        b.world.after(2000, w => w.busy('action:layaFarm')); // his LLM answering "Agent process restarted."
        return Promise.resolve({ ms: 9000, andy: { inGame: true }, andyMs: 3000 });
    };
    b.world.onMessage = m => { if (m === '!stop') b.world.after(300, w => w.idle()); };
    const t = one({ name: 'r', setup: [{ reset: true }], action: [{ andy: '!inventory' }], checks: [] });
    const r = await runTest(b.session, t, { defaults });
    assert.equal(r.status, 'pass', r.reason);
    assert.deepEqual(b.world.sent.map(x => x.message), ['!stop', '!inventory']);
    assert.match(r.steps[0].out.join(' / '), /andy started action:layaFarm by himself after the restart: stopped/);
});
