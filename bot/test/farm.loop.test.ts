// 5.3 the farm loop (a port of test/laya_farm.test.js's farmWithLaya tests on the new FarmRun): harvest then plant,
// the starter kit and missing items, low confidence and no answers, the time limit and an interrupt, no hoe, no
// water (say so and stop; walk to water once; a pond from a bucket), the wait limit, the count goal across resumes,
// unloading, the crop's seed, v2's rules when unsure, bans and max_bad; and the runner (task off, progress, abort).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_WATER, type FarmView } from '../src/models/farm/index.js';
import { farmSummary, farmRunner, FarmRun, FARM_OFF, type FarmWorld } from '../src/jobs/farm.js';
import { FARM_DEFAULTS, farmOf, type FarmSettings, type JobDeps } from '../src/jobs/deps.js';
import type { JobState } from '../src/types/index.js';
import { reply, runFarm, sample, setup, setupV2, plateau, Y0, worldOf } from './farmfake.js';

test('loop: harvest, then plant, vetoes refused', async () => {
    const { deps, calls, bot } = setup([reply('harvest', 'W2 N1', 'none'), reply('plant', 'E1 N2', 'carrot'), reply('till', 'E0 S0', 'hoe'), reply('wait', 'none', 'none')]);
    const c = await runFarm(bot, 60000, deps);
    assert.deepEqual(calls.act, [['harvest', 'W2 N1', 'none'], ['plant', 'E1 N2', 'carrot']]);
    assert.deepEqual(c.vetoes, { 'not-tillable': 1 });
    assert.deepEqual(calls.craft, []);
    assert.match(farmSummary(c), /did harvest 1, plant 1/);
});

test('loop: crafts the starter kit and missing items, then carries on', async () => {
    const bare = { ...sample(), carry: [] };
    const { deps, calls, bot } = setup([reply('water', 'E1 N2', 'none'), reply('bone_meal', 'W1 N1', 'bone_meal')], { situation: bare });
    await runFarm(bot, 60000, deps);
    assert.deepEqual(calls.craft.slice(0, 2), [['hoe', 1], ['wheat_seeds', 4]], 'starter kit');
    assert.deepEqual(calls.craft[2], ['water_bucket', 1], 'water needs a bucket');
    assert.deepEqual(calls.craft[3], ['bone_meal', 1]);
});

test('loop: low confidence waits, no answers stop', async () => {
    const { deps, calls, bot } = setup([reply('harvest', 'W2 N1', 'none', 0.3), null, null, null]);
    const c = await runFarm(bot, 60000, deps);
    assert.deepEqual(calls.act, []);
    assert.equal(c.misses, 2);
    assert.equal(calls.asked, 3, 'stopped after max_misses');
    assert.equal(c.reason, 'no answer');
});

test('loop: stops at the time limit and on interrupt', async () => {
    const { deps, calls, bot } = setup(Array(50).fill(reply('wait', 'none', 'none')));
    await runFarm(bot, 100, deps);
    assert.ok(calls.asked <= 3, `asked ${calls.asked}`);
    const stopped = setup([reply('harvest', 'W2 N1', 'none')]);
    await runFarm({ interrupt_code: true }, 60000, stopped.deps);
    assert.equal(stopped.calls.asked, 0);
});

test('loop: no hoe to be had stops farming instead of waiting', async () => {
    const bare = { ...sample(), carry: [] };
    const { deps, calls, bot } = setup(Array(20).fill(reply('wait', 'none', 'none')), { situation: bare, craftOk: false });
    const said: string[] = [];
    deps.say = m => said.push(m);
    const c = await runFarm(bot, 60000, deps);
    assert.deepEqual(calls.craft, [['hoe', 1]]);
    assert.equal(calls.asked, 0);
    assert.equal(c.reason, 'no hoe');
    assert.deepEqual(said, ["I couldn't get a hoe to farm with."]);
});

