import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { JobStack, Director, decide, directorState, nextActivity, ACTIVITIES, QUESTIONS, armedOf, armorPoints, dangerOf, jobView } from '../src/agent/laya/director.js';

const calm = { job: null, paused: null, health: 20, food: 20, armed: 'sword', armor: 0, hostiles: 0, nearest: null,
    light: 15, night: false, under: false, free: 20, home: 40, valuables: 0, foodItems: 3, danger: 'none', last: 'none' };
const mine = { kind: 'mine', item: 'iron_ore', left: 6 };
const s = x => ({ ...calm, ...x });

test('answers are the spec words in its order', () => {
    assert.deepEqual(ACTIVITIES, ['continue', 'defend', 'flee', 'eat', 'heal', 'unload', 'resume', 'idle']);
    assert.deepEqual(QUESTIONS.Activity.criteria, ACTIVITIES);
});

test('directorState: the spec lines in order', () => {
    const text = directorState(s({ job: mine, paused: 'farm', health: 14.4, food: 17, armor: 7, hostiles: 2,
        nearest: { kind: 'zombie', dist: 5 }, light: 7, night: true, under: true, free: 10, home: 140, valuables: 7, foodItems: 4, danger: 'fall', last: 'interrupted' }));
    assert.equal(text, ['Director.',
        'Job mine iron_ore left 6',
        'Paused farm',
        'Health 14 Food 17 Armed sword Armor 7',
        'Hostiles 2 Nearest zombie 5',
        'Player none attacked no by none none',
        'Light 7 Night yes Under yes',
        'Pack 10 Home 99 Valuables 7',
        'Food items 4',
        'Danger fall',
        'Last interrupted'].join('\n'));
    const idle = directorState(calm).split('\n');
    assert.equal(idle[1], 'Job none none left 0');
    assert.equal(idle[2], 'Paused none');
    assert.equal(idle[4], 'Hostiles 0 Nearest none none');
    assert.equal(directorState(s({ hostiles: 1, nearest: { kind: 'witch', dist: 30 } })).split('\n')[4], 'Hostiles 1 Nearest other 16');
    assert.equal(directorState(s({ job: { kind: 'farm', item: 'any', left: 'any' } })).split('\n')[1], 'Job farm any left any');
    // v1.2: the Player line; strays and bogged are skeletons
    const pl = x => directorState(s(x)).split('\n')[5];
    assert.equal(pl({ player: { name: 'ChrisJoyce911', attacked: true, by: 'husk', dist: 12.4 } }), 'Player chrisjoyce911 attacked yes by other 12');
    assert.equal(pl({ player: { name: 'tester', attacked: false, by: 'zombie', dist: 3 } }), 'Player tester attacked no by none 3');
    assert.equal(pl({ player: { name: 'tester', attacked: false, dist: 30 } }), 'Player none attacked no by none none', 'beyond 24: none');
    assert.equal(pl({ player: { name: 'tester', attacked: true, by: 'stray', dist: 0 } }), 'Player tester attacked yes by skeleton 0');
    assert.equal(directorState(s({ hostiles: 1, nearest: { kind: 'bogged', dist: 9 } })).split('\n')[4], 'Hostiles 1 Nearest skeleton 9');
    // prompt v1 (a model trained on v1.1 data): no Player line
    assert.equal(directorState(calm, 'v1').split('\n').length, 10);
});

