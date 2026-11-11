// The correction path (5.7): a laya-<task>.jsonl line → a correction case for laya-go and the /job body.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    CorrectionError, correctionCase, parseRight, pickLine, runCli, type Answers, type CorrectionTask,
} from '../src/log/correction.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const FIX = path.join(REPO, 'test/fixtures/laya-logs');
const lines = (rel: string): string[] => fs.readFileSync(path.join(FIX, rel), 'utf8').split('\n').filter(Boolean);
const first = (task: string): string => lines(`laya-${task}.jsonl`)[0]!;
const stateOf = (l: string): string => (JSON.parse(l) as { state: string }).state;

const cases: { task: CorrectionTask; answered: Answers; by: string; right: Answers }[] = [
    { task: 'director', answered: { Activity: 'idle' }, by: 'model', right: { Activity: 'chores' } },
    { task: 'eat', answered: { Eat: 0, Food: 'none' }, by: 'model', right: { Eat: 'true', Food: 'cooked_beef' } },
    { task: 'defend', answered: { Action: 'fight', Target: 'husk 1', Weapon: 'iron_sword', Danger: 1 }, by: 'model', right: { Action: 'flee' } },
    { task: 'command', answered: { Addressed: 1, Command: 'mine', Item: 'coal', Tier: 'none', Count: '5' }, by: 'model', right: { Count: '8' } },
    { task: 'follow', answered: { Move: 'wait', Hazard: 0 }, by: 'model', right: { Move: 'E' } },
    { task: 'craft', answered: { Action: 'craft', Item: 'planks', Count: '1' }, by: 'model', right: { Action: 'craft', Item: 'crafting_table' } },
    { task: 'mine', answered: { Action: 'collect', Hazard: 0, Unload: 0 }, by: 'model', right: { Action: 'tunnel S' } },
    { task: 'farm', answered: { Action: 'till', Target: 'W1 S1', Item: 'hoe', Unload: 0 }, by: 'model', right: { Target: 'W1 S0' } },
    { task: 'chores', answered: { Chore: 'craft_wood_tools' }, by: 'rules', right: { Chore: 'night_mine' } },
];

for (const c of cases) {
    test(`correction: laya-${c.task}.jsonl → case with the exact state, the answers and the /job body`, () => {
        const line = first(c.task);
        const got = correctionCase(c.task, line, c.right, { source: `x/laya-${c.task}.jsonl:1` });
        const raw = JSON.parse(line) as { time: string; p?: number };
        assert.equal(got.kind, 'laya-correction');
        assert.equal(got.version, 1);
        assert.equal(got.task, c.task);
        assert.equal(got.model, c.task);
        assert.equal(got.time, raw.time);
        assert.equal(got.source, `x/laya-${c.task}.jsonl:1`);
        assert.equal(got.state, stateOf(line));
        assert.deepEqual(got.answered, c.answered);
        assert.equal(got.by, c.by);
        assert.equal(got.p, raw.p);
        assert.deepEqual(got.right, c.right);
        assert.deepEqual(Object.keys(got.job), ['model', 'conf', 'priority', 'from', 'note']);
        assert.equal(got.job.model, c.task);
        assert.equal(got.job.conf, '');
        assert.equal(got.job.priority, 'next');
        assert.equal(got.job.from, '');
        assert.match(got.job.note, new RegExp(`^correction ${c.task} ${raw.time}: .+ → .+`));
    });
}

test('correction: craft note and outcome; --model and --note override', () => {
    const got = correctionCase('craft', first('craft'), { Action: 'craft', Item: 'crafting_table' }, { model: 'craft-v2', note: 'table first' });
    assert.equal(got.model, 'craft-v2');
    assert.equal(got.job.model, 'craft-v2');
    assert.equal(got.note, 'table first');
    assert.equal(got.outcome, 'did');
    assert.equal(got.job.note, 'correction craft 2026-11-11T09:30:46.721Z: craft planks 1 → craft crafting_table');
});

test('correction: a craft rules line is by rules; a stop line with no answer is by none', () => {
    const br = lines('branches/craft.jsonl');
    const rules = br.find(l => l.includes('"source":"rules"'))!;
    const r = correctionCase('craft', rules, { Action: 'craft', Item: 'planks', Count: '4' });
    assert.equal(r.by, 'rules');
    assert.deepEqual(r.answered, { Action: 'done', Item: 'none', Count: '1' });
    const stop = br.find(l => l.includes('"outcome":"stop"'))!;
    const s = correctionCase('craft', stop, { Action: 'gather', Item: 'log' });
    assert.equal(s.by, 'none');
    assert.deepEqual(s.answered, {});
    assert.equal(s.reason, 'no-answer');
    assert.match(s.job.note, /: no answer → gather log$/);
});

test('correction: a mine veto line keeps the model\'s step, not the rules\'', () => {
    const veto = lines('branches/mine.jsonl').find(l => l.includes('"veto"'))!;
    const got = correctionCase('mine', veto, { Action: 'tunnel S' });
    assert.deepEqual(got.answered, { Action: 'tunnel E', Hazard: 0.1 });
    assert.equal(got.by, 'model');
});

