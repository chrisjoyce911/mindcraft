import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { followWithLaya, summary } from '../src/agent/laya/follow.js';
import { taskSettings } from '../src/models/laya.js';
import { setSettings } from '../src/agent/settings.js';
import rootSettings from '../settings.js';

const Y0 = 64;
const AIR = { name: 'air', boundingBox: 'empty' };
const STONE = { name: 'stone', boundingBox: 'block' };
const LAVA = { name: 'lava', boundingBox: 'empty' };

// A flat world at Y0, 30 × 9, with optional lava columns.
function world(lava = []) {
    const isLava = new Set(lava.map(([x, z]) => `${x},${z}`));
    return (x, y, z) => {
        if (x < 0 || x >= 30 || z < 0 || z >= 9) return null;
        if (y > Y0) return AIR;
        if (y === Y0 && isLava.has(`${x},${z}`)) return LAVA;
        return STONE;
    };
}

// answer builds a laya-client answer with a top move and probability.
function answer(move, p = 0.9) {
    return { model: 'fake', ms: 3, answers: {
        Move: { type: 'choice', top: move, topProbability: p, confident: p >= 0.4, probabilities: { [move]: p } },
        Hazard: { type: 'noul', top: 'false', probability: 0.1, topProbability: 0.9, confident: true },
    } };
}

// setup makes a fake bot at column (2, 4) and a player at (14, 4), and deps
// whose stepTo moves the bot. maxFallbacks ends the session.
function setup({ decide, blockAt = world(), stuck = false, maxFallbacks = 1, stepLog = null } = {}) {
    const bot = {
        entity: { position: { x: 2.5, y: Y0 + 1, z: 4.5 } },
        players: { chris: { entity: { position: { x: 14.5, y: Y0 + 1, z: 4.5 } } } },
        health: 20, interrupt_code: false,
    };
    const calls = { decide: 0, steps: [], fallbacks: 0, logs: [] };
    const deps = {
        client: { decide: async (...a) => { calls.decide++; return decide(...a); } },
        task: { step_ms: 0, fallback_ms: 0, log_steps: !!stepLog, stuck_ms: 1 },
        blockAt,
        stepTo: async (x, y, z) => {
            calls.steps.push([x, y, z]);
            if (stuck) return false;
            bot.entity.position = { x: x + 0.5, y, z: z + 0.5 };
            return true;
        },
        fallback: async () => { if (++calls.fallbacks >= maxFallbacks) bot.interrupt_code = true; },
        sleep: async () => { if (calls.decide === 0 || calls.steps.length > 50) bot.interrupt_code = true; },
        log: msg => calls.logs.push(msg),
        stepLog,
    };
    return { bot, deps, calls };
}

test('steps east to the player', async () => {
    const { bot, deps, calls } = setup({ decide: () => answer('E') });
    deps.sleep = async () => { bot.interrupt_code = true; }; // stop once arrived
    const { found, counters } = await followWithLaya(bot, 'chris', 3, deps);
    assert.ok(found);
    assert.equal(counters.stepped, 9); // from x = 2 to x = 11, within 3 of 14
    assert.deepEqual(calls.steps[0], [3, Y0 + 1, 4]);
    assert.equal(counters.arrivedTicks, 1);
    assert.match(calls.logs[0], /stepped 9/);
});

test('server down falls back', async () => {
    const { bot, deps, calls } = setup({ decide: () => null });
    const { counters } = await followWithLaya(bot, 'chris', 3, deps);
    assert.equal(counters.fallbacks['no-answer'], 1);
    assert.equal(calls.steps.length, 0);
});

test('low confidence falls back', async () => {
    const { bot, deps } = setup({ decide: () => answer('E', 0.2) });
    const { counters } = await followWithLaya(bot, 'chris', 3, deps);
    assert.equal(counters.fallbacks['low-confidence'], 1);
});

test('arrived waits without asking', async () => {
    const { bot, deps, calls } = setup({ decide: () => answer('E') });
    bot.entity.position = { x: 13.5, y: Y0 + 1, z: 4.5 };
    await followWithLaya(bot, 'chris', 3, deps);
    assert.equal(calls.decide, 0);
    assert.equal(calls.steps.length, 0);
});

test('a step onto lava is vetoed', async () => {
    const { bot, deps, calls } = setup({ decide: () => answer('E'), blockAt: world([[3, 4]]) });
    const { counters } = await followWithLaya(bot, 'chris', 3, deps);
    assert.equal(counters.fallbacks.veto, 1);
    assert.equal(counters.vetoes.harmful, 1);
    assert.equal(calls.steps.length, 0);
});

test('waiting while not arrived falls back after two', async () => {
    const { bot, deps, calls } = setup({ decide: () => answer('wait') });
    deps.sleep = async () => {};
    const { counters } = await followWithLaya(bot, 'chris', 3, deps);
    assert.equal(counters.fallbacks.wait, 1);
    assert.equal(calls.decide, 3);
});

test('a step that does not move counts as stuck', async () => {
    const { bot, deps } = setup({ decide: () => answer('E'), stuck: true });
    const { counters } = await followWithLaya(bot, 'chris', 3, deps);
    assert.equal(counters.fallbacks.stuck, 1);
    assert.ok(counters.stuckSeconds >= 0);
});

test('steps are logged', async () => {
    const stepLog = join(mkdtempSync(join(tmpdir(), 'laya-')), 'bots', 'b', 'logs', 'laya-follow.jsonl');
    const { bot, deps } = setup({ decide: () => answer('E'), stepLog });
    deps.sleep = async () => { bot.interrupt_code = true; };
    await followWithLaya(bot, 'chris', 3, deps);
    const lines = readFileSync(stepLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));
    assert.equal(lines.length, 9);
    assert.equal(lines[0].outcome, 'stepped');
    assert.equal(lines[0].move, 'E');
    assert.match(lines[0].state, /^Follow\.\nPlayer E12 S0\n/);
});

test('player not found', async () => {
    const { bot, deps } = setup({ decide: () => answer('E') });
    const { found } = await followWithLaya(bot, 'nobody', 3, deps);
    assert.equal(found, false);
});

test('off by default', () => {
    setSettings(rootSettings);
    assert.equal(taskSettings('follow'), null);
    setSettings({ ...rootSettings, decision_models: { ...rootSettings.decision_models, tasks: { follow: { ...rootSettings.decision_models.tasks.follow, enabled: true } } } });
    assert.equal(taskSettings('follow').model, 'follow-a');
    setSettings(rootSettings);
});

test('summary line', () => {
    const line = summary({ asked: 3, stepped: 2, vetoes: { harmful: 1 }, damage: 0, stuckSeconds: 0, fallbacks: { veto: 1, stuck: 0 } });
    assert.equal(line, 'Laya follow: asked 3, stepped 2, fallbacks: veto 1; vetoes: harmful 1; damage 0, stuck 0.0 s');
});
