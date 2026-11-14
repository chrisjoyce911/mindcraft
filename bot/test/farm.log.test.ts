// 5.3 laya-farm.jsonl in the old bot's format: the live v2 line (test/fixtures/laya-logs/laya-farm.jsonl) and every
// entry shape (branches/farm.jsonl, recorded from the old JS by tools/laya-logs/record-farm.mjs on the farms of
// tools/laya-logs/farm-sessions.mjs), byte for byte (time aside: the fixture's is used).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { FarmRun } from '../src/jobs/farm.js';
import { FARM_DEFAULTS, type FarmSettings } from '../src/jobs/deps.js';
import { farmCraftLine, farmStepLine, stamp, type FarmLine } from '../src/log/jsonl.js';
import type { FarmView, Grid, Carry, FarmItem } from '../src/models/farm/index.js';
import { reply, runFarm, worldOf, type FakeBot, type OldDeps, type OldGoal } from './farmfake.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lines = (rel: string): string[] => fs.readFileSync(path.join(REPO, 'test/fixtures/laya-logs', rel), 'utf8').split('\n').filter(Boolean);
const timeOf = (line: string): Date => new Date((JSON.parse(line) as { time: string }).time);

test('golden: laya-farm.jsonl (a live v2 till the model chose) byte for byte', async () => {
    const [want] = lines('laya-farm.jsonl');
    const old = JSON.parse(want!) as { state: string };
    const L = old.state.split('\n');
    const carry: Carry[] = [];
    const c = L[3]!.split(' ').slice(1);
    for (let k = 0; k < c.length; k += 2) carry.push({ item: c[k] as FarmItem, count: +c[k + 1]!.slice(1) });
    const s: FarmView = { grid: L.slice(5).map(r => [...r]) as Grid, ys: L.slice(5).map(() => Array<number>(9).fill(64)), carry, animals: [] };
    const r = reply('till', 'W1 S1', 'hoe', 1, 260);
    r.answers.Unload = { type: 'noul', probability: 0, top: 'false', topProbability: 1, confident: true };
    const deps: OldDeps = {
        client: { decide: async () => r }, task: {}, read: () => s, act: async () => true, craft: async () => true,
        now: () => 0, sleep: async () => {}, log: () => {}, inventory: () => ({ wooden_hoe: 1, wheat_seeds: 10 }),
        position: () => ({ x: 0, y: 65, z: 0 }),
        pack: { freeSlots: () => 32, hostiles: () => 0, health: () => 20, food: () => 20, home: () => ({ x: 236, y: 65, z: 0 }),
            goHome: async () => true, deposit: async () => true, isFood: () => false },
    };
    const got: FarmLine[] = [];
    const run = new FarmRun({
        crop: 'wheat', count: 'forever', progress: {},
        settings: () => ({ ...FARM_DEFAULTS, prompt: 'v2', enabled: true, model: { decide: async () => r } } as FarmSettings),
        world: () => worldOf(deps), log: l => got.push(l), note: () => {}, chat: () => {}, checkpoint: () => {},
    });
    await run.step(new AbortController().signal);
    assert.equal(got.length, 1);
    assert.equal(stamp(got[0]!, timeOf(want!)), want);
});

test('branches: every laya-farm.jsonl entry shape, line for line as the old farmWithLaya wrote them', async () => {
    const want = lines('branches/farm.jsonl');
    const { SESSIONS } = await import(pathToFileURL(path.join(REPO, 'tools/laya-logs/farm-sessions.mjs')).href) as
        { SESSIONS: { goal: OldGoal; make(): { bot: FakeBot; deps: OldDeps } }[] };
    const got: FarmLine[] = [];
    for (const session of SESSIONS) {
        const s = session.make();
        await runFarm(s.bot, session.goal, s.deps, { lines: got });
    }
    assert.equal(got.length, want.length, 'as many lines');
    got.forEach((line, i) => assert.equal(stamp(line, timeOf(want[i]!)), want[i], `line ${i + 1}`));
});

test('the line builders keep the old field order', () => {
    const t = new Date('2026-11-12T09:00:00.000Z');
    assert.equal(stamp(farmCraftLine(false, 'hoe', 1), t), '{"time":"2026-11-12T09:00:00.000Z","outcome":"craft-failed","item":"hoe","count":1}');
    assert.equal(stamp(farmStepLine({ state: 'S', unload: undefined, action: 'unload' }, 'done'), t), '{"time":"2026-11-12T09:00:00.000Z","state":"S","action":"unload","outcome":"done"}');
    assert.equal(JSON.stringify(farmStepLine({ state: 'S', p: 1, ms: 2, action: 'find_water', target: 'none', item: 'none', source: 'model' }, 'went-to-water', { water: { x: 1, y: 2, z: 3 } })),
        '{"state":"S","p":1,"ms":2,"action":"find_water","target":"none","item":"none","source":"model","outcome":"went-to-water","water":{"x":1,"y":2,"z":3}}');
});