test('correction: farm low-confidence and banned lines carry the model\'s words', () => {
    const br = lines('branches/farm.jsonl');
    const low = correctionCase('farm', br.find(l => l.includes('"source":"low-confidence"'))!, { Action: 'wait' });
    assert.deepEqual(low.answered, { Action: 'harvest' });
    assert.equal(low.by, 'model');
    const banned = correctionCase('farm', br.find(l => l.includes('"source":"banned"'))!, { Action: 'harvest' });
    assert.deepEqual(banned.answered, { Action: 'till', Target: 'E0 S0' });
    const dry = correctionCase('farm', br.find(l => l.includes('"source":"dry"'))!, { Action: 'find_water' });
    assert.equal(dry.by, 'rules');
});

test('correction: errors', () => {
    const err = (f: () => unknown, re: RegExp) => assert.throws(f, (e: unknown) => e instanceof CorrectionError && re.test(e.message));
    err(() => correctionCase('craft', 'not json', { Action: 'done' }), /not JSON/);
    const plan = lines('branches/mine.jsonl').find(l => l.includes('"planned"'))!;
    err(() => correctionCase('mine', plan, { Action: 'stop' }), /no state/);
    const walk = lines('branches/mine.jsonl').find(l => l.includes('"walk"'))!;
    err(() => correctionCase('mine', walk, { Action: 'stop' }), /not a mine step/);
    err(() => correctionCase('craft', first('craft'), {}), /no right answer/);
    err(() => correctionCase('craft', first('craft'), { Weapon: 'none' }), /no question Weapon/);
    err(() => correctionCase('craft', first('craft'), { Action: 'craft', Count: '1' }), /nothing to correct/);
    err(() => correctionCase('eat', first('eat'), { Eat: '0' }), /nothing to correct/);
});

test('parseRight: split on "," then the first "=" only; values with spaces', () => {
    assert.deepEqual(parseRight('Action=craft,Item=stick,Count=4'), { Action: 'craft', Item: 'stick', Count: '4' });
    assert.deepEqual(parseRight('Target=W1 S1'), { Target: 'W1 S1' });
    assert.deepEqual(parseRight('Target=husk 1,Action=fight'), { Target: 'husk 1', Action: 'fight' });
    assert.deepEqual(parseRight('Note=a=b'), { Note: 'a=b' });
    assert.throws(() => parseRight('Action'), CorrectionError);
    assert.throws(() => parseRight('Action='), CorrectionError);
});

test('pickLine: --line, --time, --match, default the last line with a state', () => {
    const ls = lines('branches/mine.jsonl');
    assert.equal(pickLine(ls, { line: 2 }).text, ls[1]);
    assert.equal(pickLine(ls, { line: 2 }).n, 2);
    assert.throws(() => pickLine(ls, { line: 0 }), CorrectionError);
    assert.throws(() => pickLine(ls, { line: ls.length + 1 }), CorrectionError);
    const t = (JSON.parse(ls[4]!) as { time: string }).time;
    const byTime = pickLine(ls, { time: t });
    assert.equal((JSON.parse(byTime.text) as { time: string }).time, t);
    const m = pickLine(ls, { match: '"veto":"fluid behind"' });
    assert.equal(m.n, ls.findIndex(l => l.includes('fluid behind')) + 1);
    assert.throws(() => pickLine(ls, { match: 'nowhere-at-all' }), CorrectionError);
    const chores = lines('laya-chores.jsonl');
    assert.equal(pickLine(chores, {}).n, 1); // line 2 (ended) has no state
});

test('runCli: reads the log, picks the line, records the source', () => {
    const log = path.join(FIX, 'branches/craft.jsonl');
    const c = JSON.parse(runCli(['--task', 'craft', '--log', log, '--line', '1', '--right', 'Action=done'])) as { source: string; answered: Answers };
    assert.equal(c.source, 'test/fixtures/laya-logs/branches/craft.jsonl:1');
    assert.deepEqual(c.answered, { Action: 'craft', Item: 'stick', Count: '1' });
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'corr-')), 'case.json');
    assert.equal(runCli(['--task', 'farm', '--log', path.join(FIX, 'laya-farm.jsonl'), '--right', 'Target=W1 S0', '--out', out]), '');
    assert.equal((JSON.parse(fs.readFileSync(out, 'utf8')) as { task: string }).task, 'farm');
    assert.throws(() => runCli(['--task', 'nope', '--right', 'A=b']), /--task must be one of/);
    assert.throws(() => runCli(['--task', 'craft']), /--right is required/);
});

test('CLI smoke: the built tool prints a case as JSON, and exits 1 with the message on an error', () => {
    const tool = path.join(HERE, '..', 'src', 'log', 'correction.js');
    const log = path.join(FIX, 'laya-craft.jsonl');
    const out = execFileSync(process.execPath, [tool, '--task', 'craft', '--log', log, '--right', 'Action=done'], { encoding: 'utf8' });
    const c = JSON.parse(out) as { job: { priority: string }; right: Answers };
    assert.equal(c.job.priority, 'next');
    assert.deepEqual(c.right, { Action: 'done' });
    assert.throws(() => execFileSync(process.execPath, [tool, '--task', 'craft', '--log', log, '--right', 'Action=craft'], { stdio: 'pipe' }),
        (e: { status?: number; stderr?: Buffer }) => e.status === 1 && /Count|nothing to correct/.test(String(e.stderr)));
});
