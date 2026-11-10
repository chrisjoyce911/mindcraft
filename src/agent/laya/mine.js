// Mining towards an ore with a Laya decision model (the "mine" task).
//
// Each step: read the 5×5×5 view around the bot (mine_state.js), ask the mine
// task for Action and Hazard (laya-client), and run the step as a short macro:
// collect the ore once it is in sight, tunnel or stair down or up one block,
// place a torch, block lava or water touching the bot, or stop. It never digs
// straight down. When there is no answer, the answer isn't confident, the
// safety veto refuses it (laya-go's unsafe rules: no digging into or beside
// lava or water, nothing solid to stand on), or it makes no sense ("collect"
// with nothing in sight, "block" with no fluid, "stop" while a step is
// possible), the loop takes laya-go's rule answer instead (mine_state.decide).
//
// What it lacks it crafts (deps.craft): the pickaxe the ore needs (before
// starting, and on "stop" for a weak pickaxe), a batch of torches whenever it
// has fewer than torch_low and carries coal (or charcoal) and sticks (or wood
// for them), or none left in the dark (backing off torch_retry_steps after a
// failed craft), and a pickaxe again if it breaks.
//
// Ore in sight is collected only when it is safe and near the mine: within
// collect_range of the plan cell (v2; of the bot with v1), with no water or
// lava touching it or on the way there, and at most collect_budget blocks of
// collecting away from the plan before it walks back. It stops when it has count more of the ore's
// drop, after max_steps steps, after max_failures failed steps in a row, or
// when trapped.
//
// With prompt v2 (the default) it follows a mine plan (mine_plan.js): a
// staircase down to the ore's band and a branch-mine grid at each level. The
// plan's next step goes into the state (`Plan <kind> <dir>`); ore in sight,
// lava and water and a due torch still come first. When the bot is off the
// plan (after collecting ore, at a branch's end, after unloading) it walks
// back to the plan with moveTo; when the step taken isn't the plan's step (a
// detour round an unsafe step) the plan abandons that segment. Torches go on
// the left wall going out. v2 also asks Unload: when the pack is (nearly)
// full and a home chest is known, it goes home, empties the pack (keeping
// tools, food, torches and some throwaway blocks) and walks back. With
// prompt v1 it roams as the model and rules say.
//
// Actions are passed in (see skills.mineWithLaya), so this file needs no
// mineflayer import and is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ORES, TIER_PICKAXE, THROWAWAY, QUESTIONS, QUESTIONS_V2, OFFSET, FEET, HEAD, readView, state, decide, unsafe, touching,
    unload, homeDistance, valuables, HOSTILES_CAP, pickTier, countOf, headingOf, SEEN_RANGE } from './mine_state.js';
import { createPlan, PLAN_DEFAULTS } from './mine_plan.js';

const DEFAULTS = { prompt: 'v2', max_failures: 4, log_steps: true, torch_batch: 4, torch_low: 4, torch_retry_steps: 50,
    keep_blocks: 32, unload_retry_steps: 50, collect_range: 8, collect_budget: 24 };
const MAX_STEPS = { v1: 300, v2: 2000 };
const FACE = { N: 'north', E: 'east', S: 'south', W: 'west' };
const MOVES = new Set(['tunnel', 'down', 'up']);
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel)$/;

// depositList is what goes into the home chest from an inventory ({name:
// count}): everything except tools, food, torches and up to keep throwaway
// blocks.
export function depositList(inv, isFood = () => false, keep = 32) {
    const out = [];
    let left = keep;
    for (const n of THROWAWAY) {
        const c = inv[n] || 0;
        const k = Math.min(c, left);
        left -= k;
        if (c > k) out.push({ name: n, count: c - k });
    }
    for (const [name, count] of Object.entries(inv)) {
        if (!count || THROWAWAY.includes(name) || name === 'torch' || TOOL.test(name) || isFood(name)) continue;
        out.push({ name, count });
    }
    return out;
}

export function newCounters() {
    return { asked: 0, model: 0, rules: {}, vetoes: {}, steps: {}, failures: 0, crafted: [], walks: 0, abandoned: 0, unloads: 0 };
}