test('trial plateau, no water near: says so and stops (never waits forever)', async () => {
    const { deps, calls, bot, said } = setupV2(Array(80).fill(reply('wait', 'none', 'none', 1)),
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]) });
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.equal(calls.asked, 1);
    assert.deepEqual(said, [NO_WATER]);
    assert.equal(c.reason, 'no water');
});

test('trial plateau with v1 too: stops instead of 73 waits', async () => {
    const { deps, calls, bot, said } = setupV2(Array(80).fill(reply('wait', 'none', 'none', 1)),
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]), task: { prompt: 'v1' } });
    await runFarm(bot, 180000, deps);
    assert.equal(calls.asked, 1);
    assert.deepEqual(said, [NO_WATER]);
});

test('find_water: walks to water and carries on, once', async () => {
    const { deps, calls, bot, said } = setupV2([reply('find_water', 'none', 'none'), reply('find_water', 'none', 'none')],
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]), water: { x: 30, y: 63, z: 4 } });
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.walked, [{ x: 30, y: 63, z: 4 }]);
    assert.equal(c.water_trips, 1);
    assert.deepEqual(said, [NO_WATER], 'still dry after walking there: stops');
});

test('plateau with a water bucket: a wait becomes a pond', async () => {
    const { deps, calls, bot } = setupV2([reply('wait', 'none', 'none')],
        { situation: plateau([{ item: 'hoe', count: 1 }, { item: 'water_bucket', count: 1 }, { item: 'wheat_seeds', count: 3 }]), task: { max_steps_open: 1 } });
    await runFarm(bot, { crop: 'any' }, deps);
    assert.equal(calls.act[0]![0], 'pond');
    assert.equal(calls.act[0]![2], 'water_bucket');
});

test('wait limit: stops after waits with nothing growing, not while crops grow', async () => {
    const grass = ['GGGGWGGGG', ...Array<string>(8).fill('GGGGGGGGG')];
    const s0: FarmView = { grid: grass.map(r => [...r]) as FarmView['grid'], ys: grass.map(() => Array<number>(9).fill(Y0)),
        carry: [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }], animals: [] };
    const idle = setupV2(Array(50).fill(reply('wait', 'none', 'none')), { situation: s0 });
    const c = await runFarm(idle.bot, { crop: 'any' }, idle.deps);
    assert.equal(idle.calls.asked, 3);
    assert.equal(c.reason, 'nothing to do');
    assert.deepEqual(idle.said, ['Nothing to farm here and nothing growing; stopping.']);
    const busy = setupV2(Array(10).fill(reply('wait', 'none', 'none')), { task: { max_steps_open: 10 } });
    const c2 = await runFarm(busy.bot, { crop: 'any' }, busy.deps);
    assert.equal(busy.calls.asked, 10, 'the golden farm has growing crops: keeps waiting');
    assert.equal(c2.reason, 'max steps');
});

test('count goal: stops once enough is harvested, across resumes', async () => {
    const progress = { harvested: 0 };
    const a = setupV2(Array(10).fill(reply('harvest', 'W2 N1', 'none')));
    const c = await runFarm(a.bot, { crop: 'wheat', count: 10, progress }, a.deps);
    assert.equal(a.calls.act.length, 2);
    assert.equal(c.harvested, 12);
    assert.match(a.said.at(-1)!, /Harvested 12 wheat/);
    const b = setupV2(Array(10).fill(reply('harvest', 'W2 N1', 'none')));
    progress.harvested = 6;
    await runFarm(b.bot, { crop: 'wheat', count: 10, progress }, b.deps);
    assert.equal(b.calls.act.length, 1, 'a resume counts what was harvested before');
});

