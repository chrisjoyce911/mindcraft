// Farming with a Laya decision model (the "farm" task).
//
// Each step: read the 9×9 cells around the bot, what it carries and the
// animals nearby (farm_state.js), ask the farm task for Action, Target and
// Item (and with prompt v2 Unload; the state adds the crop being farmed and
// the pack line), check the answer with the safety veto, and carry it out.
// Before starting, and whenever a chosen action needs an item the bot doesn't
// carry, it asks the injected craft(item, count) to get it (a hoe, seeds, a
// water bucket, bone meal), then carries on.
//
// Goals: a time limit (the old !layaFarm(minutes)), a count of a crop's
// produce harvested since starting, or neither (farm until stopped).
//
// It never waits forever: when there is no water to farm with it looks for
// water within water_radius and walks there, or says so and stops; after
// wait_limit waits (or unsure answers) in a row with nothing growing it stops.
// It never repeats a failed step forever: a vetoed or failed action is banned
// on that cell for ban_steps steps (the rules answer instead), and after
// max_bad vetoed or failed steps in a row it stops.
// With prompt v2 and a home chest known it empties its pack there when Unload
// says so (or the pack is full) and walks back.
//
// Actions are passed in (see farm_actions.js), so this file needs no
// mineflayer import and is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { questions, questionsV2, state as farmState, stateV2, parseCellName, decide as rulesDecide, hasWater, growing,
    farmValuables, pondCell, besideHole, CROPS, NONE, PRODUCE, CROP_OF, FARM_CROPS, POND, FIND_WATER } from './farm_state.js';
import { pack, homeDistance, unloadRule, wantUnload, depositList, isTool } from './pack.js';
import { stopped } from '../run_token.js';

const DEFAULTS = { prompt: 'v1', step_ms: 500, max_steps: 400, max_misses: 5, log_steps: true, min_confidence: 0.5,
    wait_limit: 20, water_radius: 64, keep_seeds: 16, unload_retry_steps: 50, ban_steps: 20, max_bad: 6 };

export const NO_WATER = 'No water near here — take me to water or give me a water bucket.';

// FOODS are the foods each kind breeds with (laya-go rules.Foods).
export const FOODS = { cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'beetroot_seeds'] };
const SEEDS = CROPS.map(c => c.seed);

// NEEDS: the item each action uses when the answer names none.
const NEEDS = { till: 'hoe', water: 'water_bucket', bone_meal: 'bone_meal', [POND]: 'water_bucket' };

// STARTER: what farming needs before the first step: a hoe and some seeds.
export const STARTER = [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 4, any: SEEDS }];

const has = (s, item) => s.carry.some(c => c.item === item && c.count > 0);

// veto returns null when the answer is safe to carry out on the situation,
// or the reason it isn't. Flooding is checked by the actions (it needs the
// world), trampling by the movements they use.
export function veto(s, action, target, item) {
    if (action === 'wait' || action === FIND_WATER) return null;
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
    case POND: return code !== 'L' ? 'not-dry-ground' : besideHole(s, cell) ? 'beside-hole' : null;
    case 'bone_meal': return growing ? null : 'not-growing';
    default: return 'unknown-action';
    }
}

// needed returns the item an answer needs that the bot doesn't carry, or
// null.
export function needed(s, action, item) {
    const want = item !== NONE ? item : NEEDS[action];
    if (!want || action === 'harvest' || action === 'wait' || action === FIND_WATER) return null;
    return has(s, want) ? null : want;
}

// parseGoal reads !layaFarm's arguments: (crop, count), either optional, or
// the old (minutes). It returns {crop, count, minutes} (count and minutes
// null when not set) or {error}.
export function parseGoal(a, b) {
    const blank = v => v === undefined || v === null || v === '';
    const num = v => typeof v === 'number' ? v : (/^\d+(\.\d+)?$/.test(String(v).trim()) ? Number(v) : NaN);
    if (!blank(a) && blank(b) && Number.isFinite(num(a))) {
        const minutes = num(a);
        if (minutes <= 0 || minutes > 600) return { error: 'Minutes must be between 0 and 600.' };
        return { crop: 'any', count: null, minutes };
    }
    let crop = blank(a) ? 'any' : String(a).trim().toLowerCase();
    crop = { carrot: 'carrots', potato: 'potatoes', beetroots: 'beetroot', beetroot_seeds: 'beetroot', wheat_seeds: 'wheat', seeds: 'wheat', none: 'any' }[crop] || crop;
    if (!FARM_CROPS.includes(crop)) return { error: `Unknown crop ${a}: one of ${FARM_CROPS.join(', ')}.` };
    if (blank(b) || ['any', 'all'].includes(String(b).trim().toLowerCase())) return { crop, count: null, minutes: null };
    const count = num(b);
    if (!Number.isInteger(count) || count < 1) return { error: `Count must be a whole number of at least 1, or "any".` };
    return { crop, count, minutes: null };
}