export function summary(c, got, want, drop) {
    const rules = Object.entries(c.rules).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const plan = c.walks || c.abandoned || c.unloads ? `; walks ${c.walks}, abandoned ${c.abandoned}, unloads ${c.unloads}` : '';
    return `Laya mine: ${got} of ${want} ${drop}; asked ${c.asked}, model steps ${c.model}, rule steps: ${rules}; vetoes: ${vetoes}; crafted: ${c.crafted.join(', ') || 'nothing'}${plan}`;
}

// FLUIDS are the blocks that hold water or lava.
const FLUIDS = new Set(['water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
const isFluid = b => !!b && (FLUIDS.has(b.name) || b.getProperties?.().waterlogged === true);
const SIDES = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// fluidNear reports whether a cell or a cell touching it holds water or lava.
export function fluidNear(blockAt, x, y, z) {
    return SIDES.some(([dx, dy, dz]) => isFluid(blockAt(x + dx, y + dy, z + dz)));
}

// oreSafe reports whether ore can be collected from feet without going near
// water or lava: none touching the ore, and none touching the straight line
// there at feet or head height.
export function oreSafe(blockAt, feet, ore) {
    if (fluidNear(blockAt, ore.x, ore.y, ore.z)) return false;
    const n = Math.ceil(dist(feet, ore) * 2);
    for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = Math.floor(feet.x + 0.5 + (ore.x - feet.x) * t), z = Math.floor(feet.z + 0.5 + (ore.z - feet.z) * t);
        const y = Math.floor(feet.y + (ore.y - feet.y) * t);
        if (fluidNear(blockAt, x, y, z) || fluidNear(blockAt, x, y + 1, z)) return false;
    }
    return true;
}

// pickOre chooses the ore to collect from ores ([{x, y, z}], nearest
// first): the nearest within range of anchor (the plan cell) and of sight
// (SEEN_RANGE) of feet, not skipped, within the off-plan budget left, and
// safe. It returns it or null.
export function pickOre(ores, { feet, anchor, range, budget, blockAt, skip = () => false }) {
    for (const o of ores) {
        const d = dist(feet, o);
        if (d > SEEN_RANGE || dist(anchor, o) > range || d > budget || skip(o)) continue;
        if (oreSafe(blockAt, feet, o)) return o;
    }
    return null;
}

// canMakeTorches: coal or charcoal and sticks, or wood to make sticks from.
export function canMakeTorches(inv) {
    const fuel = (inv.coal || 0) + (inv.charcoal || 0);
    const wood = Object.entries(inv).some(([n, c]) => c > 0 && (n === 'stick' || /_(planks|log|wood|stem|hyphae)$/.test(n)));
    return fuel > 0 && wood;
}

// worldCell turns a view cell [layer, dx, dz] into world coordinates.
const worldCell = (bx, by, bz, [l, dx, dz]) => [bx + dx, by + FEET - l, bz + dz];

// cellsToDig are a move's cells that hold something to dig.
function cellsToDig(view, action) {
    const [kind, dir] = action.split(' ');
    const [dx, dz] = OFFSET[dir];
    const cells = {
        tunnel: [[1, dx, dz], [2, dx, dz]],
        down: [[1, dx, dz], [2, dx, dz], [3, dx, dz]],
        up: [[0, 0, 0], [1, dx, dz], [0, dx, dz]],
    }[kind];
    const target = { tunnel: [2, dx, dz], down: [3, dx, dz], up: [1, dx, dz] }[kind];
    return { dig: cells.filter(([l, x, z]) => view[l][2 + z][2 + x] !== 'A'), target, dir };
}

// mineWithLaya mines until it has count more of the ore's drop. deps:
//   client ({decide}), task (settings)
//   blockAt(x, y, z), inventory() → {name: count}, nearestOre(blocks, range) → {x, y, z} | null
//   ores(blocks, range) → [{x, y, z}] nearest first (optional; else nearestOre)
//   craft(item, count) → bool, collect(blocks, count, {x, y, z}) → bool (the ore block given),
//   dig(x, y, z) → bool,
//   moveTo(x, y, z, timeoutMs) → bool, place(item, x, y, z, placeOn) → bool
//   v2: freeSlots() → empty inventory slots, home() → home chest {x, y, z} | null,
//       hostiles() → hostile mobs within 16 blocks (bot.health and bot.food are read too),
//       goHome({x, y, z}) → bool, deposit([{name, count}]) → bool (true: all went in), isFood(name) → bool,
//       chat(msg) (optional)
//   sleep(ms), log(msg), stepLog (file path, or null)
export async function mineWithLaya(bot, oreName, count, deps) {
    const opts = { ...DEFAULTS, ...(deps.task || {}) };
    const v2 = opts.prompt === 'v2';
    const maxSteps = opts.max_steps ?? MAX_STEPS[v2 ? 'v2' : 'v1'];
    const counters = newCounters();
    const ore = ORES[oreName];
    if (!ore) return { ok: false, reason: `unknown ore ${oreName}; one of ${Object.keys(ORES).join(', ')}`, counters };
    const start = deps.inventory()[ore.drop] || 0;
    let deposited = 0; // of the ore's drop, in the home chest
    const got = () => (deps.inventory()[ore.drop] || 0) + deposited - start;
    let heading = headingOf(bot.entity.yaw || 0), dark = 0, failures = 0, noTorchUntil = 0, noUnloadUntil = 0;
    let offPlan = 0; // blocks collecting has taken the bot away from the plan
    const failedOre = new Set(); // ore blocks a collect failed on
    const oreKey = o => `${o.x},${o.y},${o.z}`;
    const oresNear = range => deps.ores ? deps.ores(ore.blocks, range) : [deps.nearestOre(ore.blocks, range)].filter(Boolean);

    const logStep = entry => {
        if (!opts.log_steps || !deps.stepLog) return;
        try {
            mkdirSync(dirname(deps.stepLog), { recursive: true });
            appendFileSync(deps.stepLog, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
        } catch { /* a step log failure never stops mining */ }
    };
    const craft = async (item, n) => {
        const ok = await deps.craft(item, n).catch(() => false);
        if (ok) counters.crafted.push(`${item} x${n}`);
        deps.log?.(ok ? `Crafted ${item} for mining.` : `Couldn't craft ${item} for mining.`);
        return ok;
    };
    const ensurePickaxe = async () => {
        if (pickTier(deps.inventory()) >= ore.tier) return true;
        return await craft(TIER_PICKAXE[ore.tier], 1) && pickTier(deps.inventory()) >= ore.tier;
    };
    const finish = (ok, reason) => {
        deps.log?.(summary(counters, got(), count, ore.drop));
        return { ok, reason, collected: got(), counters, entrance: plan?.entrance };
    };
    const feetOf = () => {
        const p = bot.entity.position;
        return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    };
    // walkTo walks through the dug mine, allowing time for the distance.
    const walkTo = async c => {
        const f = feetOf();
        const ms = Math.max(4000, Math.ceil(Math.hypot(c.x - f.x, c.y - f.y, c.z - f.z)) * 700);
        counters.walks++;
        return await deps.moveTo(c.x, c.y, c.z, ms);
    };
    // goUnload returns 'done', 'partial' (the chests filled up after taking
    // something) or 'failed'.
    const total = inv => Object.values(inv).reduce((n, c) => n + c, 0);
    const goUnload = async home => {
        counters.unloads++;
        if (!await deps.goHome(home)) return 'failed';
        const items = depositList(deps.inventory(), deps.isFood || (() => false), opts.keep_blocks);
        const inv0 = deps.inventory();
        const ok = await deps.deposit(items).catch(() => false);
        const inv1 = deps.inventory();
        deposited += Math.max(0, (inv0[ore.drop] || 0) - (inv1[ore.drop] || 0));
        const outcome = ok ? 'done' : total(inv1) < total(inv0) ? 'partial' : 'failed';
        deps.log?.({ done: 'Emptied my pack into the home chest.', partial: 'The home chest is full: I put in what fit.',
            failed: "Couldn't empty my pack into the home chest." }[outcome]);
        return outcome;
    };

    let plan = null;
    if (!await ensurePickaxe()) return finish(false, `needs a ${TIER_PICKAXE[ore.tier]}`);

    if (v2) {
        const f = feetOf();
        const planOpts = Object.fromEntries(Object.keys(PLAN_DEFAULTS).filter(k => opts[k] != null).map(k => [k, opts[k]]));
        plan = createPlan({ ...f, heading }, ore, planOpts);
        const msg = `The ${oreName} mine starts at ${f.x} ${f.y} ${f.z}, heading ${heading}.`;
        deps.log?.(msg);
        deps.chat?.(msg);
    }

    for (let step = 0; step < maxSteps && !bot.interrupt_code; step++) {
        if (got() >= count) return finish(true, 'done');
        const inv = deps.inventory();
        const torches = inv.torch || 0;
        if (step >= noTorchUntil && torches < opts.torch_low && (canMakeTorches(inv) || (!torches && dark >= 8))) {
            if (!await craft('torch', opts.torch_batch) || (deps.inventory().torch || 0) <= torches)
                noTorchUntil = step + opts.torch_retry_steps;
        }
        const feet = feetOf();
        const { x: bx, y: by, z: bz } = feet;
        const view = readView(deps.blockAt, bx, by, bz, ore.blocks);

        let pn = plan ? plan.next(feet) : null;
        if (pn?.done) return finish(false, `plan: ${pn.done}`);
        if (pn && !pn.walk) offPlan = 0; // back on the plan
        // Ore to collect: near the plan cell (v1: the bot), safe, within budget.
        const anchor = pn?.walk || feet;
        const near = pickOre(oresNear(SEEN_RANGE), { feet, anchor, blockAt: deps.blockAt,
            range: plan ? opts.collect_range : SEEN_RANGE, budget: plan ? opts.collect_budget - offPlan : Infinity,
            skip: o => failedOre.has(oreKey(o)) });
        const seen = near ? Math.max(1, Math.ceil(Math.hypot(near.x - bx, near.y - by, near.z - bz))) : 0;
        const inv2 = deps.inventory();
        const s = { ore: oreName, y: by, pick: pickTier(inv2), torches: inv2.torch || 0, blocks: countOf(inv2, THROWAWAY),
            dark, heading, seen: seen <= SEEN_RANGE ? seen : 0, view };

        let homePos = null;
        if (plan) {
            if (pn.walk) {
                // Off the plan: ore near it and touching fluid first, else walk back.
                const first = decide(s);
                if (first.rule !== 'collect' && first.rule !== 'block-fluid') {
                    const ok = await walkTo(pn.walk);
                    logStep({ walk: pn.walk, segment: pn.segment, pos: feet, state: state(s), outcome: ok ? 'done' : 'failed' });
                    failures = ok ? 0 : failures + 1;
                    if (!ok) counters.failures++;
                    if (failures >= opts.max_failures) return finish(false, `${failures} steps failed in a row`);
                    await deps.sleep?.(0);
                    continue;
                }
                pn = null;
            }
            homePos = deps.home?.() || null;
            Object.assign(s, { plan: pn?.step || null, free: deps.freeSlots?.() ?? 36, home: homeDistance(feet, homePos),
                health: Math.round(bot.health ?? 20), food: bot.food ?? 20,
                hostiles: Math.min(HOSTILES_CAP, deps.hostiles?.() ?? 0), valuables: valuables(inv2) });
        }

        const rule = decide(s);
        let action = rule.action, source = 'rules', why = null;
        const entry = { rule: rule.action, pos: feet, state: state(s) };
        let r = null;
        if (!plan || s.plan) {
            counters.asked++;
            r = await deps.client.decide('mine', entry.state, s.plan ? QUESTIONS_V2 : QUESTIONS);
        } else why = 'walk-first';
        if (!r) why = why || 'no-answer';
        else {
            const top = r.answers.Action.top;
            Object.assign(entry, { model: top, p: r.answers.Action.topProbability, hazard: r.answers.Hazard?.probability, ms: r.ms });
            const veto = unsafe(view, top);
            if (!r.answers.Action.confident) why = 'low-confidence';
            else if (veto) { why = 'veto'; counters.vetoes[veto] = (counters.vetoes[veto] || 0) + 1; entry.veto = veto; }
            else if (top === 'collect' && !s.seen) why = 'nothing-seen';
            else if (top === 'block' && (!touching(view).length || !s.blocks)) why = 'nothing-to-block';
            else if (top === 'torch' && !s.torches) why = 'no-torches';
            else if (top === 'stop' && rule.action !== 'stop') why = 'stop-early';
            else if (s.plan && MOVES.has(top.split(' ')[0]) && top !== s.plan && rule.rule === 'follow-plan') why = 'off-plan';
            else { action = top; source = 'model'; }
        }

        // Unload: the model when it is sure, else the rule; always with a full
        // pack; never with no home chest or with fluid touching.
        if (s.plan && s.home != null && step >= noUnloadUntil) {
            const u = r?.answers?.Unload;
            entry.unload = u?.probability;
            const want = s.free === 0 || (u?.confident ? u.probability >= 0.5 : unload(s));
            if (want && !touching(view).length) {
                // A full chest after putting things in is a partial unload: no
                // failure, but no Unload again for a while either.
                const outcome = await goUnload(homePos);
                const ok = outcome !== 'failed';
                if (outcome !== 'done') noUnloadUntil = step + opts.unload_retry_steps;
                logStep({ ...entry, action: 'unload', source: u?.confident ? 'model' : 'rules', outcome });
                failures = ok ? 0 : failures + 1;
                if (!ok) counters.failures++;
                if (failures >= opts.max_failures) return finish(false, `${failures} steps failed in a row`);
                await deps.sleep?.(0);
                continue;
            }
        }

        if (source === 'model') counters.model++;
        else counters.rules[why] = (counters.rules[why] || 0) + 1;
        Object.assign(entry, { action, source, why });

        let ok = false;
        const kind = action.split(' ')[0];
        if (kind === 'collect') {
            entry.ore = near;
            ok = await deps.collect(ore.blocks, 1, near).catch(() => false);
            if (!ok) failedOre.add(oreKey(near));
            if (plan) {
                const f = feetOf();
                offPlan += Math.hypot(f.x - bx, f.y - by, f.z - bz);
            }
        }
        else if (MOVES.has(kind)) {
            if (s.plan && action !== s.plan) {
                // A detour round an unsafe plan step: give up that segment.
                entry.abandoned = plan.segment?.type;
                plan.abandon();
                counters.abandoned++;
            }
            const { dig, target, dir } = cellsToDig(view, action);
            ok = true;
            for (const c of dig) ok = await deps.dig(...worldCell(bx, by, bz, c)) && ok;
            if (ok) ok = await deps.moveTo(...worldCell(bx, by, bz, target));
            if (ok) { heading = dir; dark++; }
            if (!ok && pickTier(deps.inventory()) < ore.tier) ok = await ensurePickaxe(); // the pickaxe broke
        } else if (kind === 'torch') {
            const spots = [];
            if (plan) {
                // On the left wall going out, at head height.
                const wall = plan.torchWall();
                const [dx, dz] = OFFSET[wall];
                if (view[HEAD][2 + dz][2 + dx] === 'S') spots.push([0, 1, 0, FACE[wall]]);
            }
            const [dx, dz] = OFFSET[{ N: 'S', S: 'N', E: 'W', W: 'E' }[heading]];
            for (const [x, z] of [[dx, dz], ...Object.values(OFFSET)]) if (view[FEET][2 + z][2 + x] === 'A') spots.push([x, 0, z, 'bottom']);
            for (const [x, y, z, on] of spots) if ((ok = await deps.place('torch', bx + x, by + y, bz + z, on))) break;
            if (ok) dark = 0;
        } else if (kind === 'block') {
            const item = THROWAWAY.find(n => (deps.inventory()[n] || 0) > 0);
            ok = !!item;
            for (const c of touching(view)) if (item) ok = await deps.place(item, ...worldCell(bx, by, bz, c)) && ok;
        } else if (kind === 'stop') {
            if (rule.rule === 'need-pickaxe' && await ensurePickaxe()) ok = true;
            else {
                logStep({ ...entry, outcome: 'stopped' });
                return finish(false, rule.rule === 'trapped' ? 'trapped: every step is unsafe' : `needs a ${TIER_PICKAXE[ore.tier]}`);
            }
        }
        counters.steps[kind] = (counters.steps[kind] || 0) + 1;
        logStep({ ...entry, outcome: ok ? 'done' : 'failed' });
        failures = ok ? 0 : failures + 1;
        if (!ok) counters.failures++;
        if (failures >= opts.max_failures) return finish(false, `${failures} steps failed in a row`);
        await deps.sleep?.(0);
    }
    if (got() >= count) return finish(true, 'done');
    return finish(false, bot.interrupt_code ? 'interrupted' : `no ${ore.drop} after ${maxSteps} steps`);
}