test('unload: full pack goes home, keeps tools and seeds, walks back', async () => {
    let free = 0;
    const u = setupV2([reply('wait', 'none', 'none'), reply('harvest', 'W2 N1', 'none')], {
        home: { x: 10, y: Y0 + 1, z: 10 }, free: () => free,
        inv: { iron_hoe: 1, wheat: 60, wheat_seeds: 40, bread: 2, bucket: 1, dirt: 5 }, task: { max_steps_open: 2 },
    });
    u.deps.pack!.goHome = async () => { u.calls.home++; free = 20; return true; };
    await runFarm(u.bot, { crop: 'any' }, u.deps);
    assert.equal(u.calls.home, 1);
    assert.deepEqual(u.calls.deposited[0], [{ name: 'wheat', count: 60 }, { name: 'wheat_seeds', count: 24 }, { name: 'dirt', count: 5 }]);
    assert.deepEqual(u.calls.walked, [{ x: 0, y: Y0 + 1, z: 0 }], 'walked back to the farm');
    assert.deepEqual(u.calls.act, [['harvest', 'W2 N1', 'none']]);
});

test('unload: the model when sure; never without a home chest (warned once)', async () => {
    const yes = (r: ReturnType<typeof reply>) => ({ ...r, answers: { ...r.answers, Unload: { type: 'noul' as const, probability: 0.9, top: 'true' as const, topProbability: 0.9, confident: true } } });
    const m = setupV2([yes(reply('wait', 'none', 'none'))], { home: { x: 5, y: 65, z: 5 }, inv: { wheat: 5 }, task: { max_steps_open: 1 } });
    await runFarm(m.bot, { crop: 'any' }, m.deps);
    assert.equal(m.calls.home, 1);
    const n = setupV2([yes(reply('harvest', 'W2 N1', 'none'))], { free: () => 0, task: { max_steps_open: 3 } });
    await runFarm(n.bot, { crop: 'any' }, n.deps);
    assert.equal(n.calls.home, 0);
    assert.match(n.said[0]!, /pack is full/);
    assert.equal(n.said.filter(t => /pack is full/.test(t)).length, 1, 'once');
});

test('a crop asked for: plants its seed', async () => {
    const s0 = { ...sample(), carry: [...sample().carry] };
    const { deps, calls, bot } = setupV2([reply('plant', 'E1 N2', 'wheat_seeds')], { situation: s0, task: { max_steps_open: 1 } });
    await runFarm(bot, { crop: 'carrots' }, deps);
    assert.deepEqual(calls.act, [['plant', 'E1 N2', 'carrot']]);
});

test('v2 unsure: the rules decide', async () => {
    const { deps, calls, bot } = setupV2([reply('wait', 'none', 'none', 0.2)], { task: { max_steps_open: 1 } });
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.deepEqual(calls.act, [['harvest', 'W2 N1', 'none']]);
    assert.equal(c.rules, 1);
});

test('failed steps: banned on that cell, then stops after max_bad in a row', async () => {
    const carry = [{ item: 'hoe' as const, count: 1 }, { item: 'water_bucket' as const, count: 1 }, { item: 'wheat_seeds' as const, count: 3 }];
    const { deps, calls, bot, said } = setupV2(Array(40).fill(reply('pond', 'W1 N1', 'water_bucket')),
        { situation: plateau(carry), task: { max_steps_open: 40 } });
    deps.act = async (action, target, item) => { calls.act.push([action, target, item]); return false; };
    const c = await runFarm(bot, { crop: 'any' }, deps);
    assert.equal(c.reason, 'stuck');
    assert.equal(calls.act.filter(([a, t]) => a === 'pond' && t === 'W1 N1').length, 1, 'the failed cell is not tried again');
    assert.equal(calls.act.length, 6, 'max_bad failed steps in a row');
    assert.equal(new Set(calls.act.map(([, t]) => t)).size, 6, 'each on another cell');
    assert.match(said.at(-1)!, /keep failing to pond/);
});

test('vetoed steps: banned, the rules answer instead', async () => {
    const { deps, calls, bot } = setup([reply('till', 'E0 S0', 'hoe'), reply('till', 'E0 S0', 'hoe'), reply('till', 'E0 S0', 'hoe')]);
    const c = await runFarm(bot, 60000, deps);
    assert.deepEqual(c.vetoes, { 'not-tillable': 1 }, 'vetoed once, then banned');
    assert.equal(calls.act.length, 2, 'the rules act instead');
});

