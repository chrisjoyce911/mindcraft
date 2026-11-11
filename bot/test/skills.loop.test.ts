// 5.5 the skill jobs' loops with fake worlds (jobs/huntFood, gatherSkill, place): each answer maps to the right act,
// resume keeps the search and the counts, an abort counts nothing, give_up / full / no_spot / timeout / stuck end
// with their typed reason, a harmful model answer is vetoed and a malformed one falls back (logged with why), a
// missing item and a changed cell end the place run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { JobState, Outcome, StepResult, Vec3Like } from '../src/types/index.js';
import type { DecideResult, ModelDecider } from '../src/types/models.js';
import type { JobDeps, JobOf, SkillSettings } from '../src/jobs/deps.js';
import type { SkillLine, SkillLogTask } from '../src/log/jsonl.js';
import {
    gatherSkillStep, gatherSteps, huntFoodStep, maxSkillSteps, makeRunner, placeStep, STUCK_REPEATS,
    type GatherSkillWorld, type HuntFoodWorld, type PlaceWorld,
} from '../src/jobs/index.js';
import type { Creature, GridBlock, GroundItem } from '../src/sensors/skills.js';
import { forgetIds, planRestore } from '../src/home/jobfile.js';

interface Logged { task: SkillLogTask; line: SkillLine }
function deps(model: ModelDecider | null = null): JobDeps & { lines: Logged[]; notes: string[] } {
    const lines: Logged[] = [], notes: string[] = [];
    const skill = (): SkillSettings => ({ enabled: !!model, min_confidence: 0.3, log_steps: true, model });
    return {
        lines, notes, act: () => null, places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} },
        follow: () => { throw new Error('no follow'); }, followLog: () => {},
        skill, skillLog: (task, line) => lines.push({ task, line }), note: t => notes.push(t),
    };
}
const job = <K extends 'huntFood' | 'gatherSkill' | 'place'>(spec: JobOf<K>['spec'], progress: object = {}): JobOf<K> =>
    ({ id: 'j', spec, origin: 'player', progress, status: 'running', startedAt: 0 }) as unknown as JobOf<K>;
const live = () => new AbortController().signal;
const ok: Outcome = { ok: true };
const answer = (words: Record<string, string>, p = 0.9): DecideResult => ({ model: 'm', ms: 5,
    answers: Object.fromEntries(Object.entries(words).map(([k, v]) => [k, { type: 'choice' as const, top: v, topProbability: p, probabilities: { [v]: p }, confident: true }])) });
const model = (words: Record<string, string>, p?: number): ModelDecider => ({ decide: async () => answer(words, p) });

// ---- hunt ----
interface FakeHunt extends HuntFoodWorld { calls: string[]; pos: Vec3Like; food: number; animals: Creature[]; drops: GroundItem[]; killOutcome?: Outcome; abortOnKill?: AbortController }
function huntWorld(animals: Creature[], over: Partial<FakeHunt> = {}): FakeHunt {
    const w: FakeHunt = {
        calls: [], pos: { x: 0, y: 64, z: 0 }, food: 0, animals, drops: [],
        me: () => w.pos,
        items: () => w.food ? [{ name: 'beef', count: w.food }, { name: 'rotten_flesh', count: 5 }] : [{ name: 'rotten_flesh', count: 5 }],
        isFood: n => n === 'beef' || n === 'rotten_flesh',
        creatures: () => w.animals,
        ground: () => w.drops,
        kill: async (c, signal) => {
            w.calls.push(`kill ${c.name} ${c.id}`);
            if (w.abortOnKill) { w.abortOnKill.abort(); return { ok: false, reason: 'cancelled' }; }
            if (w.killOutcome) return w.killOutcome;
            w.animals = w.animals.filter(a => a.id !== c.id);
            w.food += 3;
            return ok;
        },
        approach: async p => { w.calls.push(`approach ${p.x},${p.z}`); w.pos = { x: p.x - 2, y: 64, z: p.z }; return ok; },
        collect: async () => { w.calls.push('collect'); w.drops = []; return 0; },
        ...over,
    };
    return w;
}
const cow = (id: number, x: number, z = 0): Creature => ({ id, name: 'cow', position: { x, y: 64, z }, baby: false });

