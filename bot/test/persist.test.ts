// 4.3 persistence: laya-job.json (typed; the old test/laya_fix_round4 "job save" ported), the restore after a
// restart (paused, resumed by the director), the chores state (test/laya_chores_home "chores state file") and
// mine memory (test/laya_mine_loop "mine memory") in today's formats.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JobStack } from '../src/director/stack.js';
import {
    JobSaver, MAX_AGE_MS, jobWords, legacyJobWords, loadJobs, planRestore, readJobs, restoreMessage, saveJobs, waitsFor, type LoadedJobs,
} from '../src/home/jobfile.js';
import { loadChoresState, saveChoresState } from '../src/home/chores.js';
import { MAX_MINES, mineBook, mineStore, nearestMine, upsertMine, type MineRecord } from '../src/home/mines.js';
import { sleep } from '../src/core/abort.js';
import type { JobRunner } from '../src/director/jobs.js';
import type { JobFile, SavedJob } from '../src/types/index.js';
import { world, until, flush } from './fakeact.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const tmp = (name: string): string => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'andy-persist-')), 'bots', 'andy', name);
const read = (f: string): JobFile => JSON.parse(fs.readFileSync(f, 'utf8')) as JobFile;

test('job save: a player job is kept while on the stack and paused, gone when it ends, on clear and for chores', () => {
    const file = tmp('laya-job.json');
    let now = 1000;
    const st = new JobStack(() => now);
    new JobSaver(file, { now: () => now }).attach(st);
    const job = st.start({ kind: 'gather', item: 'coal', count: 4 }, 'player', { target: 35 }, 'tester');
    assert.deepEqual(read(file), { savedAt: 1000, entries: [
        { spec: { kind: 'gather', item: 'coal', count: 4 }, origin: 'player', by: 'tester', progress: { target: 35 }, status: 'running', startedAt: 1000 },
    ] }, 'the file shape: {savedAt, entries:[{spec, origin, by, progress, status, startedAt}]}');
    now = 2000;
    st.paused(job);
    assert.equal(read(file).entries[0]?.status, 'paused', 'kept while an activity has it paused');
    assert.equal(read(file).savedAt, 2000);
    st.ended(job, { how: 'done' });
    assert.ok(!fs.existsSync(file), 'gone when it ends');
    // a chore is not kept
    st.start({ kind: 'stay', seconds: 30 }, 'chore', {});
    assert.ok(!fs.existsSync(file));
    st.clear();
    // stop and death clear it
    st.start({ kind: 'mine', ore: 'iron', count: 3 }, 'player', { done: 1 });
    assert.ok(fs.existsSync(file));
    st.clear();
    assert.ok(!fs.existsSync(file));
    assert.deepEqual(fs.readdirSync(path.dirname(file)), [], 'no temp file left');
});

test('loadJobs: read once; fresh under 10 min; an old bot\'s file is legacy; malformed or unknown kinds are lost', () => {
    const file = tmp('laya-job.json');
    const spec = { kind: 'follow', player: 'tester', distance: 4 } as const;
    saveJobs(file, [{ spec, origin: 'player', by: 'tester', progress: {}, status: 'running', startedAt: 500 }], 1000);
    const l = loadJobs(file, 1000 + MAX_AGE_MS - 1);
    assert.equal(l?.kind, 'typed');
    assert.equal(l?.kind === 'typed' && l.fresh, true);
    assert.deepEqual(l?.kind === 'typed' && l.entries, [{ spec, origin: 'player', by: 'tester', progress: {}, status: 'running', startedAt: 500 }]);
    assert.equal(loadJobs(file), null, 'read once');
    saveJobs(file, [{ spec, origin: 'player', progress: {}, status: 'running', startedAt: 500 }], 1000);
    const old = loadJobs(file, 1000 + MAX_AGE_MS);
    assert.equal(old?.kind === 'typed' && old.fresh, false, '10 min old: lost');
    assert.equal(MAX_AGE_MS, 600_000);
    // the old bot's format
    fs.writeFileSync(file, JSON.stringify({ name: 'layaGather', args: ['coal', 4], saved: { target: 35 }, at: 1000 }));
    assert.deepEqual(loadJobs(file, 2000), { kind: 'legacy', entry: { name: 'layaGather', args: ['coal', 4], at: 1000 }, fresh: true });
    // malformed entries and unknown kinds
    fs.writeFileSync(file, JSON.stringify({ savedAt: 1000, entries: [
        { spec: { kind: 'teleport' }, origin: 'player', progress: {}, status: 'running', startedAt: 1 },
        { spec: { kind: 'mine', ore: 'cheese', count: 3 }, origin: 'player', progress: {}, status: 'running', startedAt: 1 },
        { spec, origin: 'player', progress: {}, status: 'sleeping', startedAt: 1 },
        { spec, origin: 'player', progress: {}, status: 'paused', startedAt: 1 },
    ] }));
    const m = loadJobs(file, 1000);
    assert.equal(m?.kind === 'typed' && m.lost, 3);
    assert.equal(m?.kind === 'typed' && m.entries.length, 1);
    fs.writeFileSync(file, '{not json');
    assert.equal(loadJobs(file), null);
    assert.ok(!fs.existsSync(file), 'an unreadable file is removed too');
});