// produceOf is how many of a crop's produce an inventory ({name: count})
// holds.
const produceOf = (inv, crop) => PRODUCE[crop].reduce((n, name) => n + (inv[name] || 0), 0);

// farmKeep returns how many of an item stay in the pack when unloading:
// tools, buckets, bone meal and food all; up to keepSeeds of each seed
// (carrots and potatoes are seeds); the produce (wheat, beetroot) none.
export function farmKeep(isFood = () => false, keepSeeds = 16) {
    return (name, count) => {
        if (isTool(name) || name === 'bucket' || name === 'water_bucket' || name === 'bone_meal') return count;
        if (SEEDS.includes(name)) return Math.min(count, keepSeeds);
        if (PRODUCE.any.includes(name)) return 0;
        return isFood(name) ? count : 0;
    };
}

// newCounters returns a session's counters.
export function newCounters() {
    return { asked: 0, done: {}, vetoes: {}, crafted: {}, misses: 0, failed: 0, rules: 0, harvested: 0, unloads: 0, water_trips: 0, reason: '' };
}

export function summary(c) {
    const list = o => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    const extra = c.rules || c.unloads || c.water_trips ? `; rule steps ${c.rules}, unloads ${c.unloads}, water trips ${c.water_trips}` : '';
    return `Laya farm: asked ${c.asked}; did ${list(c.done)}; vetoes ${list(c.vetoes)}; crafted ${list(c.crafted)}; no answer ${c.misses}, failed ${c.failed}; harvested ${c.harvested}${extra}${c.reason ? `; stopped: ${c.reason}` : ''}`;
}