async function run(stepper: () => Promise<StepResult>, max = 50): Promise<StepResult> {
    for (let i = 0; i < max; i++) {
        const r = await stepper();
        if (r.how === 'end') return r;
    }
    throw new Error('no end');
}

test('hunt: approach, attack the nearest, then done at the goal (rules v1, logged with purpose and rule)', async () => {
    const d = deps();
    const w = huntWorld([cow(1, 6), cow(2, 7), cow(3, 9), cow(4, 10)]);
    const j = job<'huntFood'>({ kind: 'huntFood', goal: 5 });
    const r = await run(() => huntFoodStep(j, w, d, live()));
    assert.deepEqual(r, { how: 'end', end: { how: 'done' }, say: 'Hunted: I have 6 food.' });
    assert.deepEqual(w.calls, ['approach 6,0', 'kill cow 1', 'collect', 'kill cow 2', 'collect']);
    assert.deepEqual(d.lines.map(l => [l.task, l.line.rule, l.line.outcome, l.line.source, l.line.why]),
        [['hunt', 'approach', 'did', 'rules', 'rules'], ['hunt', 'attack', 'did', 'rules', 'rules'], ['hunt', 'attack', 'did', 'rules', 'rules'], ['hunt', 'done', 'done', 'rules', 'rules']]);
    assert.equal(d.lines[0]!.line.purpose, 'player');
    assert.equal(d.lines[0]!.line.goal, 'food 5');
    assert.match(d.lines[0]!.line.state, /^Hunt.\nGoal food 5 have 0\nAnimals cow 4 6 E/);
    assert.deepEqual((j.progress as { kills: number; steps: number }).kills, 2);
});

test('hunt: rotten flesh is not food; the chest counts; collect drops within 8 first', async () => {
    const d = deps();
    const w = huntWorld([], { drops: [{ id: 9, item: 'beef', position: { x: 3, y: 64, z: 0 } }] });
    const j = job<'huntFood'>({ kind: 'huntFood', goal: 8, chest: 2 });
    await huntFoodStep(j, w, d, live());
    assert.deepEqual(w.calls, ['collect']);
    assert.match(d.lines[0]!.line.state, /Goal food 8 have 2\n/);
});

test('hunt: nothing seen widens 49 → 97 → 193, then gives up: failed no_source (search kept in progress)', async () => {
    const d = deps();
    const j = job<'huntFood'>({ kind: 'huntFood', goal: 4 });
    const w = huntWorld([]);
    const r = await run(() => huntFoodStep(j, w, d, live()));
    assert.deepEqual(r.how === 'end' && r.end, { how: 'failed', reason: 'no_source' });
    assert.equal(r.how === 'end' && r.say, "I couldn't hunt for 4 food: no source.");
    assert.deepEqual(d.lines.map(l => l.line.rule), ['search', 'search', 'give-up']);
    assert.equal((j.progress as { search: number }).search, 193);
});

test('hunt: a resumed run keeps its start, search and counts; an abort mid-kill counts nothing', async () => {
    const d = deps();
    // resumed at 97 from a start 40 east: the cow at x 70 is inside 97 around x 40, not inside 49
    const j = job<'huntFood'>({ kind: 'huntFood', goal: 4 }, { origin: { x: 40, z: 0 }, search: 97, steps: 3, kills: 1 });
    const ac = new AbortController();
    const w = huntWorld([cow(1, 2), cow(2, 2.5, 1), cow(3, 70)], { abortOnKill: ac });
    const r = await huntFoodStep(j, w, d, ac.signal);
    assert.deepEqual(r, { how: 'more' });
    assert.deepEqual(w.calls, ['kill cow 1']);
    assert.deepEqual(j.progress, { origin: { x: 40, z: 0 }, search: 97, steps: 3, kills: 1, repeat: (j.progress as { repeat: unknown }).repeat });
    assert.equal(d.lines.length, 0);
    assert.match(d.notes.join() || '', /^$/);
});

