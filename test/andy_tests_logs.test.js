import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { readLogs, parseLines, matches, brief } from '../tools/andy-tests/lib/logs.js';
import { Report } from '../tools/andy-tests/lib/report.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'andy-logs-'));
const line = o => JSON.stringify(o) + '\n';
fs.writeFileSync(path.join(dir, 'laya-farm.jsonl'),
    line({ time: '2026-11-10T00:00:00.000Z', state: 'Farm.\nX', action: 'wait', outcome: 'wait' }) +
    line({ time: '2026-11-10T00:01:00.000Z', state: 'Farm.\nY', action: 'harvest', outcome: 'ok' }) +
    '{"time":"2026-11-10T00:01:30.0' + '\n' + // a half-written line
    line({ time: '2026-11-10T00:02:00.000Z', state: 'Farm.\nZ', action: 'pond', outcome: 'ok' }));
fs.writeFileSync(path.join(dir, 'laya-mine.jsonl'), line({ time: '2026-11-10T00:01:30.000Z', state: 'Mine.', action: 'collect', outcome: 'failed' }));

test('parseLines skips broken lines and tags the task', () => {
    const e = parseLines('{"a":1}\nnot json\n\n{"b":2}\n', 'eat');
    assert.deepEqual(e, [{ task: 'eat', a: 1 }, { task: 'eat', b: 2 }]);
});

test('readLogs merges tasks in time order and filters', () => {
    assert.deepEqual(readLogs(dir).map(e => e.action), ['wait', 'harvest', 'collect', 'pond']);
    assert.deepEqual(readLogs(dir, { task: 'farm', limit: 2 }).map(e => e.action), ['harvest', 'pond']);
    assert.deepEqual(readLogs(dir, { since: '2026-11-10T00:01:00Z', until: '2026-11-10T00:01:45Z' }).map(e => e.action), ['harvest', 'collect']);
    assert.deepEqual(readLogs(dir, { match: { outcome: 'ok' } }).map(e => e.action), ['harvest', 'pond']);
    assert.deepEqual(readLogs(dir, { match: { action: '/harv|pond/' } }).map(e => e.action), ['harvest', 'pond']);
    assert.deepEqual(readLogs(dir, { match: '"pond"' }).map(e => e.action), ['pond']);
    assert.deepEqual(readLogs(path.join(dir, 'missing')), []);
});

test('matches and brief', () => {
    assert.ok(matches({ a: { b: 5 } }, { 'a.b': 5 }));
    assert.ok(!matches({ a: 1 }, { a: 2 }));
    assert.deepEqual(brief({ state: 'long state', x: 1 }), { x: 1 });
    assert.deepEqual(brief({ state: 'long state', x: 1 }, 4), { x: 1, state: 'long' });
});

test('report files are named in Brisbane time and appended', () => {
    const rdir = path.join(dir, 'game-tests');
    const now = () => Date.parse('2026-11-10T04:05:06Z');
    const r = new Report(rdir, { title: 'T', now });
    assert.equal(path.basename(r.mdPath), '2026-11-10_14-05-06.md');
    r.event({ type: 'x' });
    r.md('hello');
    assert.match(fs.readFileSync(r.mdPath, 'utf8'), /# T\n\nStarted 2026-11-10 14:05:06 AEST[\s\S]*hello/);
    assert.deepEqual(JSON.parse(fs.readFileSync(r.jsonlPath, 'utf8')), { time: '2026-11-10T14:05:06+10:00', type: 'x' });
    const r2 = new Report(rdir, { now });
    assert.equal(path.basename(r2.mdPath), '2026-11-10_14-05-06-2.md');
});
