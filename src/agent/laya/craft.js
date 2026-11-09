// Crafting, gathering and storage with a Laya decision model (the "craft"
// task, laya-go's craft prompt v2).
//
// runCraft loops: read the situation (inventory, nearby crafting table,
// furnace and chest, the chest's known contents), ask the craft task for the
// next step (Action, Item, Count), check the step is possible, and do it with
// Mindcraft's skills, until the model says done with the goal carried, or a
// step can't be done. Gathering N of something is the same loop with a
// gathered item as the goal. Other Laya skills (mining, farming, …) call
// runCraft to make a tool or material they lack.
//
// Actions are passed in (see skills.layaCraft), so this file needs no
// mineflayer import and is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ITEMS, situation, state, questions, itemOptions, keep, NONE } from './craft_state.js';
import { PICKAXES, FUELS } from './craft_data.js';

const DEFAULTS = { max_steps: 40, log_steps: true, min_confidence: 0.3 };
const STATIONS = new Set(['crafting_table', 'furnace', 'chest']);

const tierCarried = have => PICKAXES.reduce((t, p, i) => ((have[p] || 0) > 0 ? i + 1 : t), 0);

// check returns null when step is possible in situation s, or why not.
export function check(s, step) {
    const { action, item, count } = step;
    const have = s.have;
    if (action === 'done') return (have[s.goal] || 0) >= s.count ? null : 'goal-not-carried';
    if (!itemOptions(s).includes(item) || item === NONE) return 'bad-item';
    const it = ITEMS[item];
    switch (action) {
    case 'gather':
        if (!it || it.kind !== 'gathered') return 'not-gatherable';
        if ((it.tier || 0) > tierCarried(have)) return 'needs-pickaxe';
        return null;
    case 'craft': {
        if (!it || it.kind !== 'crafted') return 'not-craftable';
        if (it.table && !s.tableNear && !(have.crafting_table > 0)) return 'needs-table';
        for (const [n, c] of it.needs) {
            const name = item === 'torch' && n === 'coal' ? ((have.charcoal || 0) > 0 ? 'charcoal' : 'coal') : n;
            if ((have[name] || 0) < c) return `needs-${name}`;
        }
        return null;
    }
    case 'smelt':
        if (!it || it.kind !== 'smelted') return 'not-smeltable';
        if (!((have[it.source] || 0) > 0)) return `needs-${it.source}`;
        if (!FUELS.some(f => (have[f] || 0) > 0)) return 'needs-fuel';
        if (!s.furnaceNear && !(have.furnace > 0)) return 'needs-furnace';
        return null;
    case 'place':
        if (!STATIONS.has(item)) return 'not-placeable';
        return (have[item] || 0) > 0 ? null : 'not-carried';
    case 'take':
        if (!s.chestNear) return 'no-chest';
        return s.chestKnown && !((s.chest[item] || 0) > 0) ? 'not-in-chest' : null;
    case 'store':
        if (!s.chestNear) return 'no-chest';
        if (keep(item) || !((have[item] || 0) > 0)) return 'not-storable';
        return null;
    default:
        return 'unknown-action';
    }
    // count is checked by the actions themselves (they do at most what's possible)
}

// plan returns the next step toward the goal by the recipe rules (the oracle
// laya-go trains the model on, simplified): take it from the chest, gather
// it (making the pickaxe first), craft it (its ingredients and a table
// first) or smelt it (source, fuel and furnace first). runCraft uses it when
// the model's step is refused, unsure, or "done" before the goal is
// carried. It returns null when the goal is carried, or when it can't help.
export function plan(s) {
    const have = { ...s.have };
    const seen = new Set();
    const next = (item, need) => {
        if ((have[item] || 0) >= need) return null;
        if (seen.has(item)) return undefined; // a loop: give up
        seen.add(item);
        try {
            const missing = need - (have[item] || 0);
            if (s.chestNear && (s.chest[item] || 0) > 0) return { action: "take", item, count: Math.min(missing, s.chest[item]) };
            const it = ITEMS[item];
            if (!it) return undefined;
            if (it.kind === "gathered") {
                const tier = it.tier || 0;
                if (tier > tierCarried(have)) return next(PICKAXES[tier - 1], 1);
                return { action: "gather", item, count: Math.min(64, missing) };
            }
            if (it.kind === "crafted") {
                const times = Math.ceil(missing / it.result);
                for (const [n, c] of it.needs) {
                    const name = item === "torch" && n === "coal" && (have.charcoal || 0) > 0 ? "charcoal" : n;
                    const sub = next(name, c * times);
                    if (sub !== null) return sub;
                }
                if (it.table && !s.tableNear && !(have.crafting_table > 0)) return next("crafting_table", 1);
                return { action: "craft", item, count: times };
            }
            if (it.kind === "smelted") {
                const sub = next(it.source, missing);
                if (sub !== null) return sub;
                if (!FUELS.some(f => (have[f] || 0) > 0)) return next("coal", 1);
                if (!s.furnaceNear && !(have.furnace > 0)) return next("furnace", 1);
                return { action: "smelt", item, count: missing };
            }
            return undefined;
        } finally { seen.delete(item); }
    };
    return next(s.goal, s.count) || null;
}