test('hunt: the step bound ends timeout; the same failing step on the same state ends stuck', async () => {
    const d = deps();
    const j = job<'huntFood'>({ kind: 'huntFood', goal: 4 }, { steps: maxSkillSteps(4) });
    assert.deepEqual(await huntFoodStep(j, huntWorld([cow(1, 2)]), d, live()), { how: 'end', end: { how: 'failed', reason: 'timeout' }, say: "I couldn't hunt for 4 food: timeout." });
    // an approach that works but never gets andy nearer: the same state and step again and again
    const w = huntWorld([cow(1, 10)], { approach: async p => { w.calls.push(`approach ${p.x},${p.z}`); return ok; } });
    const k = job<'huntFood'>({ kind: 'huntFood', goal: 4 });
    const r = await run(() => huntFoodStep(k, w, d, live()));
    assert.deepEqual(r.how === 'end' && r.end, { how: 'failed', reason: 'stuck' });
    assert.equal(w.calls.length, STUCK_REPEATS - 1);
    assert.deepEqual(d.lines.slice(-1).map(l => [l.line.outcome, l.line.reason]), [['ended', 'stuck']]);
});

test('hunt: an animal an attack or approach failed on is left out; the next one is tried; ids are forgotten on a restore', async () => {
    const d = deps();
    const w = huntWorld([cow(1, 2), cow(2, 2.5, 1)]);
    w.kill = async c => { w.calls.push(`kill cow ${c.id}`); if (c.id === 1) return { ok: false, reason: 'unreachable' }; w.animals = w.animals.filter(a => a.id !== c.id); w.food += 3; return ok; };
    const j = job<'huntFood'>({ kind: 'huntFood', goal: 3 });
    const r = await run(() => huntFoodStep(j, w, d, live()));
    assert.equal(r.how === 'end' && r.end.how, 'done');
    assert.deepEqual(w.calls, ['kill cow 1', 'kill cow 2', 'collect']);
    assert.deepEqual((j.progress as { skipMobs: number[] }).skipMobs, [1]);
    const saved = { spec: j.spec, origin: 'player' as const, progress: { ...j.progress as object, skip: [5] }, status: 'running' as const, startedAt: Date.now() };
    const plan = planRestore({ kind: 'typed', fresh: true, savedAt: Date.now(), entries: [saved], lost: 0 }, () => true);
    const back = plan.restore[0]!.progress as Record<string, unknown>;
    assert.equal('skip' in back || 'skipMobs' in back, false);
    assert.equal(back.kills, (j.progress as { kills: number }).kills);
});

test('hunt: a sure model answer is acted on; a harmful one (the last two, not hungry) is vetoed; a malformed one falls back', async () => {
    const two = [cow(1, 2), cow(2, 2.2)];
    const pigs = [{ id: 7, name: 'pig', position: { x: 5, y: 64, z: 0 }, baby: false }, { id: 8, name: 'pig', position: { x: 5, y: 64, z: 1 }, baby: false },
        { id: 9, name: 'pig', position: { x: 6, y: 64, z: 1 }, baby: false }];
    // 9 food, not hungry: the two cows are the last two; the model says attack cow → veto → rules approach pig
    const d = deps(model({ Action: 'attack', Target: 'cow' }));
    const w = huntWorld([...two, ...pigs], { food: 9 });
    await huntFoodStep(job<'huntFood'>({ kind: 'huntFood', goal: 20 }), w, d, live());
    assert.deepEqual(w.calls, ['approach 5,0']);
    const l = d.lines[0]!.line;
    assert.deepEqual([l.source, l.why, l.model, l.answer, l.rule, l.p], ['rules', 'veto', { Action: 'attack', Target: 'cow' }, { Action: 'approach', Target: 'pig' }, 'approach', 0.9]);
    const m = deps(model({ Action: 'approach', Target: 'pig' }));
    const w2 = huntWorld([...two, ...pigs], { food: 9 });
    await huntFoodStep(job<'huntFood'>({ kind: 'huntFood', goal: 20 }), w2, m, live());
    assert.deepEqual([m.lines[0]!.line.source, m.lines[0]!.line.why], ['model', undefined]);
    const bad = deps(model({ Action: 'collect', Target: 'pig' }));
    await huntFoodStep(job<'huntFood'>({ kind: 'huntFood', goal: 20 }), huntWorld([...pigs], { food: 9 }), bad, live());
    assert.deepEqual([bad.lines[0]!.line.why, bad.lines[0]!.line.answer.Action], ['malformed', 'approach']);
});

