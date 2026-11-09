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
// starting, and on "stop" for a weak pickaxe), torches when they run out, and
// a pickaxe again if it breaks. It stops when it has count more of the ore's
// drop, after max_steps steps, after max_failures failed steps in a row, or
// when trapped.
//
// Actions are passed in (see skills.mineWithLaya), so this file needs no
// mineflayer import and is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ORES, TIER_PICKAXE, THROWAWAY, QUESTIONS, OFFSET, FEET, readView, state, decide, unsafe, touching,
    pickTier, countOf, headingOf, SEEN_RANGE } from './mine_state.js';

const DEFAULTS = { max_steps: 300, max_failures: 4, log_steps: true, torch_batch: 4 };

export function newCounters() {
    return { asked: 0, model: 0, rules: {}, vetoes: {}, steps: {}, failures: 0, crafted: [] };
}

export function summary(c, got, want, drop) {
    const rules = Object.entries(c.rules).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    return `Laya mine: ${got} of ${want} ${drop}; asked ${c.asked}, model steps ${c.model}, rule steps: ${rules}; vetoes: ${vetoes}; crafted: ${c.crafted.join(', ') || 'nothing'}`;
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
//   craft(item, count) → bool, collect(blocks, count) → bool, dig(x, y, z) → bool,
//   moveTo(x, y, z) → bool, place(item, x, y, z) → bool
//   sleep(ms), log(msg), stepLog (file path, or null)
export async function mineWithLaya(bot, oreName, count, deps) {
    const opts = { ...DEFAULTS, ...(deps.task || {}) };
    const counters = newCounters();
    const ore = ORES[oreName];
    if (!ore) return { ok: false, reason: `unknown ore ${oreName}; one of ${Object.keys(ORES).join(', ')}`, counters };
    const start = deps.inventory()[ore.drop] || 0;
    const got = () => (deps.inventory()[ore.drop] || 0) - start;
    let heading = headingOf(bot.entity.yaw || 0), dark = 0, failures = 0, triedTorches = false;

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
        return { ok, reason, collected: got(), counters };
    };

    if (!await ensurePickaxe()) return finish(false, `needs a ${TIER_PICKAXE[ore.tier]}`);

    for (let step = 0; step < opts.max_steps && !bot.interrupt_code; step++) {
        if (got() >= count) return finish(true, 'done');
        const inv = deps.inventory();
        if (dark >= 8 && !inv.torch && !triedTorches) {
            triedTorches = true;
            await craft('torch', opts.torch_batch);
        }
        const p = bot.entity.position;
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
        const view = readView(deps.blockAt, bx, by, bz, ore.blocks);
        const near = deps.nearestOre(ore.blocks, SEEN_RANGE);
        const seen = near ? Math.max(1, Math.ceil(Math.hypot(near.x - bx, near.y - by, near.z - bz))) : 0;
        const inv2 = deps.inventory();
        const s = { ore: oreName, y: by, pick: pickTier(inv2), torches: inv2.torch || 0, blocks: countOf(inv2, THROWAWAY),
            dark, heading, seen: seen <= SEEN_RANGE ? seen : 0, view };
        const text = state(s);
        const rule = decide(s);
        counters.asked++;
        const r = await deps.client.decide('mine', text, QUESTIONS);
        const entry = { state: text, rule: rule.action };
        let action = rule.action, source = 'rules', why = null;
        if (!r) why = 'no-answer';
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
            else { action = top; source = 'model'; }
        }
        if (source === 'model') counters.model++;
        else counters.rules[why] = (counters.rules[why] || 0) + 1;
        Object.assign(entry, { action, source, why });

        let ok = false;
        const kind = action.split(' ')[0];
        if (kind === 'collect') ok = await deps.collect(ore.blocks, 1);
        else if (kind === 'tunnel' || kind === 'down' || kind === 'up') {
            const { dig, target, dir } = cellsToDig(view, action);
            ok = true;
            for (const c of dig) ok = await deps.dig(...worldCell(bx, by, bz, c)) && ok;
            if (ok) ok = await deps.moveTo(...worldCell(bx, by, bz, target));
            if (ok) { heading = dir; dark++; }
            if (!ok && pickTier(deps.inventory()) < ore.tier) ok = await ensurePickaxe(); // the pickaxe broke
        } else if (kind === 'torch') {
            const [dx, dz] = OFFSET[{ N: 'S', S: 'N', E: 'W', W: 'E' }[heading]];
            const spots = [[dx, dz], ...Object.values(OFFSET)].filter(([x, z]) => view[2][2 + z][2 + x] === 'A');
            for (const [x, z] of spots) if ((ok = await deps.place('torch', bx + x, by, bz + z))) break;
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
    return finish(false, bot.interrupt_code ? 'interrupted' : `no ${ore.drop} after ${opts.max_steps} steps`);
}