test('decide: v1.2 flee-ranged and defend-player', () => {
    const sk = d => ({ hostiles: 1, nearest: { kind: 'skeleton', dist: d } });
    assert.deepEqual(decide(s({ ...sk(14), health: 6, foodItems: 0 })), { activity: 'flee', rule: 'flee-ranged' });
    assert.deepEqual(decide(s({ hostiles: 1, nearest: { kind: 'stray', dist: 12 }, health: 5, foodItems: 0 })), { activity: 'flee', rule: 'flee-ranged' });
    assert.deepEqual(decide(s({ ...sk(14), health: 6, foodItems: 2 })), { activity: 'heal', rule: 'heal' }, 'with food: heal');
    const hit = { name: 'tester', attacked: true, by: 'zombie', dist: 12 };
    assert.deepEqual(decide(s({ player: hit, job: mine })), { activity: 'defend', rule: 'defend-player' });
    assert.deepEqual(decide(s({ player: hit, health: 5 })), { activity: 'defend', rule: 'defend-player' }, 'hurt but nothing near: still defends');
    assert.deepEqual(decide(s({ player: hit, food: 6 })), { activity: 'eat', rule: 'eat-hungry' }, 'hungry with food: eats first');
    assert.deepEqual(decide(s({ player: { ...hit, dist: 25 } })), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decide(s({ player: { ...hit, attacked: false, by: 'none' } })), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decide(s({ player: hit, hostiles: 1, nearest: { kind: 'zombie', dist: 7 }, health: 6 })), { activity: 'flee', rule: 'flee-low' }, 'its own flee first');
});

test('nextActivity: a prompt v1 model never overrides a v1.2 rule it cannot see', async () => {
    const asked = [];
    const client = { decide: async (task, text) => { asked.push(text); return { answers: { Activity: { top: 'idle', topProbability: 0.99, confident: true } } }; } };
    const hit = { name: 'tester', attacked: true, by: 'zombie', dist: 12 };
    let d = await nextActivity(s({ player: hit }), { client, task: { prompt: 'v1' } });
    assert.deepEqual([d.activity, d.source, d.rule], ['defend', 'rules', 'defend-player']);
    assert.equal(asked.length, 0);
    d = await nextActivity(s({}), { client, task: { prompt: 'v1' } });
    assert.equal(d.source, 'model');
    assert.ok(!/Player/.test(asked[0]), 'v1 text has no Player line');
    d = await nextActivity(s({ player: hit }), { client, task: { prompt: 'v1.2' } });
    assert.equal(d.source, 'model', 'a v1.2 model sees the line and decides');
    assert.match(asked[1], /\nPlayer tester attacked yes by zombie 12\n/);
});

test('decide: the spec v1.1 rules in priority order, with laya-go rule names', () => {
    const z = d => ({ hostiles: 1, nearest: { kind: 'zombie', dist: d } });
    for (const d of ['fluid', 'fire', 'drowning']) assert.deepEqual(decide(s({ danger: d, ...z(3) })), { activity: 'flee', rule: 'flee-danger' });
    assert.notEqual(decide(s({ danger: 'fall' })).activity, 'flee');
    assert.deepEqual(decide(s({ ...z(4), health: 6 })), { activity: 'flee', rule: 'flee-hostile' });
    assert.deepEqual(decide(s({ ...z(4), health: 10, armed: 'none' })), { activity: 'flee', rule: 'flee-hostile' });
    assert.deepEqual(decide(s({ hostiles: 1, nearest: { kind: 'creeper', dist: 3 } })), { activity: 'flee', rule: 'flee-creeper' });
    // v1.1: within 8 at health 6 or less: flee
    assert.deepEqual(decide(s({ ...z(7), health: 6 })), { activity: 'flee', rule: 'flee-low' });
    assert.deepEqual(decide(s({ ...z(4), health: 10 })), { activity: 'defend', rule: 'defend' });
    assert.deepEqual(decide(s({ ...z(8) })), { activity: 'defend', rule: 'defend' });
    assert.deepEqual(decide(s({ health: 8, job: mine })), { activity: 'heal', rule: 'heal' });
    assert.deepEqual(decide(s({ ...z(9), health: 8 })), { activity: 'heal', rule: 'heal' });
    assert.deepEqual(decide(s({ food: 6, job: mine })), { activity: 'eat', rule: 'eat-hungry' });
    assert.equal(decide(s({ food: 6, foodItems: 0, job: mine })).activity, 'continue');
    assert.deepEqual(decide(s({ free: 2, home: 300, job: mine })), { activity: 'unload', rule: 'unload-full' });
    assert.deepEqual(decide(s({ free: 6, home: 24, job: mine })), { activity: 'unload', rule: 'unload-near' });
    assert.deepEqual(decide(s({ free: 6, home: 24, paused: 'mine' })), { activity: 'unload', rule: 'unload-near' }, 'paused counts');
    assert.equal(decide(s({ free: 6, home: 25, job: mine })).activity, 'continue');
    assert.deepEqual(decide(s({ valuables: 4, hostiles: 2, nearest: { kind: 'zombie', dist: 12 }, job: mine })), { activity: 'unload', rule: 'unload-valuables' });
    assert.equal(decide(s({ free: 0, home: null, job: mine })).activity, 'continue', 'no home: no unload');
    // v1.1: never unload while idle (unload-home-chest's setup)
    assert.deepEqual(decide(s({ free: 4, home: 3 })), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decide(s({ paused: 'mine' })), { activity: 'resume', rule: 'resume-paused' });
    assert.deepEqual(decide(s({ job: mine, last: 'interrupted' })), { activity: 'continue', rule: 'continue' });
    assert.deepEqual(decide(s({ job: mine, last: 'failed', paused: 'farm' })), { activity: 'resume', rule: 'resume-failed' });
    assert.deepEqual(decide(s({ job: mine, last: 'blocked' })), { activity: 'idle', rule: 'idle-failed' });
    assert.deepEqual(decide(s({ job: mine, last: 'blocked', food: 17, health: 19 })), { activity: 'idle', rule: 'idle-failed' }, 'eat-idle only with nothing to do');
    assert.deepEqual(decide(calm), { activity: 'idle', rule: 'idle' });
    assert.deepEqual(decide(s({ food: 17, health: 19 })), { activity: 'eat', rule: 'eat-idle' });
});