// ---- gather ----
interface FakeGather extends GatherSkillWorld { calls: string[]; pos: Vec3Like; pack: { name: string; count: number }[]; slots: number; sheep: Creature[]; logList: Vec3Like[] }
function gatherWorld(over: Partial<FakeGather> = {}): FakeGather {
    const w: FakeGather = {
        calls: [], pos: { x: 0, y: 64, z: 0 }, pack: [], slots: 20, sheep: [], logList: [],
        me: () => w.pos, items: () => w.pack, free: () => w.slots,
        creatures: () => w.sheep, ground: () => [],
        logs: () => w.logList, leavesBeside: p => p.y >= 67, grass: () => [],
        fell: async t => { w.calls.push(`fell ${t.base.x},${t.base.z} ${t.logs.length}`); w.pack.push({ name: 'oak_log', count: t.logs.length }); w.logList = w.logList.filter(p => p.x !== t.base.x); return ok; },
        dig: async p => { w.calls.push(`dig ${p.x}`); return ok; },
        shear: async c => { w.calls.push(`shear ${c.id}`); c.sheared = true; w.pack.push({ name: 'white_wool', count: 2 }); return ok; },
        kill: async c => { w.calls.push(`kill ${c.id}`); return ok; },
        approach: async p => { w.calls.push(`approach ${p.x},${p.z}`); w.pos = { x: p.x - 2, y: 64, z: p.z }; return ok; },
        collect: async () => { w.calls.push('collect'); return 0; },
        ...over,
    };
    return w;
}
const trunk = (x: number) => [64, 65, 66, 67].map(y => ({ x, y, z: 0 }));

test('gather logs: approach the nearest tree, fell it whole, done at the goal (wood counts planks)', async () => {
    const d = deps();
    const w = gatherWorld({ logList: [...trunk(6), ...trunk(3)], pack: [{ name: 'oak_planks', count: 4 }] });
    const j = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'logs', goal: 9 });
    const r = await run(() => gatherSkillStep(j, w, d, live()));
    assert.deepEqual(r, { how: 'end', end: { how: 'done' }, say: 'Gathered: I have 9 logs.' });
    assert.deepEqual(w.calls, ['fell 3,0 4', 'approach 6,0', 'fell 6,0 4']);
    assert.deepEqual(d.lines.map(l => l.line.rule), ['cut', 'approach', 'cut', 'done']);
});

test('gather seeds: cuts that drop no seed on the same state are not stuck; seeds get a larger step bound', async () => {
    const d = deps();
    const grass = [{ x: 1, y: 64, z: 0 }, { x: 1, y: 64, z: 1 }];
    let cuts = 0;
    const w = gatherWorld({ grass: () => grass });
    // the same two grass blocks are seen every time (the count and distance don't change), a seed 1 cut in 8
    w.dig = async p => { w.calls.push(`dig ${p.x}`); if (++cuts % 8 === 0) w.pack = [{ name: 'wheat_seeds', count: cuts / 8 }]; return ok; };
    const j = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'seeds', goal: 2 });
    const r = await run(() => gatherSkillStep(j, w, d, live()));
    assert.deepEqual(r.how === 'end' && r.end, { how: 'done' });
    assert.equal(cuts, 16);
    assert.equal(gatherSteps('seeds', 16), 16 * 16 + 20);
    assert.equal(gatherSteps('logs', 16), maxSkillSteps(16));
    assert.ok(gatherSteps('seeds', 16) >= 10 * 16 + 20);
    // the logs bound would have ended this seeds run: 4×goal+20 steps < 8×goal cuts for 16 seeds
    assert.ok(maxSkillSteps(16) < 8 * 16);
});

