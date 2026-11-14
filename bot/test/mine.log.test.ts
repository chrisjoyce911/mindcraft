// 5.2 laya-mine.jsonl in the old bot's format: the live v2 line (test/fixtures/laya-logs/laya-mine.jsonl) and every
// entry shape (branches/mine.jsonl, recorded from the old JS by tools/laya-logs/record-mine.mjs on the worlds of
// tools/laya-logs/mine-sessions.mjs), byte for byte (time aside: the fixture's is used).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { decideMineStep, readView, state, type MineSituation, type View, type Cell, type Dir, type Ore, type Tier, type MoveAction, TIERS } from '../src/models/mine/index.js';
import { mineLines, mineStepLine, stamp, type MineLine } from '../src/log/jsonl.js';
import { runMine, type OldDeps, type FakeBot } from './minefake.js';
import { withUnload, answer } from './minefake.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const lines = (rel: string): string[] => fs.readFileSync(path.join(REPO, 'test/fixtures/laya-logs', rel), 'utf8').split('\n').filter(Boolean);
const timeOf = (line: string): Date => new Date((JSON.parse(line) as { time: string }).time);

function parseV2(text: string): MineSituation {
    const ls = text.split('\n');
    const [, ore, , y, , pick, , torches, , blocks, , dark, , heading] = ls[1]!.split(' ');
    const [, free, , home, , health, , food, , hostiles, , vals] = ls[3]!.split(' ');
    const seen = ls[4] === 'Seen none' ? 0 : Number(ls[4]!.split(' ')[1]);
    const view: View = [0, 1, 2, 3, 4].map(l => ls.slice(5).map(row => [...row.split(' ')[l]!] as Cell[]));
    return { ore: ore as Ore, y: Number(y), pick: (TIERS as readonly string[]).indexOf(pick!) as Tier, torches: Number(torches), blocks: Number(blocks),
        dark: Number(dark), heading: heading as Dir, plan: ls[2]!.slice(5) as MoveAction, free: Number(free), home: home === 'none' ? null : Number(home),
        health: Number(health), food: Number(food), hostiles: Number(hostiles), valuables: Number(vals), seen, view };
}

test('golden: laya-mine.jsonl (a live v2 collect the model chose) byte for byte', async () => {
    const [want] = lines('laya-mine.jsonl');
    const old = JSON.parse(want!) as { state: string; pos: { x: number; y: number; z: number }; ore: { x: number; y: number; z: number } };
    const s = parseV2(old.state);
    assert.equal(state(s), old.state);
    const reply = withUnload(answer('collect', 1, 219), 0);
    reply.answers.Hazard = { type: 'noul', probability: 0, top: 'false', topProbability: 1, confident: true };
    const d = await decideMineStep({ s, hasPlan: true, isDrop: () => false, client: { decide: async () => reply }, unloadAllowed: true });
    assert.equal(d.source, 'model');
    const entry = { rule: d.rule.action, pos: old.pos, state: d.state, model: d.said!.model, p: d.said!.p, hazard: d.said!.hazard, ms: d.said!.ms,
        unload: d.unload?.p, action: d.action, source: d.source, why: d.why, ore: old.ore };
    assert.equal(stamp(mineStepLine(entry, 'done'), timeOf(want!)), want);
});

test('branches: every laya-mine.jsonl entry shape, line for line as the old mineWithLaya wrote them', async () => {
    const want = lines('branches/mine.jsonl');
    const { SESSIONS } = await import(pathToFileURL(path.join(REPO, 'tools/laya-logs/mine-sessions.mjs')).href) as
        { SESSIONS: { ore: string; count: number; make(): { bot: FakeBot; deps: OldDeps } }[] };
    const got: MineLine[] = [];
    for (const session of SESSIONS) {
        const s = session.make();
        await runMine(s.bot, session.ore, session.count, s.deps, { lines: got });
    }
    assert.equal(got.length, want.length, 'as many lines');
    got.forEach((line, i) => assert.equal(stamp(line, timeOf(want[i]!)), want[i], `line ${i + 1}`));
});

test('the blocked line and the other builders keep the old field order', () => {
    const t = new Date('2026-11-11T09:00:00.000Z');
    assert.equal(stamp(mineLines.blocked({ x: 1, y: 2, z: 3 }), t), '{"time":"2026-11-11T09:00:00.000Z","pos":{"x":1,"y":2,"z":3},"plan":"blocked","outcome":"unsafe-ground"}');
    assert.equal(stamp(mineLines.start({ x: 0, y: 60, z: 0 }, 'E', null), t), '{"time":"2026-11-11T09:00:00.000Z","start":{"x":0,"y":60,"z":0},"heading":"E","toward":null,"outcome":"planned"}');
    // an unload line has no why; a step line's why may be null
    const e = { rule: 'tunnel E', pos: { x: 0, y: 0, z: 0 }, state: 'S', unload: undefined };
    assert.equal(JSON.stringify(mineStepLine({ ...e, action: 'unload', source: 'rules' }, 'done')), '{"rule":"tunnel E","pos":{"x":0,"y":0,"z":0},"state":"S","action":"unload","source":"rules","outcome":"done"}');
    assert.equal(JSON.stringify(mineStepLine({ ...e, action: 'tunnel E', source: 'model', why: null }, 'done')), '{"rule":"tunnel E","pos":{"x":0,"y":0,"z":0},"state":"S","action":"tunnel E","source":"model","why":null,"outcome":"done"}');
    void readView;
});