test('golden: the director request matches laya-go v1_sample_request.json byte for byte', () => {
    const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-director-v1/request.json', import.meta.url), 'utf8'));
    // laya-go's sample: mining iron underground (6 left), a zombie 6 off, pack nearly full, home 18
    const st = new JobStack();
    st.start('layaMine', ['iron', 9], { remaining: () => 6 });
    const text = directorState({ job: st.running(), paused: st.pausedKind(), health: 14, food: 12, armed: 'sword', armor: 8,
        hostiles: 2, nearest: { kind: 'zombie', dist: 6 }, light: 4, night: false, under: true, free: 5, home: 18, valuables: 3,
        foodItems: 4, danger: 'none', last: 'none' }, 'v1');
    assert.equal(text, golden.state);
    assert.equal(JSON.stringify({ questions: QUESTIONS, state: text }), JSON.stringify(golden));
    assert.equal(QUESTIONS.Activity.instructions, 'What should I do now?');
    assert.deepEqual(Object.keys(QUESTIONS), ['Activity']);
    assert.ok(!ACTIVITIES.includes('unstuck'));
});

test('golden: the director request matches laya-go v1.2_sample_request.json byte for byte', () => {
    const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-director-v12/request.json', import.meta.url), 'utf8'));
    const st = new JobStack();
    st.start('layaMine', ['iron', 9], { remaining: () => 6 });
    const text = directorState({ job: st.running(), paused: st.pausedKind(), health: 14, food: 12, armed: 'sword', armor: 8,
        hostiles: 2, nearest: { kind: 'zombie', dist: 6 }, light: 4, night: false, under: true, free: 5, home: 18, valuables: 3,
        foodItems: 4, danger: 'none', last: 'none', player: { name: 'chrisjoyce911', attacked: true, by: 'zombie', dist: 12 } });
    assert.equal(text, golden.state);
    assert.equal(JSON.stringify({ questions: QUESTIONS, state: text }), JSON.stringify(golden));
});