test('gather: an unreachable tree or grass is left out and the next is tried (skipAt kept on a restore)', async () => {
    const d = deps();
    const w = gatherWorld({ logList: [...trunk(2), ...trunk(8)] });
    w.fell = async t => {
        w.calls.push(`fell ${t.base.x},${t.base.z}`);
        if (t.base.x === 2) return { ok: false, reason: 'unreachable', detail: 'no log of the tree dug' };
        w.pack.push({ name: 'oak_log', count: 4 }); w.logList = w.logList.filter(p => p.x !== t.base.x); return ok;
    };
    const j = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'logs', goal: 4 });
    const r = await run(() => gatherSkillStep(j, w, d, live()));
    assert.equal(r.how === 'end' && r.end.how, 'done');
    assert.deepEqual(w.calls, ['fell 2,0', 'approach 8,0', 'fell 8,0']);
    assert.deepEqual((j.progress as { skipAt: string[] }).skipAt, ['2,64,0']);
    const g = gatherWorld({ grass: () => [{ x: 1, y: 64, z: 0 }, { x: 2, y: 64, z: 0 }] });
    g.dig = async p => { g.calls.push(`dig ${p.x}`); if (p.x === 1) return { ok: false, reason: 'unreachable' }; g.pack = [{ name: 'wheat_seeds', count: 1 }]; return ok; };
    const gs = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'seeds', goal: 1 });
    const gr = await run(() => gatherSkillStep(gs, g, deps(), live()));
    assert.equal(gr.how === 'end' && gr.end.how, 'done');
    assert.deepEqual(g.calls, ['dig 1', 'dig 2']);
    const restored = forgetIds({ skipAt: ['2,64,0'], skip: [3], skipMobs: [4], steps: 2 });
    assert.deepEqual(restored, { skipAt: ['2,64,0'], steps: 2 });
});

test('gather: no free slot gives up full; nothing anywhere gives up no_source', async () => {
    const d = deps();
    const full = await gatherSkillStep(job<'gatherSkill'>({ kind: 'gatherSkill', target: 'logs', goal: 4 }), gatherWorld({ slots: 0, logList: trunk(2) }), d, live());
    assert.deepEqual(full.how === 'end' && full.end, { how: 'failed', reason: 'full' });
    const j = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'seeds', goal: 4 });
    const g = gatherWorld();
    const r = await run(() => gatherSkillStep(j, g, d, live()));
    assert.deepEqual(r.how === 'end' && r.end, { how: 'failed', reason: 'no_source' });
});

test('gather wool: shear with shears (sheared sheep are not a source); kill without shears only with 3+ sheep', async () => {
    const sheep = (id: number, x: number, sheared = false): Creature => ({ id, name: 'sheep', position: { x, y: 64, z: 0 }, baby: false, sheared });
    const d = deps();
    const w = gatherWorld({ pack: [{ name: 'shears', count: 1 }], sheep: [sheep(1, 2, true), sheep(2, 3)] });
    const j = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'wool', goal: 2 });
    const r = await run(() => gatherSkillStep(j, w, d, live()));
    assert.equal(r.how === 'end' && r.end.how, 'done');
    assert.deepEqual(w.calls, ['shear 2']);
    const k = gatherWorld({ sheep: [sheep(1, 2), sheep(2, 3), sheep(3, 4)] });
    await gatherSkillStep(job<'gatherSkill'>({ kind: 'gatherSkill', target: 'wool', goal: 2 }), k, deps(), live());
    assert.deepEqual(k.calls, ['kill 1', 'collect']);
    // a model kill with shears carried is harmful: vetoed, the rules shear
    const v = deps(model({ Action: 'kill' }));
    const s = gatherWorld({ pack: [{ name: 'shears', count: 1 }], sheep: [sheep(1, 2), sheep(2, 3), sheep(3, 4)] });
    await gatherSkillStep(job<'gatherSkill'>({ kind: 'gatherSkill', target: 'wool', goal: 9 }), s, v, live());
    assert.deepEqual([s.calls, v.lines[0]!.line.why], [['shear 1'], 'veto']);
});

// ---- place ----
function placeWorld(over: Record<string, GridBlock> = {}, carry: string | null = 'furnace', chest: string | null = null): PlaceWorld & { puts: string[]; grid: Record<string, GridBlock>; putOutcome?: Outcome } {
    const grid = { ...over };
    const w: PlaceWorld & { puts: string[]; grid: Record<string, GridBlock>; putOutcome?: Outcome } = {
        puts: [] as string[], grid,
        carried: () => carry,
        fetch: async () => { w.puts.push(`fetch ${chest}`); return chest; },
        centre: () => ({ x: 10, y: 64, z: 20 }),
        blockAt: (x: number, y: number, z: number): GridBlock | null => {
            const k = `${x},${y},${z}`;
            if (grid[k]) return grid[k]!;
            if (y < 63) return { name: 'stone', boundingBox: 'block' };
            if (y === 63) return { name: 'grass_block', boundingBox: 'block' };
            return { name: 'air', boundingBox: 'empty', light: 15 };
        },
        put: async (name: string, _item: string, p: Vec3Like) => { w.puts.push(`${name} ${p.x},${p.y},${p.z}`); return w.putOutcome ?? ok; },
    };
    return w;
}

