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
// collect_range of the plan cell (v2; of the bot with v1) and at most
// collect_below blocks below it (so the bot can climb back), with no water or
// lava touching it or on the way there, and at most collect_budget blocks of
// collecting away from the plan before it walks back. When the walk back to
// the plan fails walk_restart times in a row, the plan starts again from
// where the bot stands. It stops when it has count more of the ore's
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
import { ORES, TIER_PICKAXE, THROWAWAY, QUESTIONS, QUESTIONS_V2, OFFSET, FEET, HEAD, readView, state, decide, unsafe, touching, dug, cellOf, TORCH_EVERY,
    unload, homeDistance, valuables, HOSTILES_CAP, pickTier, countOf, headingOf, SEEN_RANGE } from './mine_state.js';
import { createPlan, PLAN_DEFAULTS } from './mine_plan.js';

const DEFAULTS = { prompt: 'v2', max_failures: 4, log_steps: true, torch_batch: 4, torch_low: 4, torch_retry_steps: 50,
    keep_blocks: 32, unload_retry_steps: 50, unload_fail_steps: 200, collect_range: 12, collect_budget: 24, collect_below: 4,
    collect_below_open: 8, walk_restart: 2, torch_place_retry: 3, max_drop: 3, heal_health: 8, eat_to: 18, heal_wait_s: 60, floor_vetoes: 2 };
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

// exposed: a block with air beside it (ore on a cave or pocket wall).
export function exposed(blockAt, o) {
    return SIDES.slice(1).some(([dx, dy, dz]) => blockAt(o.x + dx, o.y + dy, o.z + dz)?.boundingBox === 'empty');
}

// pickOre chooses the ore to collect from ores ([{x, y, z}], nearest
// first): the nearest within range of anchor (the plan cell) and of sight
// (SEEN_RANGE) of feet, not skipped, within the off-plan budget left, and
// safe, and at most below blocks under anchor (belowOpen for ore open to
// the air, in a cave or pocket beside the stair). It returns it or null.
export function pickOre(ores, { feet, anchor, range, budget, blockAt, below = Infinity, belowOpen = below, skip = () => false }) {
    for (const o of ores) {
        const d = dist(feet, o);
        if (d > SEEN_RANGE || dist(anchor, o) > range || d > budget || skip(o)) continue;
        const depth = anchor.y - o.y;
        if (depth > below && !(depth <= belowOpen && exposed(blockAt, o))) continue;
        if (oreSafe(blockAt, feet, o)) return o;
    }
    return null;
}

// pickUpDrop makes sure a dug ore's drop reached the pack: count() is how
// many of the drop it carries, before the count before digging; findItem()
// is a dropped item entity near the ore (or null) and fetch(item) walks onto
// it. It waits for the drop, fetches it up to tries times, and returns
// whether the count went up.
export async function pickUpDrop({ count, before, findItem, fetch, sleep, tries = 3, wait = 250 }) {
    for (let i = 0; i <= tries; i++) {
        if (count() > before) return true;
        await sleep(wait);
        if (count() > before) return true;
        if (i === tries) break;
        const item = findItem();
        if (item) await fetch(item).catch(() => {});
    }
    return count() > before;
}

// canMakeTorches: coal or charcoal and sticks, or wood to make sticks from.
export function canMakeTorches(inv) {
    const fuel = (inv.coal || 0) + (inv.charcoal || 0);
    const wood = Object.entries(inv).some(([n, c]) => c > 0 && (n === 'stick' || /_(planks|log|wood|stem|hyphae)$/.test(n)));
    return fuel > 0 && wood;
}

// openSky reports whether nothing solid is above feet (up to 64 blocks):
// the mine starts at the surface, so the staircase goes surface_depth down
// before any branch.
export function openSky(blockAt, f, height = 64) {
    for (let dy = 2; dy <= height; dy++) {
        const b = blockAt(f.x, f.y + dy, f.z);
        if (b && b.boundingBox !== 'empty') return false;
    }
    return true;
}

// dropBelow counts the air under a cell (x, y, z) the bot would stand in:
// from its floor down, or, when the floor is one block thick, from under
// that floor (a thin floor over a cave). Unloaded blocks count as solid.
export function dropBelow(blockAt, x, y, z, max = 8) {
    const empty = yy => { const b = blockAt(x, yy, z); return !!b && b.boundingBox === 'empty'; };
    const start = empty(y - 1) ? y - 1 : y - 2;
    let n = 0;
    while (n < max && empty(start - n)) n++;
    return n;
}