// ---- the runner and the job

const settings = (over: Partial<FarmSettings> = {}): FarmSettings => ({ ...FARM_DEFAULTS, enabled: true, model: null, ...over });

function jobDeps(over: Partial<JobDeps> = {}): JobDeps {
    return {
        act: () => null, places: { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} },
        follow: () => { throw new Error('no follow'); }, followLog: () => {}, note: () => {}, ...over,
    };
}

test('runner: the farm task off ends at once and says so', async () => {
    const job: JobState = { id: 'j', spec: { kind: 'farm', crop: 'wheat', goal: { count: 3 } }, origin: 'player', progress: {}, status: 'running', startedAt: 0 };
    const r = farmRunner(job as never, jobDeps({ farm: () => settings({ enabled: false }) }));
    assert.deepEqual(await r.step({} as never, new AbortController().signal),
        { how: 'end', end: { how: 'failed', reason: 'the farm task is off' }, say: FARM_OFF });
    const r2 = farmRunner(job as never, jobDeps());
    assert.equal((await r2.step({} as never, new AbortController().signal)).how, 'end', 'no farm settings: off');
});

test('runner: left() counts down the harvest kept in the job\'s progress; not in game ends', async () => {
    const job: JobState = { id: 'j', spec: { kind: 'farm', crop: 'any', goal: { count: 10 } }, origin: 'player', progress: { harvested: 4 }, status: 'running', startedAt: 0 };
    const r = farmRunner(job as never, jobDeps({ farm: () => settings() }));
    assert.equal(r.left!(), 6);
    const end = await r.step({} as never, new AbortController().signal);
    assert.equal(end.how, 'end');
    const forever = farmRunner({ ...job, spec: { kind: 'farm', crop: 'any', goal: 'forever' } } as never, jobDeps({ farm: () => settings() }));
    assert.equal(forever.left!(), null);
});

test('an aborted act counts as neither done nor failed (no ban); the harvest so far counts; a resume goes on', async () => {
    const progress = { harvested: 0 };
    const ac = new AbortController();
    const { deps, calls } = setupV2(Array(10).fill(reply('harvest', 'W2 N1', 'none')));
    const inner = deps.act;
    deps.act = async (a, t, i, s) => { const ok = await inner(a, t, i, s); ac.abort(); return ok; };
    const lines: unknown[] = [];
    const run = new FarmRun({
        crop: 'wheat', count: 20, progress,
        settings: () => settings({ prompt: 'v2', model: { decide: (task, st, q) => deps.client.decide(task, st, q) } }),
        world: () => worldOf(deps), log: l => lines.push(l), note: () => {}, chat: () => {}, checkpoint: () => {},
    });
    assert.deepEqual(await run.step(ac.signal), { how: 'more' });
    assert.equal(calls.act.length, 1);
    assert.equal(progress.harvested, 6, 'the harvest so far is kept');
    assert.equal(run.counters.failed, 0);
    assert.deepEqual(run.counters.done, {});
    assert.equal(lines.length, 0, 'no line for an interrupted act');
    run.close();
});

test('farmOf: the settings\' farm task, the served prompt wins, numbers in range', () => {
    const s = { decision_models: { tasks: { farm: { enabled: true, prompt: 'v2', wait_limit: 5, keep_seeds: 8, step_ms: -1, log_steps: false, max_steps_open: 30 } } } };
    const f = farmOf(s, null, undefined);
    assert.equal(f.enabled, true);
    assert.equal(f.prompt, 'v2');
    assert.equal(f.wait_limit, 5);
    assert.equal(f.keep_seeds, 8);
    assert.equal(f.step_ms, FARM_DEFAULTS.step_ms, 'a negative number is ignored');
    assert.equal(f.log_steps, false);
    assert.equal(f.max_steps_open, 30);
    assert.equal(farmOf(s, null, 'v1').prompt, 'v1', 'the served prompt wins');
    assert.equal(farmOf(s, null, 'v9').prompt, 'v1', 'an unknown served prompt: the default');
    assert.equal(farmOf({}, null, undefined).enabled, false, 'off unless enabled');
    assert.equal(farmOf({}, null, undefined).max_steps_open, Infinity);
});

