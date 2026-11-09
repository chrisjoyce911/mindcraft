import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { situation, state, questions, chooseWeapons, nearMobs, KINDS } from '../src/agent/laya/defend_state.js';
import { LayaDefender, safety, summary } from '../src/agent/laya/defend.js';
import { taskSettings } from '../src/models/laya.js';
import { setSettings } from '../src/agent/settings.js';
import rootSettings from '../settings.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-defend-v1/request.json', import.meta.url), 'utf8'));
const item = (name, count = 1) => ({ name, count });

function fakeBot({ health = 14, food = 12, items = [], slots = [], isDay = false, x = 0.5, z = 0.5 } = {}) {
    return { health, food, time: { isDay }, entity: { position: { x, y: 64, z } }, inventory: { items: () => items, slots } };
}

test('golden v1 state and questions: matches laya-go byte for byte', () => {
    const slots = [];
    slots[5] = item('chainmail_helmet');
    slots[6] = item('iron_chestplate');
    slots[45] = item('shield');
    const bot = fakeBot({ items: [item('bow'), item('iron_sword'), item('arrow', 8), item('arrow', 4), item('golden_apple'), item('dirt', 64)], slots });
    const mobs = [
        { kind: 'skeleton', x: -12, z: 4 },
        { kind: 'zombie', x: 2, z: -2, health: 20 },
        { kind: 'zombie', x: 30, z: 0 }, // out of range
        { kind: 'cow', x: 1, z: 1 }, // not a defend mob
    ];
    const s = situation(bot, mobs, false);
    assert.equal(state(s), golden.state);
    assert.deepEqual(JSON.parse(JSON.stringify(questions(s))), golden.questions);
});

test('mobs: nearest first, ties by kind then z then x, at most four, health clamped', () => {
    const rel = nearMobs([
        { kind: 'zombie', x: 3, z: 0 }, { kind: 'creeper', x: 0, z: 3 }, { kind: 'creeper', x: 0, z: -3 },
        { kind: 'witch', x: 1, z: 1, health: 30 }, { kind: 'spider', x: 5, z: 5, health: 0.4 }, { kind: 'stray', x: 9, z: 9 },
    ], 0, 0);
    assert.deepEqual(rel.map(m => `${m.kind} ${m.dx} ${m.dz} ${m.health}`), ['witch 1 1 26', 'creeper 0 -3 20', 'creeper 0 3 20', 'zombie 3 0 20']);
    assert.equal(KINDS.cave_spider.health, 12);
});

test('weapons: at most three, the bow and the best melee, in laya-go order', () => {
    assert.deepEqual(chooseWeapons(['bow', 'wooden_sword', 'stone_axe', 'iron_sword', 'diamond_axe']), ['iron_sword', 'diamond_axe', 'bow']);
    assert.deepEqual(chooseWeapons(['stone_axe', 'wooden_sword']), ['wooden_sword', 'stone_axe']);
    assert.deepEqual(chooseWeapons([]), []);
});

const base = over => ({ health: 20, food: 20, armor: 0, night: true, playerNear: false, weapons: ['stone_sword', 'bow'], arrows: 5, shield: false, apples: 0, mobs: [], ...over });

test('safety: a close creeper is fled from unless strong and alone', () => {
    const s = base({ mobs: [{ kind: 'creeper', dx: 2, dz: 0, health: 20 }] });
    const v = safety(s, { action: 'fight', target: 'creeper 1', weapon: 'stone_sword' });
    assert.equal(v.ok, true);
    assert.equal(v.answer.action, 'flee');
    assert.equal(v.overridden, 'creeper');
    const strong = base({ armor: 20, weapons: ['iron_sword'], mobs: s.mobs });
    assert.equal(safety(strong, { action: 'fight', target: 'creeper 1', weapon: 'iron_sword' }).answer.action, 'fight');
    assert.equal(safety(s, { action: 'fight', target: 'creeper 1', weapon: 'bow' }).answer.action, 'fight'); // shooting is fine
});

test('safety: refusals', () => {
    const z = base({ mobs: [{ kind: 'zombie', dx: 1, dz: 1, health: 20 }] });
    assert.deepEqual(safety(z, { action: 'ignore', target: 'none', weapon: 'none' }), { ok: false, reason: 'ignore-threat' });
    assert.deepEqual(safety(z, { action: 'eat', target: 'none', weapon: 'none' }), { ok: false, reason: 'no-apple' });
    assert.deepEqual(safety(z, { action: 'fight', target: 'none', weapon: 'stone_sword' }), { ok: false, reason: 'no-target' });
    assert.deepEqual(safety({ ...z, arrows: 0 }, { action: 'fight', target: 'zombie 1', weapon: 'bow' }), { ok: false, reason: 'no-arrows' });
    const ok = safety(z, { action: 'fight', target: 'zombie 1', weapon: 'diamond_sword' }); // not carried: bare hand
    assert.equal(ok.ok, true);
    assert.equal(ok.answer.weapon, 'none');
    assert.equal(ok.answer.targetIndex, 0);
});