test('situation helpers', () => {
    assert.equal(armedOf(['dirt', 'stone_axe', 'iron_sword']), 'sword');
    assert.equal(armedOf(['wooden_axe']), 'axe');
    assert.equal(armedOf(['bow']), 'other');
    assert.equal(armedOf(['wooden_pickaxe']), 'none');
    assert.equal(armorPoints(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']), 15);
    assert.equal(armorPoints(['leather_boots', 'turtle_helmet']), 3);
    assert.equal(dangerOf({ onFire: true, lavaNear: true }), 'fire');
    assert.equal(dangerOf({ headInWater: true, oxygen: 4 }), 'drowning');
    assert.equal(dangerOf({ headInWater: true, oxygen: 18 }), 'none');
    assert.equal(dangerOf({ lavaNear: true }), 'fluid');
    assert.equal(dangerOf({ falling: true }), 'fall');
});

test('job stack: start, pause under an activity, resume, replace, clear', () => {
    let t = 1000;
    const st = new JobStack(() => t);
    const job = st.start('layaMine', ['iron', 9], { remaining: () => 6 });
    assert.deepEqual(st.running(), mine);
    assert.equal(job.startedAt, 1000);
    const m = st.pause('laya_defending');
    assert.equal(st.depth, 2);
    assert.equal(st.running(), null);
    assert.equal(st.pausedKind(), 'mine');
    assert.equal(st.last, 'interrupted');
    st.done(m);
    assert.equal(st.pausedKind(), 'mine', 'still paused until resumed');
    st.resumed(job);
    assert.deepEqual(st.running(), mine);
    const b = st.start('layaFarm', ['wheat', 'any']);
    assert.deepEqual(st.items, [b], 'a new command replaces the top job');
    assert.deepEqual(jobView(b), { kind: 'farm', item: 'wheat', left: 'any' });
    st.ended(b, 'failed');
    assert.equal(st.last, 'failed');
    st.start('layaCraft', ['torch', 4]);
    assert.equal(st.last, 'none');
    st.replaceTop();
    assert.equal(st.depth, 0);
    st.start('layaMine', ['coal', 4]);
    st.clear();
    assert.equal(st.job(), null);
    assert.equal(st.pause('heal'), null, 'no job: nothing to pause');
});

test('nextActivity: rules, or a confident model', async () => {
    let d = await nextActivity(s({ job: mine }));
    assert.equal(d.activity, 'continue');
    assert.equal(d.source, 'rules');
    assert.match(d.state, /^Director\.\nJob mine iron_ore left 6/);
    const client = { decide: async (task, text, q) => {
        assert.equal(task, 'director'); assert.deepEqual(q, QUESTIONS);
        return { answers: { Activity: { top: 'unload', topProbability: 0.9, confident: true } } };
    } };
    d = await nextActivity(s({ job: mine }), { client, task: {} });
    assert.deepEqual([d.activity, d.source, d.p], ['unload', 'model', 0.9]);
    const unsure = { decide: async () => ({ answers: { Activity: { top: 'idle', topProbability: 0.3, confident: false } } }) };
    d = await nextActivity(s({ job: mine }), { client: unsure, task: {} });
    assert.equal(d.source, 'rules');
});

test('Director: a mode pauses the job, resume after, heal pauses it, logs each decision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'director-'));
    const log = join(dir, 'laya-director.jsonl');
    let sit = { ...calm };
    let idle = false;
    const resumed = [], performed = [];
    const d = new Director({ read: () => sit, idle: () => idle, stepLog: log, now: () => 0,
        resume: async job => { resumed.push(job.name); d.stack.resumed(job); },
        perform: async a => { performed.push([a, d.stack.pausedKind()]); } });
    const flush = () => new Promise(r => setTimeout(r, 5));
    const job = d.stack.start('layaMine', ['iron', 9]);
    assert.equal((await d.tick()).activity, 'continue');
    const m = d.stack.pause('laya_defending');
    sit = { ...calm, hostiles: 1, nearest: { kind: 'zombie', dist: 3 } };
    assert.equal((await d.tick()).activity, 'defend');
    d.stack.done(m);
    sit = { ...calm }; idle = true;
    assert.equal((await d.tick('mode-done')).activity, 'resume');
    await flush();
    assert.deepEqual(resumed, ['layaMine']);
    assert.equal(job.state, 'running');
    idle = false;
    sit = { ...calm, health: 7 };
    assert.equal((await d.tick()).activity, 'heal');
    await flush();
    assert.deepEqual(performed[0], ['heal', 'mine'], 'the job is paused under heal');
    const lines = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    const ours = lines.filter(l => l.event === 'tick' || l.event === 'mode-done');
    assert.deepEqual(ours.map(l => l.answer), ['continue', 'defend', 'resume', 'heal']);
    assert.equal(ours[2].event, 'mode-done');
    assert.ok(lines.some(l => l.event === 'resume-done'), 'a decision after the resume ends');
    assert.equal(ours[2].source, 'rules');
    assert.match(lines[0].state, /^Director\./);
});

test('itemWord: laya-go director item words', async () => {
    const { itemWord } = await import('../src/agent/laya/director.js');
    assert.equal(itemWord('mine', 'iron'), 'iron_ore');
    assert.equal(itemWord('mine', 'lapis'), 'lapis_ore');
    assert.equal(itemWord('farm', 'any'), 'none');
    assert.equal(itemWord('farm', 'wheat'), 'wheat');
    assert.equal(itemWord('craft', 'stone_pickaxe'), 'stone_pickaxe');
    assert.equal(itemWord('follow', null), 'none');
});

// parseDirector reads a director state back to a situation (job and paused as
// directorState takes them); v1.2 has the Player line at index 5.
function parseDirector(text) {
    let L = text.split('\n').map(l => l.split(' '));
    let player = null;
    if (L[5][0] === 'Player') {
        const P = L[5];
        if (P[1] !== 'none') player = { name: P[1], attacked: P[3] === 'yes', by: P[5], dist: Number(P[6]) };
        L = [...L.slice(0, 5), ...L.slice(6)];
    }
    const [, kind, item, , left] = L[1];
    const n = x => Number(x);
    return {
        job: kind === 'none' ? null : { kind, item, left: left === 'any' ? 'any' : n(left) },
        paused: L[2][1] === 'none' ? null : L[2][1],
        health: n(L[3][1]), food: n(L[3][3]), armed: L[3][5], armor: n(L[3][7]),
        hostiles: n(L[4][1]), nearest: L[4][3] === 'none' ? null : { kind: L[4][3], dist: n(L[4][4]) },
        light: n(L[5][1]), night: L[5][3] === 'yes', under: L[5][5] === 'yes',
        free: n(L[6][1]), home: L[6][3] === 'none' ? null : n(L[6][3]), valuables: n(L[6][5]),
        foodItems: n(L[7][2]), danger: L[8][1], last: L[9][1], player,
    };
}

test('prompt v1 state round trip on laya-go v1.1 situations (db494eb); v1.2 rules differ only by flee-ranged', () => {
    const rows = readFileSync(new URL('./fixtures/laya-director-v1/decisions.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 1000);
    for (const r of rows) {
        const s = parseDirector(r.state);
        assert.equal(directorState(s, 'v1'), r.state, 'state round trip');
        const d = decide(s);
        if (d.rule !== 'flee-ranged') assert.deepEqual(d, { activity: r.answer, rule: r.rule }, r.state);
    }
});

test('rules and state agree with laya-go v1.2 on 1000 generated situations (94b2117)', () => {
    const rows = readFileSync(new URL('./fixtures/laya-director-v12/decisions.jsonl', import.meta.url), 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(rows.length, 1000);
    const rules = new Set();
    for (const r of rows) {
        const s = parseDirector(r.state);
        assert.equal(directorState(s), r.state, 'state round trip');
        assert.deepEqual(decide(s), { activity: r.answer, rule: r.rule }, r.state);
        rules.add(r.rule);
    }
    assert.equal(rules.size, 18, 'every rule is exercised');
});