test('FarmWorld from a real situation: the fake read is the golden', () => {
    const { deps } = setup([]);
    const w: FarmWorld = worldOf(deps);
    assert.deepEqual(w.read(), sample());
});

test('a done step asked again on the very same state did nothing: failed and banned (5.3 live loop)', async () => {
    const { deps, calls, bot } = setup(Array(6).fill(reply('plant', 'E1 N2', 'wheat_seeds')));
    const c = await runFarm(bot, 60000, deps);
    assert.equal(calls.act.filter(([a, t]) => a === 'plant' && t === 'E1 N2').length, 1, 'planted once; the same answer on the same state is not done again');
    assert.equal(c.failed, 1);
    assert.equal(c.done.plant, 1);
    assert.ok(calls.act.slice(1).every(([a]) => a === 'harvest'), 'then banned: the rules answer');
});

test('drops picked up a step after the harvest still count toward the goal (5.3 live)', async () => {
    const inv: Record<string, number> = { wheat: 2 };
    const { deps, calls, bot, said } = setupV2(Array(10).fill(reply('wait', 'none', 'none')), { task: { max_steps_open: 10 } });
    deps.inventory = () => ({ ...inv });
    let step = 0;
    deps.read = (() => { const r = deps.read; return () => { if (++step === 3) inv.wheat = 7; return r(); }; })();
    const c = await runFarm(bot, { crop: 'wheat', count: 5 }, deps);
    assert.equal(c.reason, 'count reached');
    assert.equal(c.harvested, 5, 'the 2 carried at the start are not harvested');
    assert.match(said.at(-1)!, /Harvested 5 wheat/);
    assert.deepEqual(calls.act, []);
});

test('unload: never when nothing would go in (tools and kept seeds fill the pack; 5.3 live loop)', async () => {
    const u = setupV2(Array(3).fill(reply('wait', 'none', 'none')), {
        home: { x: 2, y: Y0 + 1, z: 2 }, free: () => 5, inv: { iron_hoe: 1, wheat_seeds: 16, iron_shovel: 28 }, task: { max_steps_open: 3 },
    });
    await runFarm(u.bot, { crop: 'any' }, u.deps);
    assert.equal(u.calls.home, 0, 'the rule says unload (free 5, home 2) but nothing would go in');
});

test('produce the craft job takes from the home chest is not counted as harvested (5.3 review)', async () => {
    // breed cow wheat with no wheat carried: getItem('wheat') → the craft job takes wheat from the home chest
    const inv: Record<string, number> = {};
    const { deps, calls, bot } = setupV2([reply('breed', 'cow', 'wheat'), ...Array(3).fill(reply('wait', 'none', 'none'))], { task: { max_steps_open: 4 } });
    deps.inventory = () => ({ ...inv });
    const craft = deps.craft;
    deps.craft = async (item, n) => { inv[item] = (inv[item] ?? 0) + n; return craft(item, n); };
    const c = await runFarm(bot, { crop: 'wheat', count: 1 }, deps);
    assert.ok(calls.craft.some(([i]) => i === 'wheat'), 'wheat was fetched');
    assert.equal(c.harvested, 0, 'taken from the chest, not harvested');
    assert.notEqual(c.reason, 'count reached');
});

test('a full pack of kept things is said once (5.3 review)', async () => {
    const u = setupV2(Array(3).fill(reply('wait', 'none', 'none')), {
        home: { x: 2, y: Y0 + 1, z: 2 }, free: () => 0, inv: { iron_hoe: 1, wheat_seeds: 16, iron_shovel: 28 }, task: { max_steps_open: 3 },
    });
    await runFarm(u.bot, { crop: 'any' }, u.deps);
    assert.equal(u.calls.home, 0);
    assert.equal(u.said.filter(m => /full of things I keep/.test(m)).length, 1);
});