function reply(action, target, weapon, p = 0.9) {
    const choice = top => ({ type: 'choice', top, topProbability: p, confident: p >= 0.4, probabilities: { [top]: p } });
    return { model: 'fake', ms: 3, answers: { Action: choice(action), Target: choice(target), Weapon: choice(weapon),
        Danger: { type: 'noul', probability: 0.9, top: 'true', topProbability: 0.9, confident: true } } };
}

function setup(answers, { mobs = [{ kind: 'zombie', dx: 2, dz: 0, health: 20 }], over = {}, stepLog = null } = {}) {
    let t = 0, i = 0;
    const calls = [];
    const world = { mobs };
    const defender = new LayaDefender({
        client: { decide: async () => answers[Math.min(i++, answers.length - 1)] },
        task: { step_ms: 400, fallback_ms: 8000, quiet_ms: 3000, log_steps: !!stepLog },
        read: () => ({ situation: base({ mobs: world.mobs, ...over }), entities: world.mobs.map(m => `entity:${m.kind}`) }),
        act: Object.fromEntries(['fight', 'shield', 'backoff', 'flee', 'eat'].map(a => [a, async (e, w) => { calls.push([a, e, w]); if (a === 'fight') world.hits = (world.hits || 0) + 1; }])),
        interrupted: () => false,
        sleep: async ms => { t += ms; if (world.hits >= 2) world.mobs = []; },
        now: () => t,
        stepLog,
    });
    return { defender, calls, world, advance: ms => { t += ms; } };
}

test('engages until the mobs are gone, logging each step', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'laya-defend-'));
    const log = join(dir, 'laya-defend.jsonl');
    const { defender, calls } = setup([reply('fight', 'zombie 1', 'stone_sword')], { stepLog: log });
    assert.equal(defender.wantsToEngage(), true);
    assert.equal(await defender.engage(), 'calm');
    assert.deepEqual(calls, [['fight', 'entity:zombie', 'stone_sword'], ['fight', 'entity:zombie', 'stone_sword']]);
    const lines = readFileSync(log, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 2);
    assert.equal(lines[0].outcome, 'fight');
    assert.match(lines[0].state, /^Defend\.\n/);
    assert.match(summary(defender.counters), /1 engagements, asked 2, acted fight 2/);
});

test('falls back to the ordinary modes on no answer, low confidence or a veto', async () => {
    for (const [answers, reason] of [[[null], 'no-answer'], [[reply('fight', 'zombie 1', 'none', 0.2)], 'low-confidence'], [[reply('ignore', 'none', 'none')], 'veto']]) {
        const { defender, calls, advance } = setup(answers);
        assert.equal(await defender.engage(), 'fallback');
        assert.equal(defender.counters.fallbacks[reason], 1, reason);
        assert.equal(defender.inControl(), false);
        assert.equal(defender.wantsToEngage(), false);
        assert.deepEqual(calls, []);
        advance(8000);
        assert.equal(defender.inControl(), true);
        assert.equal(defender.wantsToEngage(), true);
    }
});

test('ignore ends the engagement and stays quiet a while', async () => {
    const { defender, advance } = setup([reply('ignore', 'none', 'none')], { mobs: [{ kind: 'skeleton', dx: 12, dz: 0, health: 20 }] });
    assert.equal(await defender.engage(), 'ignore');
    assert.equal(defender.wantsToEngage(), false);
    advance(3000);
    assert.equal(defender.wantsToEngage(), true);
});

test('creeper override flees instead of fighting; eat and backoff run', async () => {
    const c = setup([reply('fight', 'creeper 1', 'stone_sword'), reply('backoff', 'creeper 1', 'none')], { mobs: [{ kind: 'creeper', dx: 2, dz: 1, health: 20 }] });
    assert.equal(await c.defender.step(), 'flee');
    assert.equal(c.defender.counters.overrides, 1);
    assert.equal(await c.defender.step(), 'backoff');
    assert.deepEqual(c.calls, [['flee', 'entity:creeper', 'none'], ['backoff', 'entity:creeper', 'none']]);
    const e = setup([reply('eat', 'none', 'none')], { mobs: [{ kind: 'zombie', dx: 6, dz: 0, health: 20 }], over: { health: 5, apples: 1 } });
    assert.equal(await e.defender.step(), 'eat');
    assert.deepEqual(e.calls, [['eat', undefined, undefined]]);
});

test('spiders by day are calm', async () => {
    const { defender } = setup([reply('fight', 'spider 1', 'none')], { mobs: [{ kind: 'spider', dx: 2, dz: 0, health: 16 }], over: { night: false } });
    assert.equal(defender.wantsToEngage(), false);
    assert.equal(await defender.step(), 'calm');
});

test('off by default', () => {
    setSettings(rootSettings);
    assert.equal(rootSettings.decision_models.tasks.defend.enabled, false);
    assert.equal(rootSettings.decision_models.tasks.defend.model, 'defend-a');
    assert.equal(taskSettings('defend'), null);
});