test('the old bot reads our file as no job (the bots can swap on one world)', async () => {
    const file = tmp('laya-job.json');
    saveJobs(file, [{ spec: { kind: 'follow', player: 'tester', distance: 4 }, origin: 'player', progress: {}, status: 'running', startedAt: 1 }], 1000);
    const old = await import(pathToFileURL(path.join(REPO, 'src/agent/laya/job_save.js')).href) as { loadJob(p: string, now?: number): unknown };
    assert.equal(old.loadJob(file, 1000), null);
});

test('jobWords: the old words for the old jobs; the new kinds; the restore lines', () => {
    assert.equal(legacyJobWords({ name: 'layaGather', args: ['coal', 4] }), 'get 4 coal');
    assert.equal(legacyJobWords({ name: 'hunt', args: ['cow', 'beef', 3] }), 'hunt for 3 beef');
    assert.equal(legacyJobWords({ name: 'layaFarm', args: ['any', 'any'] }), 'farm any');
    assert.equal(jobWords({ kind: 'gather', item: 'coal', count: 4 }), 'get 4 coal');
    assert.equal(jobWords({ kind: 'hunt', mob: 'cow', item: 'beef', count: 3 }), 'hunt for 3 beef');
    assert.equal(jobWords({ kind: 'farm', crop: 'any', goal: 'forever' }), 'farm any');
    assert.equal(jobWords({ kind: 'mine', ore: 'iron', count: 5 }), 'mine 5 iron');
    assert.equal(jobWords({ kind: 'craft', item: 'stick', count: 4 }), 'make 4 stick');
    assert.equal(jobWords({ kind: 'follow', player: 'tester', distance: 4 }), 'follow tester');
    assert.equal(jobWords({ kind: 'come', player: 'tester', distance: 2 }), 'come to tester');
    assert.equal(jobWords({ kind: 'stay', seconds: -1 }), 'stay here');
    assert.equal(jobWords({ kind: 'give', player: 'tester', item: 'oak_log', count: 3 }), 'give tester 3 oak log');
    assert.equal(jobWords({ kind: 'give', player: 'tester', item: 'oak_log', count: -1 }), 'give tester oak log');
    assert.equal(jobWords({ kind: 'store', item: 'dirt', count: 0 }), 'put dirt in the chest');
    assert.equal(jobWords({ kind: 'home' }), 'set my home chest');
    assert.equal(restoreMessage('follow tester', true), "I was restarted while I was going to follow tester. I'll carry on with it.");
    assert.equal(restoreMessage('mine 5 iron', false), 'I was restarted and lost my job (mine 5 iron). Ask me again if you still want it.');
});

const saved = (x: Partial<SavedJob> = {}): SavedJob => ({ spec: { kind: 'follow', player: 'tester', distance: 4 }, origin: 'player', by: 'tester', progress: {}, status: 'running', startedAt: 1, ...x });
const typed = (entries: SavedJob[], fresh = true, lost = 0): LoadedJobs => ({ kind: 'typed', savedAt: 0, fresh, entries, lost });

test('planRestore: fresh and runnable comes back; stale, unrunnable and legacy are lost; a tossed give is dropped quietly', () => {
    const yes = () => true;
    assert.deepEqual(planRestore(null, yes), { restore: [], say: [], notes: [] });
    let p = planRestore(typed([saved()]), yes);
    assert.equal(p.restore.length, 1);
    assert.deepEqual(p.say, ["I was restarted while I was going to follow tester. I'll carry on with it."]);
    assert.deepEqual(p.notes, ['restart: job follow restored']);
    p = planRestore(typed([saved()], false), yes);
    assert.equal(p.restore.length, 0);
    assert.deepEqual(p.say, ['I was restarted and lost my job (follow tester). Ask me again if you still want it.']);
    assert.match(p.notes[0] ?? '', /^restart: job follow lost/);
    p = planRestore(typed([saved({ spec: { kind: 'mine', ore: 'iron', count: 5 } })]), () => false);
    assert.deepEqual(p.say, ['I was restarted and lost my job (mine 5 iron). Ask me again if you still want it.']);
    p = planRestore({ kind: 'legacy', entry: { name: 'layaGather', args: ['coal', 4], at: 0 }, fresh: true }, yes);
    assert.deepEqual(p.say, ['I was restarted and lost my job (get 4 coal). Ask me again if you still want it.']);
    // a give that tossed: never tossed again, nothing to ask again for
    p = planRestore(typed([saved({ spec: { kind: 'give', player: 'tester', item: 'dirt', count: 3 }, progress: { tossed: 3 } })]), yes);
    assert.deepEqual(p, { restore: [], say: [], notes: ['restart: job give dropped (already tossed)'] });
    // a give that hadn't tossed, and a store mid-deposit, come back
    p = planRestore(typed([saved({ spec: { kind: 'store', item: 'dirt', count: 10 }, progress: { deposited: 4, heldAtDeposit: 6 } })]), yes);
    assert.deepEqual(p.restore[0]?.progress, { deposited: 4, heldAtDeposit: 6 });
    p = planRestore(typed([], true, 1), yes);
    assert.equal(p.say.length, 1);
});