// moveFeet is where a move leaves the bot's feet.
export function moveFeet(action, bx, by, bz) {
    const [kind, dir] = action.split(' ');
    const [dx, dz] = OFFSET[dir];
    return { x: bx + dx, y: by + { tunnel: 0, down: -1, up: 1 }[kind], z: bz + dz };
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
//   mines ({find(feet) → saved mine | null, save(rec)}, optional): mine
//   memory (mine_memory.js); a mine within 16 blocks goes on
//   sleep(ms), log(msg), stepLog (file path, or null)
//   progress ({done}, optional): raised by each drop collected, so a job
//   resumed after an interrupt knows how many are left
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
    const progressBase = deps.progress?.done || 0;
    const record = () => { if (deps.progress) deps.progress.done = progressBase + Math.max(0, got()); };
    let heading = headingOf(bot.entity.yaw || 0), dark = 0, failures = 0, noTorchUntil = 0, noUnloadUntil = 0;
    let offPlan = 0; // blocks collecting has taken the bot away from the plan
    let walkFails = 0; // failed walks back to the plan in a row
    let floorVetoes = 0; // "no floor" or drop vetoes in a row
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
        record();
        deps.log?.(summary(counters, got(), count, ore.drop));
        saveMine();
        return { ok, reason, collected: got(), counters, entrance: plan?.entrance, reused: !!reused };
    };
    // the mine's record (mine memory): entrance, heading, ores, deepest level
    let mineRec = null, reused = null;
    const saveMine = () => {
        if (!mineRec || !deps.mines) return;
        const f = feetOf();
        mineRec.deepest = Math.min(mineRec.deepest ?? f.y, f.y);
        mineRec.last = f;
        mineRec.updated = new Date().toISOString();
        deps.mines.save(mineRec);
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

    // heal (rule "heal"): hurt, so no more digging down: eat until food
    // eat_to, retreat up the staircase from hostiles, and wait to regenerate.
    // With no food it stops and asks for some.
    const heal = async feet => {
        counters.rules.heal = (counters.rules.heal || 0) + 1;
        const hostiles = deps.hostiles?.() ?? 0;
        const entry = { rule: 'heal', action: 'heal', source: 'rules', why: 'heal', pos: feet,
            health: Math.round(bot.health ?? 20), food: bot.food ?? 20, hostiles };
        let ate = 0;
        while (!bot.interrupt_code && (bot.food ?? 20) < opts.eat_to && ate < 8 && deps.eat && await deps.eat().catch(() => false)) ate++;
        let retreated = false;
        if (hostiles > 0 && plan) retreated = await walkTo(plan.entrance);
        if ((bot.food ?? 20) < opts.eat_to) {
            logStep({ ...entry, ate, retreated, outcome: 'stopped' });
            const msg = "I'm hurt and I have no food, so I've stopped mining. Can someone bring me food?";
            deps.chat?.(msg);
            return finish(false, 'hurt with no food');
        }
        for (let i = 0; i < opts.heal_wait_s && !bot.interrupt_code && (bot.health ?? 20) <= opts.heal_health; i++) {
            if (!retreated && plan && (deps.hostiles?.() ?? 0) > 0) retreated = await walkTo(plan.entrance);
            await deps.sleep(1000);
        }
        logStep({ ...entry, ate, retreated, health_after: Math.round(bot.health ?? 20), outcome: 'done' });
        return null;
    };

    let plan = null;
    const planOpts = Object.fromEntries(Object.keys(PLAN_DEFAULTS).filter(k => opts[k] != null).map(k => [k, opts[k]]));
    if (!await ensurePickaxe()) return finish(false, `needs a ${TIER_PICKAXE[ore.tier]}`);

    if (v2) {
        const f = feetOf();
        reused = deps.mines?.find(f) || null;
        let msg;
        if (reused) {
            // the same layout from the same entrance: walk through what is dug
            const e = reused.entrance;
            heading = reused.heading;
            plan = createPlan({ ...e, heading }, ore, { ...planOpts, surface: !!reused.surface });
            const open = c => ['A', 'O'].includes(cellOf(deps.blockAt(c.x, c.y, c.z), [])) && cellOf(deps.blockAt(c.x, c.y + 1, c.z), []) === 'A';
            const skipped = plan.skipDug(open);
            mineRec = { ...reused, ores: [...new Set([...(reused.ores || []), oreName])] };
            msg = `Going on with the mine at ${e.x} ${e.y} ${e.z} (heading ${heading}) for ${oreName}.`;
            logStep({ reuse: e, skipped, outcome: 'reused' });
        } else {
            const surface = openSky(deps.blockAt, f);
            plan = createPlan({ ...f, heading }, ore, { ...planOpts, surface });
            mineRec = { entrance: f, heading, surface, ores: [oreName], deepest: f.y, started: new Date().toISOString() };
            msg = `The ${oreName} mine starts at ${f.x} ${f.y} ${f.z}, heading ${heading}.`;
        }
        saveMine();
        deps.log?.(msg);
        deps.chat?.(msg);
    }

    for (let step = 0; step < maxSteps && !bot.interrupt_code; step++) {
        if (got() >= count) return finish(true, 'done');
        record();
        if (step && step % 50 === 0) saveMine();
        const inv = deps.inventory();
        const torches = inv.torch || 0;
        if (step >= noTorchUntil && torches < opts.torch_low && (canMakeTorches(inv) || (!torches && dark >= 8))) {
            if (!await craft('torch', opts.torch_batch) || (deps.inventory().torch || 0) <= torches)
                noTorchUntil = step + opts.torch_retry_steps;
        }
        const feet = feetOf();
        const { x: bx, y: by, z: bz } = feet;
        if (plan && (bot.health ?? 20) <= opts.heal_health) {
            const stop = await heal(feet);
            if (stop) return stop;
            await deps.sleep?.(0);
            continue;
        }
        let view = readView(deps.blockAt, bx, by, bz, ore.blocks);

        let pn = plan ? plan.next(feet) : null;
        if (pn?.done) return finish(false, `plan: ${pn.done}`);
        if (pn && !pn.walk) offPlan = 0; // back on the plan
        // Ore to collect: near the plan cell (v1: the bot), safe, within budget.
        const anchor = pn?.walk || feet;
        const near = pickOre(oresNear(SEEN_RANGE), { feet, anchor, blockAt: deps.blockAt,
            range: plan ? opts.collect_range : SEEN_RANGE, budget: plan ? opts.collect_budget - offPlan : Infinity,
            below: plan ? opts.collect_below : Infinity, belowOpen: plan ? Math.max(opts.collect_below, opts.collect_below_open) : Infinity,
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
                    walkFails = ok ? 0 : walkFails + 1;
                    if (!ok) counters.failures++;
                    if (walkFails >= opts.walk_restart) {
                        // can't get back (e.g. down a hole after ore): the
                        // mine starts again from here
                        const f = feetOf();
                        plan = createPlan({ ...f, heading }, ore, { ...planOpts, surface: openSky(deps.blockAt, f) });
                        walkFails = 0; failures = 0; offPlan = 0;
                        counters.restarts = (counters.restarts || 0) + 1;
                        logStep({ restart: f, outcome: 'restarted' });
                        deps.log?.(`Couldn't get back to the mine: starting it again from ${f.x} ${f.y} ${f.z}.`);
                        await deps.sleep?.(0);
                        continue;
                    }
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

        // A move onto a drop (more than max_drop air under the cell, also
        // under a one-block floor) is unsafe like "no floor": the rules
        // answer with that move's floor taken away in their view.
        const isDrop = a => MOVES.has(a.split(' ')[0])
            && dropBelow(deps.blockAt, ...Object.values(moveFeet(a, bx, by, bz))) > opts.max_drop;
        const dropped = [];
        let rule = decide(s);
        while (MOVES.has(rule.action.split(' ')[0]) && isDrop(rule.action) && dropped.length < 12) {
            dropped.push(rule.action);
            view = view.map(l => l.map(r => r.slice()));
            const [l, dx, dz] = dug(rule.action).floor;
            view[l][2 + dz][2 + dx] = 'A';
            rule = decide({ ...s, view }); // the state text keeps the world as read
        }
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
            const veto = unsafe(view, top) || (isDrop(top) ? 'drop' : '');
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
            // ore in sight and room for it: collect it first
            const collectFirst = s.seen > 0 && s.free > 0;
            if (want && collectFirst) entry.unload_later = 'collect-first';
            if (want && !collectFirst && !touching(view).length) {
                // A full chest after putting things in is a partial unload: no
                // failure, but no Unload again for a while either.
                const outcome = await goUnload(homePos);
                const ok = outcome !== 'failed';
                // a failed unload backs off longer: mining and collecting go on
                if (outcome !== 'done') noUnloadUntil = step + (ok ? opts.unload_retry_steps : opts.unload_fail_steps);
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
        if (dropped.length) entry.drops = dropped;

        // Floor vetoes in a row on the staircase: the ground below is a cave
        // or a drop, so the descent stops here and the level starts.
        const planFloor = s.plan && MOVES.has(s.plan.split(' ')[0]) && (unsafe(s.view, s.plan) === 'no floor' || isDrop(s.plan));
        const floorVeto = entry.veto === 'no floor' || entry.veto === 'drop' || dropped.length > 0 || planFloor;
        floorVetoes = floorVeto ? floorVetoes + 1 : 0;
        if (plan && floorVetoes >= opts.floor_vetoes && s.plan?.startsWith('down') && plan.stopDescent(feet)) {
            floorVetoes = 0;
            counters.rules['stop-descent'] = (counters.rules['stop-descent'] || 0) + 1;
            logStep({ ...entry, action: 'stop-descent', outcome: 'done' });
            deps.log?.(`The ground below is hollow: the ${oreName} mine's level starts here at Y ${by}.`);
            await deps.sleep?.(0);
            continue;
        }

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
            const detour = s.plan && action !== s.plan;
            const { dig, target, dir } = cellsToDig(view, action);
            ok = true;
            for (const c of dig) ok = await deps.dig(...worldCell(bx, by, bz, c)) && ok;
            if (ok) ok = await deps.moveTo(...worldCell(bx, by, bz, target));
            if (ok) { heading = dir; dark++; }
            if (detour) {
                // A detour round an unsafe plan step: give up that segment; a
                // staircase goes on from where the detour took the bot.
                entry.abandoned = plan.segment?.type;
                plan.abandon(ok ? feetOf() : null);
                counters.abandoned++;
            }
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
            // placed: dark again from 0; failed: try again a few moves on,
            // not at once in the same spot
            dark = ok ? 0 : Math.min(dark, TORCH_EVERY - opts.torch_place_retry);
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