test('place: the rules pick the cell (next to a station), it is read again, then placed; logged', async () => {
    const d = deps();
    const w = placeWorld({ '12,64,19': { name: 'chest', boundingBox: 'block' } });
    const r = await placeStep(job<'place'>({ kind: 'place', item: 'furnace' }), w, d, live());
    assert.deepEqual(r, { how: 'end', end: { how: 'done' }, say: 'Placed the furnace at 11 64 19.' });
    assert.deepEqual(w.puts, ['furnace 11,64,19']);
    assert.deepEqual([d.lines[0]!.task, d.lines[0]!.line.rule, d.lines[0]!.line.answer, d.lines[0]!.line.outcome], ['place', 'station-by-station', { Target: 'E1 N1' }, 'did']);
});

test('place: not carried → missing_<item>; no cell → no_spot; a model none → no_spot; a changed cell → no_spot', async () => {
    const d = deps();
    const nobed = placeWorld({}, null);
    const miss = await placeStep(job<'place'>({ kind: 'place', item: 'bed' }), nobed, d, live());
    assert.deepEqual(miss.how === 'end' && miss.end, { how: 'failed', reason: 'missing_bed' });
    assert.deepEqual(nobed.puts, ['fetch null']); // the home chest was asked first
    // torches need a dark floor: all lit → none
    const lit = await placeStep(job<'place'>({ kind: 'place', item: 'torch' }), placeWorld({}, 'torch'), d, live());
    assert.deepEqual(lit.how === 'end' && lit.end, { how: 'failed', reason: 'no_spot' });
    const none = await placeStep(job<'place'>({ kind: 'place', item: 'furnace' }), placeWorld(), deps(model({ Target: 'none' })), live());
    assert.deepEqual(none.how === 'end' && none.end, { how: 'failed', reason: 'no_spot' });
    // the cell answered (E0 N1: 10,64,19) fills while the model thinks: read again, it changed
    const w = placeWorld();
    const filling: ModelDecider = { decide: async () => { w.grid['10,64,19'] = { name: 'cobblestone', boundingBox: 'block' }; return answer({ Target: 'E0 N1' }); } };
    const changed = await placeStep(job<'place'>({ kind: 'place', item: 'furnace' }), w, deps(filling), live());
    assert.deepEqual(changed.how === 'end' && changed.end, { how: 'failed', reason: 'no_spot' });
    assert.deepEqual(w.puts, []);
});

test('place: an item not carried is taken from the home chest, then placed', async () => {
    const w = placeWorld({}, null, 'white_bed');
    const r = await placeStep(job<'place'>({ kind: 'place', item: 'bed' }), w, deps(), live());
    assert.equal(r.how === 'end' && r.end.how, 'done');
    assert.equal(w.puts[0], 'fetch white_bed');
    assert.match(w.puts[1]!, /^white_bed /);
});

test('place bed: the east (head) cell is read again; a put that fails (walk west, wrong head) ends stuck', async () => {
    // the rules' bed cell: the east neighbour fills while the model thinks → no_spot, nothing placed
    const w = placeWorld({}, 'red_bed');
    const first = await placeStep(job<'place'>({ kind: 'place', item: 'bed' }), placeWorld({}, 'red_bed'), deps(), live());
    assert.equal(first.how === 'end' && first.end.how, 'done');
    const filling: ModelDecider = { decide: async () => { w.grid['11,64,19'] = { name: 'cobblestone', boundingBox: 'block' }; return answer({ Target: 'E0 N1' }); } };
    const changed = await placeStep(job<'place'>({ kind: 'place', item: 'bed' }), w, deps(filling), live());
    assert.deepEqual(changed.how === 'end' && changed.end, { how: 'failed', reason: 'no_spot' });
    assert.deepEqual(w.puts, []);
    const u = placeWorld({}, 'red_bed');
    u.putOutcome = { ok: false, reason: 'unreachable', detail: 'west of the bed cell' };
    const stuck = await placeStep(job<'place'>({ kind: 'place', item: 'bed' }), u, deps(), live());
    assert.deepEqual(stuck.how === 'end' && stuck.end, { how: 'failed', reason: 'stuck' });
});