test('readJobs leaves the file (a restart waits for the world first); waitsFor: the players the jobs need in sight', () => {
    const file = tmp('laya-job.json');
    saveJobs(file, [saved(), saved({ spec: { kind: 'stay', seconds: 60 }, by: 'alex' }), saved({ spec: { kind: 'home' }, by: undefined } as Partial<SavedJob>)], 1000);
    const r = readJobs(file, 1000);
    assert.ok(fs.existsSync(file));
    assert.deepEqual(waitsFor(r), ['tester', 'alex']);
    assert.deepEqual(waitsFor(null), []);
    assert.deepEqual(waitsFor({ kind: 'legacy', entry: { name: 'x', args: [], at: 0 }, fresh: true }), []);
});

test('JobStack.restore: paused, new ids, spec/by/startedAt/progress kept, Last interrupted', () => {
    const st = new JobStack(() => 5000);
    let changes = 0;
    st.onChange = () => { changes++; };
    const [e] = st.restore([saved({ startedAt: 42, progress: { n: 2 } })]);
    assert.ok(e);
    assert.equal(e.status, 'paused');
    assert.equal(e.pausedAt, 5000);
    assert.equal(e.startedAt, 42, 'stay counts the time andy was down toward the stay');
    assert.deepEqual(e.progress, { n: 2 });
    assert.equal(e.by, 'tester');
    assert.equal(st.last, 'interrupted');
    assert.equal(st.pausedKind(), 'follow');
    assert.equal(changes, 1, 'the restored stack saves itself again at once');
});

test('restart round trip: a follow saved paused is restored and the director resumes it (resume-paused)', async () => {
    const file = tmp('laya-job.json');
    let steps = 0;
    const runners = (entry: { progress: unknown }): JobRunner => ({
        entry: entry as JobRunner['entry'],
        step: async (_f, signal) => { steps++; (entry.progress as { n: number }).n++; await sleep(20, signal); return { how: 'more' }; },
    });
    // the first life: follow runs, its progress is saved
    const a = world({ runners: runners as never });
    const saverA = new JobSaver(file, { throttleMs: 10 });
    saverA.attach(a.director.stack);
    const job = await a.director.startJob({ kind: 'follow', player: 'tester', distance: 4 }, 'player', { n: 0 }, 'tester');
    assert.ok(job);
    assert.ok(await until(() => steps >= 3));
    await flush(30);
    assert.ok((read(file).entries[0]?.progress as { n: number }).n >= 2, 'the progress is saved while it steps');
    // kill -9: nothing more happens to the file. A new process loads it.
    saverA.detach();
    await a.director.dispose();
    assert.ok(fs.existsSync(file), 'dispose leaves the file as it is');
    const n = (read(file).entries[0]?.progress as { n: number }).n;
    const b = world({ runners: runners as never });
    new JobSaver(file).attach(b.director.stack);
    const plan = planRestore(loadJobs(file), () => true);
    b.director.stack.restore(plan.restore);
    assert.equal(read(file).entries[0]?.status, 'paused', 'saved again at once');
    const d = await b.director.decide('spawn');
    assert.deepEqual([d?.answer, d?.rule], ['resume', 'resume-paused']);
    assert.equal(b.director.holder, 'action:followPlayer');
    const top = b.director.stack.job();
    assert.equal(top?.status, 'running');
    assert.equal(top?.by, 'tester');
    assert.ok((top?.progress as { n: number }).n >= n, 'goes on from the saved progress');
    await b.director.stop();
    assert.ok(!fs.existsSync(file), '!stop removes it');
});

