// Farming with a Laya decision model (the "farm" task).
//
// Each step: read the 9×9 cells around the bot, what it carries and the
// animals nearby (farm_state.js), ask the farm task for Action, Target and
// Item (laya-client), check the answer with the safety veto, and carry it
// out. Before starting, and whenever a chosen action needs an item the bot
// doesn't carry, it asks the injected craft(item, count) to get it (a hoe,
// seeds, a water bucket, bone meal), then carries on.
//
// Actions are passed in (see farm_actions.js), so this file needs no
// mineflayer import and is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { questions, state as farmState, parseCellName, CROPS, NONE } from './farm_state.js';

const DEFAULTS = { step_ms: 500, max_steps: 400, max_misses: 5, log_steps: true, min_confidence: 0.5 };

// FOODS are the foods each kind breeds with (laya-go rules.Foods).
export const FOODS = { cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'beetroot_seeds'] };
const SEEDS = CROPS.map(c => c.seed);

// NEEDS: the item each action uses when the answer names none.
const NEEDS = { till: 'hoe', water: 'water_bucket', bone_meal: 'bone_meal' };

// STARTER: what farming needs before the first step: a hoe and some seeds.
export const STARTER = [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 4, any: SEEDS }];

const has = (s, item) => s.carry.some(c => c.item === item && c.count > 0);

// veto returns null when the answer is safe to carry out on the situation,
// or the reason it isn't. Flooding is checked by the actions (it needs the
// world), trampling by the movements they use.
export function veto(s, action, target, item) {
    if (action === 'wait') return null;
    if (action === 'breed') {
        const herd = s.animals.find(h => h.kind === target);
        if (!herd || herd.count < 2) return 'no-pair';
        if (!FOODS[target]?.includes(item)) return 'wrong-food';
        return null;
    }
    const cell = parseCellName(target);
    if (!cell) return 'no-cell';
    const code = s.grid[cell.z][cell.x];
    const ripe = CROPS.some(c => c.ripe === code), growing = CROPS.some(c => c.growing === code);
    switch (action) {
    case 'harvest': return ripe ? null : 'not-ripe';
    case 'plant': return code === 'F' || code === 'D' ? (SEEDS.includes(item) ? null : 'not-a-seed') : 'not-farmland';
    case 'till': return code === 'G' || code === 'L' ? null : 'not-tillable';
    case 'water': return code === 'D' ? null : 'not-dry-farmland';
    case 'bone_meal': return growing ? null : 'not-growing';
    default: return 'unknown-action';
    }
}

// needed returns the item an answer needs that the bot doesn't carry, or
// null.
export function needed(s, action, item) {
    const want = item !== NONE ? item : NEEDS[action];
    if (!want || action === 'harvest' || action === 'wait') return null;
    return has(s, want) ? null : want;
}

// newCounters returns a session's counters.
export function newCounters() {
    return { asked: 0, done: {}, vetoes: {}, crafted: {}, misses: 0, failed: 0 };
}

export function summary(c) {
    const list = o => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    return `Laya farm: asked ${c.asked}; did ${list(c.done)}; vetoes ${list(c.vetoes)}; crafted ${list(c.crafted)}; no answer ${c.misses}, failed ${c.failed}`;
}

// farmWithLaya farms for ms milliseconds, until bot.interrupt_code is set or
// max_steps. deps:
//   client      laya-client ({decide})
//   task        the farm task's settings
//   read()      → situation {grid, ys, carry, animals} (farm_state.readFarm)
//   act(action, target, item, s) → Promise<bool>: carry out an answer
//   craft(item, count) → Promise<bool>: get an item (hoe, seeds, water_bucket, bone_meal)
//   now(), sleep(ms), log(msg), stepLog (path or null)
export async function farmWithLaya(bot, ms, deps) {
    const opts = { ...DEFAULTS, ...(deps.task || {}) };
    const counters = newCounters();
    const end = deps.now() + ms;
    const logStep = entry => {
        if (!opts.log_steps || !deps.stepLog) return;
        try {
            mkdirSync(dirname(deps.stepLog), { recursive: true });
            appendFileSync(deps.stepLog, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
        } catch { /* a step log failure never stops farming */ }
    };
    const getItem = async (item, count) => {
        counters.crafted[item] = (counters.crafted[item] || 0) + 1;
        const ok = await deps.craft(item, count);
        logStep({ outcome: ok ? 'crafted' : 'craft-failed', item, count });
        return ok;
    };

    // Starter kit: a hoe and something to plant.
    let s = deps.read();
    for (const need of STARTER) {
        if ((need.any || [need.item]).some(i => has(s, i))) continue;
        if (!await getItem(need.item, need.count)) {
            deps.log?.(`I couldn't get a ${need.item} to farm with.`);
        }
    }

    let misses = 0, steps = 0;
    while (!bot.interrupt_code && deps.now() < end && steps < opts.max_steps) {
        steps++;
        s = deps.read();
        const st = farmState(s);
        counters.asked++;
        const r = await deps.client.decide('farm', st, questions(s));
        if (!r) {
            counters.misses++;
            logStep({ state: st, outcome: 'no-answer' });
            if (++misses >= opts.max_misses) { deps.log?.('The farm model is not answering; stopping.'); break; }
            await deps.sleep(opts.step_ms);
            continue;
        }
        misses = 0;
        const action = r.answers.Action.top, target = r.answers.Target.top, item = r.answers.Item.top;
        const entry = { state: st, action, target, item, p: r.answers.Action.topProbability, ms: r.ms };
        if (!r.answers.Action.confident || !r.answers.Target.confident) {
            logStep({ ...entry, outcome: 'low-confidence' });
            await deps.sleep(opts.step_ms);
            continue;
        }
        if (action === 'wait') {
            logStep({ ...entry, outcome: 'wait' });
            await deps.sleep(opts.step_ms * 4);
            continue;
        }
        const missing = needed(s, action, item);
        if (missing) {
            const ok = await getItem(missing, missing === 'wheat_seeds' ? 4 : 1);
            if (!ok) { counters.failed++; await deps.sleep(opts.step_ms); }
            continue; // read again with the new item
        }
        const use = item !== NONE ? item : (NEEDS[action] || NONE);
        const reason = veto(s, action, target, use);
        if (reason) {
            counters.vetoes[reason] = (counters.vetoes[reason] || 0) + 1;
            logStep({ ...entry, outcome: 'veto', veto: reason });
            await deps.sleep(opts.step_ms);
            continue;
        }
        const ok = await deps.act(action, target, use, s);
        if (ok) counters.done[action] = (counters.done[action] || 0) + 1;
        else counters.failed++;
        logStep({ ...entry, outcome: ok ? 'done' : 'failed' });
    }
    deps.log?.(summary(counters));
    return counters;
}