// farmWithLaya farms toward a goal until bot.interrupt_code is set or
// max_steps. goal: a number of milliseconds (the old form), or {crop, count,
// ms, progress} (crop default any; count null farms until stopped; ms null
// has no time limit; progress {harvested} carries the count across resumes).
// deps:
//   client      laya-client ({decide})
//   task        the farm task's settings
//   read()      → situation {grid, ys, carry, animals} (farm_state.readFarm)
//   act(action, target, item, s) → Promise<bool>: carry out an answer
//   craft(item, count) → Promise<bool>: get an item (hoe, seeds, water_bucket, bone_meal)
//   now(), sleep(ms), log(msg), stepLog (path or null)
//   optional: inventory() → {name: count} (count goals and unloading),
//     say(msg) (in-game chat), position() → {x, y, z}, goTo({x, y, z}) → bool,
//     findWater(radius) → {x, y, z} | null,
//     pack (pack_actions.packDeps): freeSlots(), hostiles(), health(), food(),
//       home() → {x, y, z} | null, goHome(home) → bool, deposit([{name, count}]) → bool, isFood(name)
export async function farmWithLaya(bot, goal, deps) {
    const opts = { ...DEFAULTS, ...(deps.task || {}) };
    const g = typeof goal === 'number' ? { crop: 'any', count: null, ms: goal } : { crop: 'any', count: null, ms: null, ...goal };
    const v2 = opts.prompt === 'v2' || opts.prompt === 'v2.1'; // v2.1: v2's prompt, v2.1's rules
    const counters = newCounters();
    // progress: the harvest so far, shared across resumes of one command
    const progress = g.progress || { harvested: 0 };
    counters.harvested = progress.harvested || 0;
    const end = g.ms == null ? Infinity : deps.now() + g.ms;
    const say = msg => { deps.log?.(msg); deps.say?.(msg); };
    const finish = reason => {
        counters.reason = reason;
        deps.log?.(summary(counters));
        return counters;
    };
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
    const inventory = () => deps.inventory?.() || {};
    const p = deps.pack || {};

    // Starter kit: a hoe and something to plant (the crop's seed when one is
    // asked for and it can be had).
    let s = deps.read();
    const starter = g.crop === 'wheat' || g.crop === 'any' ? STARTER : [STARTER[0], { item: CROP_OF[g.crop].seed, count: 4, any: SEEDS }];
    for (const need of starter) {
        if ((need.any || [need.item]).some(i => has(s, i))) continue;
        if (!await getItem(need.item, need.count)) {
            say(`I couldn't get a ${need.item} to farm with.`);
            // without a hoe there's nothing to till or plant: stop rather
            // than wait out the whole time
            if (need.item === 'hoe' && !stopped(bot)) return finish('no hoe');
        }
    }

    let origin = deps.position?.() || null;
    let misses = 0, steps = 0, waits = 0, noUnloadUntil = 0, warnedFull = false, wentForWater = false;
    let bad = 0; // vetoed or failed steps in a row
    const banned = new Map(); // 'action target' → the step its ban ends
    const isBanned = (a, t) => (banned.get(`${a} ${t}`) ?? 0) > steps;
    // badStep bans the action on its cell; it returns true when it's time to stop.
    const badStep = (a, t) => {
        banned.set(`${a} ${t}`, steps + opts.ban_steps);
        return ++bad >= opts.max_bad;
    };

    // findWater walks to water within water_radius, or says there's none.
    // It returns true when farming can carry on.
    const findWater = async entry => {
        const at = deps.findWater ? await deps.findWater(opts.water_radius) : null;
        // already walked to water once and still dry: don't wander about
        if (!at || wentForWater) {
            logStep({ ...entry, outcome: 'no-water' });
            say(NO_WATER);
            return false;
        }
        counters.water_trips++;
        wentForWater = true;
        const ok = deps.goTo ? await deps.goTo(at) : false;
        logStep({ ...entry, outcome: ok ? 'went-to-water' : 'water-unreachable', water: at });
        if (!ok) { say(NO_WATER); return false; }
        origin = deps.position?.() || at;
        waits = 0;
        return true;
    };

    const goUnload = async home => {
        counters.unloads++;
        if (!await p.goHome(home)) return false;
        const items = depositList(inventory(), farmKeep(p.isFood, opts.keep_seeds));
        const ok = items.length ? await p.deposit(items) : true;
        deps.log?.(ok ? 'Emptied my pack into the home chest.' : "Couldn't empty my pack into the home chest.");
        if (origin && deps.goTo) await deps.goTo(origin);
        return ok;
    };

    // The step limit is for timed farming; a count or "until stopped" goes on.
    const maxSteps = g.ms != null ? opts.max_steps : (opts.max_steps_open ?? Infinity);
    while (!stopped(bot) && deps.now() < end && steps < maxSteps) {
        steps++;
        s = deps.read();
        let st, qs;
        if (v2) {
            const here = deps.position?.() || null;
            s = { ...s, crop: g.crop, pack: pack({
                free: p.freeSlots?.() ?? 36, home: homeDistance(here, p.home?.() || null),
                health: p.health?.() ?? 20, food: p.food?.() ?? 20, hostiles: p.hostiles?.() ?? 0,
                valuables: farmValuables(inventory(), farmKeep(p.isFood, opts.keep_seeds)),
            }) };
            st = stateV2(s); qs = questionsV2(s);
        } else {
            st = farmState(s); qs = questions(s);
        }
        if (hasWater(s.grid)) wentForWater = false; // farming by water again: another trip is fine later
        counters.asked++;
        const r = await deps.client.decide('farm', st, qs);
        if (!r && !v2) {
            counters.misses++;
            logStep({ state: st, outcome: 'no-answer' });
            if (++misses >= opts.max_misses) { say('The farm model is not answering; stopping.'); return finish('no answer'); }
            await deps.sleep(opts.step_ms);
            continue;
        }
        if (!r) counters.misses++;
        else misses = 0;
        const entry = { state: st };

        // Unload (v2): the model when sure, else the rule; always with a full
        // pack; never without a home chest.
        if (v2) {
            const home = p.home?.() || null;
            entry.unload = r?.answers?.Unload?.probability;
            if (s.pack.free === 0 && !home && !warnedFull) {
                warnedFull = true;
                say("My pack is full and I don't know a home chest (remember one as home_chest).");
            }
            if (home && steps >= noUnloadUntil && wantUnload(s.pack, r?.answers?.Unload, unloadRule(s.pack))) {
                const ok = await goUnload(home);
                if (!ok) { noUnloadUntil = steps + opts.unload_retry_steps; counters.failed++; }
                logStep({ ...entry, action: 'unload', outcome: ok ? 'done' : 'failed' });
                continue;
            }
        }

        // The answer: the model's when it is sure; with v2 the rules' when it
        // isn't; with v1 a wait.
        let action, target, item, source = 'model';
        const sure = r && r.answers.Action.confident && r.answers.Target.confident;
        if (sure) {
            action = r.answers.Action.top; target = r.answers.Target.top; item = r.answers.Item.top;
            Object.assign(entry, { p: r.answers.Action.topProbability, ms: r.ms });
        } else if (v2) {
            ({ action, target, item } = rulesDecide(s));
            source = 'rules';
            counters.rules++;
        } else {
            action = 'wait'; target = NONE; item = NONE; source = 'low-confidence';
            Object.assign(entry, { model_action: r.answers.Action.top, p: r.answers.Action.topProbability, ms: r.ms });
        }
        // A banned answer (it failed or was vetoed just now): the rules'
        // answer instead, or wait.
        if (action !== 'wait' && isBanned(action, target)) {
            entry.banned = `${action} ${target}`;
            const ruled = rulesDecide(s);
            if (ruled.action !== 'wait' && !isBanned(ruled.action, ruled.target)) ({ action, target, item } = ruled);
            else [action, target, item] = ['wait', NONE, NONE];
            source = 'banned';
        }
        Object.assign(entry, { action, target, item, source });

        // No water to farm with and nothing growing: with a water bucket make
        // a pond on the nearest dry ground; without one walk to water, or
        // say so and stop.
        const dry = !hasWater(s.grid) && !growing(s.grid);
        if (action === 'wait' && dry && has(s, 'water_bucket')) {
            const pond = pondCell(s.grid, c => isBanned(POND, c) || besideHole(s, parseCellName(c)));
            if (pond) [action, target, item, entry.source] = [POND, pond, 'water_bucket', 'dry'];
        }
        if (action === FIND_WATER || (action === 'wait' && dry)) {
            Object.assign(entry, { action: FIND_WATER });
            if (!await findWater(entry)) return finish('no water');
            continue;
        }
        Object.assign(entry, { action, target, item });

        if (action === 'wait') {
            waits++;
            bad = 0;
            logStep({ ...entry, outcome: source === 'low-confidence' ? 'low-confidence' : 'wait' });
            if (waits >= opts.wait_limit && !growing(s.grid)) {
                say('Nothing to farm here and nothing growing; stopping.');
                return finish('nothing to do');
            }
            await deps.sleep(source === 'low-confidence' ? opts.step_ms : opts.step_ms * 4);
            continue;
        }
        waits = 0;

        // A crop asked for: plant its seed when the bot has it.
        if (action === 'plant' && g.crop !== 'any' && SEEDS.includes(item) && item !== CROP_OF[g.crop].seed && has(s, CROP_OF[g.crop].seed))
            item = CROP_OF[g.crop].seed;

        const missing = needed(s, action, item);
        if (missing) {
            // a water bucket for a dry place that can't be had: find water
            const ok = await getItem(missing, missing === 'wheat_seeds' ? 4 : 1);
            if (!ok) {
                counters.failed++;
                if (missing === 'water_bucket' && !hasWater(s.grid)) {
                    if (!await findWater(entry)) return finish('no water');
                    continue;
                }
                await deps.sleep(opts.step_ms);
            }
            continue; // read again with the new item
        }
        const use = item !== NONE ? item : (NEEDS[action] || NONE);
        const reason = veto(s, action, target, use);
        if (reason) {
            counters.vetoes[reason] = (counters.vetoes[reason] || 0) + 1;
            logStep({ ...entry, outcome: 'veto', veto: reason });
            if (badStep(action, target)) {
                say(`I keep failing to ${action} here; stopping.`);
                return finish('stuck');
            }
            await deps.sleep(opts.step_ms);
            continue;
        }
        const before = action === 'harvest' ? produceOf(inventory(), g.crop) : 0;
        const ok = await deps.act(action, target, use, s);
        if (ok) counters.done[action] = (counters.done[action] || 0) + 1;
        else counters.failed++;
        if (action === 'harvest') {
            const got = Math.max(0, produceOf(inventory(), g.crop) - before);
            counters.harvested += got;
            progress.harvested = counters.harvested;
            entry.harvested = got;
        }
        logStep({ ...entry, outcome: ok ? 'done' : 'failed' });
        if (ok) bad = 0;
        else if (badStep(action, target)) {
            say(`I keep failing to ${action} here; stopping.`);
            return finish('stuck');
        }
        if (g.count != null && counters.harvested >= g.count) {
            say(`Harvested ${counters.harvested} ${g.crop === 'any' ? 'crops' : g.crop}.`);
            return finish('count reached');
        }
    }
    return finish(stopped(bot) ? 'stopped' : deps.now() >= end ? 'time' : steps >= maxSteps ? 'max steps' : '');
}