test('place: a torch goes on a dark floor point of the 7×7 step-3 grid; a model cell that does not qualify is vetoed', async () => {
    const d = deps();
    const w = placeWorld({ '13,64,17': { name: 'air', boundingBox: 'empty', light: 2 } }, 'torch');
    await placeStep(job<'place'>({ kind: 'place', item: 'torch' }), w, d, live());
    assert.deepEqual(w.puts, ['torch 13,64,17']);
    const v = deps(model({ Target: 'E0 N1' }));
    const water = placeWorld({ '10,63,18': { name: 'water', boundingBox: 'empty' } });
    await placeStep(job<'place'>({ kind: 'place', item: 'furnace' }), water, v, live());
    assert.equal(v.lines[0]!.line.why, 'veto');
    assert.notDeepEqual(water.puts, ['furnace 10,64,19']);
});

test('makeRunner builds the three skill jobs; left() for the Job line', () => {
    const d = deps();
    for (const spec of [{ kind: 'huntFood', goal: 4 }, { kind: 'gatherSkill', target: 'logs', goal: 8 }, { kind: 'place', item: 'chest' }] as const) {
        const r = makeRunner({ id: 'x', spec, origin: 'player', progress: {}, status: 'running', startedAt: 0 } as JobState, d);
        assert.ok(r, spec.kind);
    }
});

test('a skill line feeds the correction tool (5.7): the model words when it answered, else the rules words; the job file keeps the kinds', async () => {
    const { correctionCase } = await import('../src/log/correction.js');
    const { isJobSpec } = await import('../src/home/jobfile.js');
    const { stamp, skillLine } = await import('../src/log/jsonl.js');
    const base = { purpose: 'player' as const, goal: 'food 8', state: 'Hunt.\nGoal food 8 have 0', rule: 'attack', words: { Action: 'attack', Target: 'cow' } };
    const vetoed = stamp(skillLine({ ...base, source: 'rules', why: 'veto', asked: { words: { Action: 'attack', Target: 'pig' }, p: 0.81234, ms: 9 } }, 'did'));
    const c = correctionCase('hunt', vetoed, { Action: 'approach', Target: 'cow' });
    assert.deepEqual([c.answered, c.by, c.p], [{ Action: 'attack', Target: 'pig' }, 'model', 0.812]);
    const rules = stamp(skillLine({ ...base, source: 'rules', why: 'rules' }, 'did'));
    assert.deepEqual(correctionCase('hunt', rules, { Target: 'pig' }).by, 'rules');
    assert.ok(isJobSpec({ kind: 'huntFood', goal: 8 }) && isJobSpec({ kind: 'gatherSkill', target: 'wool', goal: 3, chest: 1 }) && isJobSpec({ kind: 'place', item: 'bed' }));
    assert.ok(!isJobSpec({ kind: 'gatherSkill', target: 'stone', goal: 3 }) && !isJobSpec({ kind: 'place', item: 'anvil' }) && !isJobSpec({ kind: 'huntFood', goal: 0 }));
});

test('an item a collect cannot pick up is left out of Drops from then on (no stuck run on an unreachable drop)', async () => {
    const d = deps();
    const stuckLog = { id: 50, item: 'oak_log', position: { x: 2, y: 66, z: 0 } };
    const w = gatherWorld({ logList: trunk(3) });
    w.ground = () => [stuckLog];
    const j = job<'gatherSkill'>({ kind: 'gatherSkill', target: 'logs', goal: 4 });
    await gatherSkillStep(j, w, d, live());
    assert.deepEqual([w.calls, (j.progress as { skip: number[] }).skip], [['collect'], [50]]);
    await gatherSkillStep(j, w, d, live());
    assert.deepEqual(w.calls, ['collect', 'fell 3,0 4']);
    assert.match(d.lines[1]!.line.state, /\nDrops 0 none none\n/);
});