// runCraft makes count of item (a laya-go generic name: "log" for any wood).
// deps:
//   client      laya-client ({decide})
//   task        the craft task's settings (max_steps, min_confidence, log_steps)
//   items()     → [{name, count}] the main inventory and hotbar
//   near()      → {table, furnace, chest} stations close enough to use
//   readChest() → generic counts in the nearest chest, or null if unknown
//   act         {gather, craft, smelt, place, take, store}(item, count) → Promise<bool>
//   log(msg), stepLog (path or null), interrupted() → bool
// Returns {ok, reason, steps}.
export async function runCraft(item, count, deps) {
    const opts = { ...DEFAULTS, ...(deps.task || {}) };
    const logStep = entry => {
        if (!opts.log_steps || !deps.stepLog) return;
        try {
            mkdirSync(dirname(deps.stepLog), { recursive: true });
            appendFileSync(deps.stepLog, JSON.stringify({ time: new Date().toISOString(), goal: `${item} x${count}`, ...entry }) + '\n');
        } catch { /* never stops the bot */ }
    };
    if (!ITEMS[item]) return { ok: false, reason: `unknown-item ${item}`, steps: 0 };
    let chest = null;
    let steps = 0, fallbacks = 0;
    while (steps < opts.max_steps) {
        if (deps.interrupted?.()) return { ok: false, reason: 'interrupted', steps };
        const near = deps.near();
        if (near.chest && chest === null) chest = (await deps.readChest?.()) ?? null;
        const s = situation(deps.items(), item, count, near, chest || {});
        s.chestKnown = chest !== null;
        const text = state(s);
        const r = await deps.client.decide('craft', text, questions(s));
        if (!r) { logStep({ state: text, outcome: 'stop', reason: 'no-answer' }); return { ok: false, reason: 'no-answer', steps }; }
        const step = { action: r.answers.Action.top, item: r.answers.Item.top, count: Number(r.answers.Count.top) };
        const p = Math.min(r.answers.Action.topProbability, r.answers.Item.topProbability);
        const entry = { state: text, ...step, p, ms: r.ms };
        let why = p < opts.min_confidence ? 'low-confidence' : check(s, step);
        if (why) {
            // the recipe rules take over for this step (as the follow veto does)
            const ruled = plan(s);
            if (!ruled) {
                const done = (s.have[s.goal] || 0) >= s.count;
                logStep({ ...entry, outcome: done ? 'done' : 'stop', reason: why });
                return done ? { ok: true, reason: 'done', steps } : { ok: false, reason: `${step.action} ${step.item}: ${why}`, steps };
            }
            logStep({ ...entry, outcome: 'fallback', reason: why, rule: ruled });
            Object.assign(step, ruled);
            fallbacks++;
        }
        if (step.action === 'done') { logStep({ ...entry, outcome: 'done' }); return { ok: true, reason: 'done', steps }; }
        steps++;
        let n = step.count;
        if (step.action === 'store') n = s.have[step.item] <= 64 || n >= 64 ? -1 : n; // 64 means all
        if (step.action === 'take' && chest) n = Math.min(n, chest[step.item] || n);
        const ok = await deps.act[step.action](step.item, n);
        logStep({ ...entry, outcome: ok ? 'did' : 'failed' });
        if (!ok) return { ok: false, reason: `${step.action} ${step.item} failed`, steps };
        if (chest && (step.action === 'store' || step.action === 'take')) {
            const moved = step.action === 'store' ? (n === -1 ? s.have[step.item] : n) : -n;
            chest[step.item] = Math.max(0, (chest[step.item] || 0) + moved);
        }
        if (step.action === 'place' && step.item === 'chest') chest = {};
    }
    return { ok: false, reason: 'max-steps', steps };
}
