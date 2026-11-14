// The farm job's world (the old farm_actions.js farmDeps and pack_actions.js packDeps): the view around andy, the
// acts through the farm actuator, the pack and the home chest (a chest a sign with andy's name marks is adopted when
// none is saved), and getting what a step needs: a hoe and bone meal through the craft loop (makeOrCraft, as the
// mine's), seeds from grass, a water bucket only from what is there (a carried bucket, or 3 iron ingots for one, and
// water within water_radius).
import type { Vec3Like } from '../types/index.js';
import type { Act } from '../actuators/bot.js';
import { animalsNear, breed, farmAct, fillBucket, waterSource } from '../actuators/farm.js';
import { gatherSkillStep } from './gatherSkill.js';
import { skillWorld } from './skillWorld.js';
import { goHome, depositAtHome } from '../actuators/unload.js';
import { wait } from '../actuators/settle.js';
import { isHostile } from '../sensors/mobs.js';
import { C, isKind, parseCellName, readFarm, type CellAction, type FarmView } from '../models/farm/index.js';
import type { JobDeps, JobOf } from './deps.js';
import type { FarmWorld } from './farm.js';
import { homeOf, makeOrCraft } from './mineWorld.js';

export const HOSTILE_RANGE = 16;
/** MAKE: the item made for a farm item. */
const MAKE: Readonly<Record<string, string>> = { hoe: 'wooden_hoe' };

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/**
 * gatherSeeds runs the gather skill for seeds inline until it ends (or the signal aborts): have reaches goal, or it
 * ends without (the end's say is returned, null when done).
 */
export async function gatherSeeds(a: Act, deps: JobDeps, goal: number, signal: AbortSignal): Promise<string | null> {
    const job: JobOf<'gatherSkill'> = {
        id: 'farm-seeds', spec: { kind: 'gatherSkill', target: 'seeds', goal: Math.max(1, goal) }, origin: 'player',
        progress: {}, status: 'running', startedAt: Date.now(),
    };
    const w = skillWorld(a);
    while (!signal.aborted) {
        const r = await gatherSkillStep(job, w, deps, signal);
        if (r.how === 'end') return r.end.how === 'done' ? null : r.say ?? `gather seeds: ${r.end.how}`;
    }
    return null;
}

export function farmWorld(a: Act, deps: JobDeps, waterRadius: number, home: () => Vec3Like | null = () => homeOf(deps)): FarmWorld {
    const inventory = () => {
        const inv: Record<string, number> = {};
        for (const i of a.bot.items()) inv[i.name] = (inv[i.name] || 0) + i.count;
        return inv;
    };
    const note = (m: string) => deps.note(`farm: ${m}`);
    const count = (item: string) => {
        const inv = inventory();
        return item === 'hoe' ? Object.entries(inv).filter(([n]) => n.endsWith('_hoe')).reduce((k, [, c]) => k + c, 0) : (inv[item] || 0);
    };
    const feet = () => {
        const p = a.bot.entity.position;
        return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    };
    // the situation read last, with the column it was read from (the act's cells are offsets from it)
    let last: { bx: number; bz: number } | null = null;
    return {
        read: (): FarmView => {
            const f = feet();
            last = { bx: f.x, bz: f.z };
            return readFarm((x, y, z) => a.bot.blockAt(x, y, z), f.x, f.y, f.z, a.bot.items(), animalsNear(a));
        },
        act: async (action, target, item, s, signal) => {
            if (action === 'breed') return isKind(target) ? breed(a, target, item, signal) : false;
            if (action === 'wait' || action === 'find_water') return false;
            const c = parseCellName(target);
            const o = last ?? { bx: feet().x, bz: feet().z };
            if (!c) return false;
            const ground = { x: o.bx + c.x - C, y: s.ys[c.z]![c.x]!, z: o.bz + c.z - C };
            return farmAct(a, action as CellAction, ground, item, signal);
        },
        craft: async (item, n, signal) => {
            const before = count(item);
            if (item === 'wheat_seeds') {
                // 6.2b: seeds through the gather skill, run inline (its search widens 49 → 97 → 193 by its rules)
                const r = await gatherSeeds(a, deps, before + n, signal);
                if (r) note(r);
                return count(item) > before;
            }
            if (item === 'water_bucket') {
                if (count('bucket') === 0 && count('iron_ingot') < 3) return false;
                const water = waterSource(a, waterRadius);
                if (!water) return false;
                if (count('bucket') === 0 && !(await makeOrCraft(a, deps, 'bucket', 1, signal, note))) return false;
                if (signal.aborted) return false;
                return (await fillBucket(a, water, signal)) && count(item) > before;
            }
            await makeOrCraft(a, deps, MAKE[item] ?? item, n, signal, note);
            return count(item) > before; // the inventory decides, not the craft's report
        },
        inventory,
        position: feet,
        goTo: async (p, signal) => {
            // the farm movements: walking back to the field never tramples it
            const o = await a.motion.goTo(a.goals.near(p, 2), signal, { timeoutMs: 60000, farm: true });
            return o.ok || dist(a.bot.entity.position, p) <= 4;
        },
        findWater: async r => waterSource(a, r),
        freeSlots: () => a.bot.emptySlots?.() ?? 36,
        hostiles: () => {
            const me = a.bot.entity.position;
            return Object.values(a.bot.entities).filter(e => e.position && isHostile({ ...e, position: e.position }) && dist(e.position, me) <= HOSTILE_RANGE).length;
        },
        health: () => a.bot.health ?? 20,
        food: () => a.bot.food ?? 20,
        home,
        goHome: (h, signal) => goHome(a, h, signal),
        deposit: async (items, signal) => {
            const h = home();
            if (!h) return false;
            const list = (xs: readonly { name: string; count: number }[]) => xs.map(i => `${i.count} ${i.name}`).join(', ');
            note(`unloading ${list(items)} at ${h.x} ${h.y} ${h.z}`);
            const before = inventory();
            const left = await depositAtHome(a, h, items, signal);
            if (left === null) { note("There's no chest at the home chest place."); return false; }
            // the inventory decides what went in (with a chest filling up, the per-item count can miss some)
            const after = inventory();
            const kept = items.map(i => ({ name: i.name, count: Math.min(i.count, i.count - ((before[i.name] ?? 0) - (after[i.name] ?? 0))) }))
                .filter(i => i.count > 0);
            const still = kept; // left can over-report: not used
            if (still.length) note(`The home chest is full: still carrying ${list(still)}.`);
            return still.length === 0;
        },
        isFood: name => a.bot.isFood(name),
        sleep: (ms, signal) => wait(ms, signal),
    };
}