test('dispose detaches the hooks: a torn-down director never rewrites or removes the file', async () => {
    const file = tmp('laya-job.json');
    const w = world();
    new JobSaver(file).attach(w.director.stack);
    w.director.stack.start({ kind: 'stay', seconds: 120 }, 'player', {});
    assert.ok(fs.existsSync(file));
    await w.director.dispose();
    assert.equal(w.director.stack.onChange, null);
    w.director.stack.clear();
    assert.ok(fs.existsSync(file));
});

test('the progress save is throttled (at most once per throttleMs) and the last progress is written', async () => {
    const file = tmp('laya-job.json');
    const st = new JobStack();
    const saver = new JobSaver(file, { throttleMs: 300 });
    saver.attach(st);
    const job = st.start({ kind: 'stay', seconds: -1 }, 'player', { n: 0 });
    {
        for (let i = 1; i <= 10; i++) { (job.progress as { n: number }).n = i; st.progressed(); await sleep(5); }
        assert.notEqual((read(file).entries[0]?.progress as { n: number }).n, 10, 'not every step is written');
        await sleep(330);
        assert.equal((read(file).entries[0]?.progress as { n: number }).n, 10, 'the trailing save writes the last progress');
        // flush writes a pending one at once
        (job.progress as { n: number }).n = 11; st.progressed();
        (job.progress as { n: number }).n = 12; st.progressed();
        saver.flush();
        assert.equal((read(file).entries[0]?.progress as { n: number }).n, 12);
    }
});

// ---- the chores state (laya_chores_home "chores state file") ----

test('chores state file: default from the setting, round trip, the harness\'s {"on":false}, today\'s format', () => {
    const p = tmp('laya-chores.json');
    assert.equal(loadChoresState(p, true).on, true, 'default from the setting');
    saveChoresState(p, { on: false, centreKind: 'player', chestItems: [{ name: 'torch', count: 3 }] });
    assert.equal(fs.readFileSync(p, 'utf8'), '{"on":false,"centreKind":"player","chestItems":[{"name":"torch","count":3}]}', 'JSON.stringify, no indent');
    assert.deepEqual(loadChoresState(p, true), { on: false, centreKind: 'player', chestItems: [{ name: 'torch', count: 3 }], chestAt: null, stumps: [] });
    fs.writeFileSync(p, JSON.stringify({ on: false }));
    assert.deepEqual(loadChoresState(p, true), { on: false, centreKind: null, chestItems: [], chestAt: null, stumps: [] });
    fs.writeFileSync(p, 'garbage');
    assert.equal(loadChoresState(p, false).on, false);
    assert.deepEqual(fs.readdirSync(path.dirname(p)), ['laya-chores.json'], 'no temp file left');
});

// ---- mine memory (laya_mine_loop "mine memory") ----

test('mine memory: nearestMine, upsertMine, a store that never throws', () => {
    const a: MineRecord = { entrance: { x: 0, y: 70, z: 0 }, heading: 'E' };
    const b: MineRecord = { entrance: { x: 100, y: 70, z: 0 }, heading: 'N', last: { x: 30, y: 20, z: 0 } };
    assert.equal(nearestMine([a, b], { x: 10, y: 70, z: 5 }), a);
    assert.equal(nearestMine([a, b], { x: 40, y: 70, z: 0 }), b, 'near where the bot last was in it');
    assert.equal(nearestMine([a, b], { x: 60, y: 70, z: 60 }), null);
    const list = upsertMine([a, b], { ...a, ores: ['iron'] });
    assert.equal(list.length, 2);
    assert.deepEqual(list[0]?.ores, ['iron']);
    const many = Array.from({ length: 40 }, (_, i) => ({ entrance: { x: i, y: 0, z: 0 }, heading: 'E' }));
    assert.equal(many.reduce<MineRecord[]>((l, m) => upsertMine(l, m), []).length, MAX_MINES);
    let got: MineRecord[] | null = null;
    const st = mineBook({ load: () => { throw new Error('no file'); }, save: l => { got = l; } });
    assert.equal(st.find({ x: 0, y: 0, z: 0 }), null);
    st.save(a);
    assert.deepEqual(got, [a]);
});

test('mine memory file: laya-mines.json as JSON.stringify(list, null, 1), atomic; forget drops a mine', () => {
    const file = tmp('laya-mines.json');
    const st = mineStore(file);
    assert.equal(st.find({ x: 0, y: 0, z: 0 }), null, 'no file is no mine');
    const a: MineRecord = { entrance: { x: 0, y: 60, z: 0 }, heading: 'E', surface: false, ores: ['coal'], deepest: 12, last: null, started: 1, updated: 2 };
    st.save(a);
    assert.equal(fs.readFileSync(file, 'utf8'), JSON.stringify([a], null, 1));
    assert.deepEqual(st.find({ x: 3, y: 60, z: 3 }), a);
    st.forget(a.entrance);
    assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), []);
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['laya-mines.json'], 'no temp file left');
});
