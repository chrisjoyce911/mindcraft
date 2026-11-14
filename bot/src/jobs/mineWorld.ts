// The mine job's world (the old skills.mineOre deps and pack_actions.packDeps): what andy carries and sees, and the
// acts through the actuators: collect an ore, dig, step or walk through the mine (safe movements), place a torch or
// a block, go home and empty the pack, eat, and make what the mine lacks (the craft loop, as the old craftForTask:
// the craft model, else the recipe rules alone, else the plain recipe).
import type { Vec3Like } from '../types/index.js';
import type { Act } from '../actuators/bot.js';
import { collectOreAt, digBlock, walkTo } from '../actuators/ore.js';
import { placeAt } from '../actuators/place.js';
import { goHome, depositAtHome, findSignedChest } from '../actuators/unload.js';
import { homeAdopter } from '../home/adopt.js';
import { eatFood } from '../actuators/eat.js';
import { craftRecipe } from '../actuators/craft.js';
import { wait } from '../actuators/settle.js';
import { HOME_PLACE } from '../home/chest.js';
import { HARMFUL } from '../sensors/pack.js';
import { isHostile } from '../sensors/mobs.js';
import { FOODS, isFood as isKnownFood } from '../models/eat/render.js';
import { CRAFT_DEFAULTS, type JobDeps } from './deps.js';
import { makeItem, settingsOf } from './craft.js';
import type { MineWorld } from './mine.js';

export const STEP_MS = 4000;
export const ORE_SCAN = 32;
export const HOSTILE_RANGE = 16;

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** foodRank: the most filling food first; rotten flesh last (the old eatBestFood). */
const points = (name: string) => (name === 'rotten_flesh' ? -1 : isKnownFood(name) ? FOODS[name].points : 0);

/**
 * makeOrCraft makes n more of item for a job (the old craftForTask): the craft model when its task is on, else the
 * recipe rules alone (the ingredients first, from what is carried or a chest), else the plain recipe. True when the
 * inventory grew (or the plain recipe reported done).
 */
export async function makeOrCraft(a: Act, deps: JobDeps, item: string, n: number, signal: AbortSignal, note: (m: string) => void): Promise<boolean> {
    const have = () => a.bot.items().filter(i => i.name === item).reduce((k, i) => k + i.count, 0);
    const before = have();
    const s = settingsOf(deps)();
    if (s.enabled) {
        const r = await makeItem(deps, item, n, signal);
        if (r.ok && have() > before) return true;
        if (signal.aborted) return false;
    }
    const r = await makeItem(deps, item, n, signal, { settings: { ...CRAFT_DEFAULTS, max_steps: 20, enabled: true, model: null, log_steps: s.log_steps } });
    if (r.ok && have() >= before + 1) return true;
    if (signal.aborted) return false;
    const c = await craftRecipe(a, item, Math.max(1, Math.ceil(n / (item === 'torch' ? 4 : 1))), signal);
    if (c.message) note(c.message);
    return c.ok;
}

/** homeOf: the saved home chest place, floored, or null. */
export function homeOf(deps: JobDeps): Vec3Like | null {
    const h = deps.places.recall(HOME_PLACE);
    return h ? { x: Math.floor(h[0]), y: Math.floor(h[1]), z: Math.floor(h[2]) } : null;
}

/**
 * homeFinder: the job's home(): the saved home chest, else a chest marked with a sign bearing andy's name (adopted
 * as the home chest, looked for at most every 30 s; home/adopt.ts). One per job run, so the 30 s holds across steps.
 */
export function homeFinder(deps: JobDeps): () => Vec3Like | null {
    return homeAdopter({
        recall: () => homeOf(deps),
        remember: c => deps.places.remember(HOME_PLACE, c),
        find: () => { const a = deps.act(); return a ? findSignedChest(a) : null; },
        say: text => { deps.note(text); deps.chat?.(text); },
        ...(deps.now ? { now: deps.now } : {}),
    });
}

export function mineWorld(a: Act, deps: JobDeps, home: () => Vec3Like | null = () => homeOf(deps)): MineWorld {
    const inventory = () => {
        const inv: Record<string, number> = {};
        for (const i of a.bot.items()) inv[i.name] = (inv[i.name] || 0) + i.count;
        return inv;
    };
    const note = (m: string) => deps.note(`mine: ${m}`);
    return {
        position: () => a.bot.entity.position,
        yaw: () => a.bot.entity.yaw ?? 0,
        health: () => a.bot.health ?? 20,
        food: () => a.bot.food ?? 20,
        blockAt: (x, y, z) => a.bot.blockAt(x, y, z),
        inventory,
        ores: (blocks, range) => {
            const me = a.bot.entity.position;
            return a.bot.findBlocks(blocks, me, range, ORE_SCAN).sort((p, q) => dist(me, p) - dist(me, q));
        },
        freeSlots: () => a.bot.emptySlots?.() ?? 36,
        home,
        hostiles: () => {
            const me = a.bot.entity.position;
            return Object.values(a.bot.entities).filter(e => e.position && isHostile({ ...e, position: e.position }) && dist(e.position, me) <= HOSTILE_RANGE).length;
        },
        isFood: name => a.bot.isFood(name),
        craft: (item, n, signal) => makeOrCraft(a, deps, item, n, signal, note),
        collect: async (o, blocks, drop, signal) => {
            const r = await collectOreAt(a, o, blocks, drop, signal);
            if (r.message) note(r.message);
            return r.ok;
        },
        dig: (p, signal) => digBlock(a, p, signal),
        moveTo: async (c, ms, signal) => (await walkTo(a, c, ms ?? STEP_MS, signal)).ok,
        place: (item, p, on, signal) => placeAt(a, item, p, on, signal),
        goHome: (home, signal) => goHome(a, home, signal),
        deposit: async (items, signal) => {
            const h = deps.places.recall(HOME_PLACE);
            if (!h) return false;
            const left = await depositAtHome(a, { x: Math.floor(h[0]), y: Math.floor(h[1]), z: Math.floor(h[2]) }, items, signal);
            if (left === null) { note("There's no chest at the home chest place."); return false; }
            if (left.length) note(`The home chest is full: still carrying ${left.map(i => `${i.count} ${i.name}`).join(', ')}.`);
            return left.length === 0;
        },
        eat: async signal => {
            const food = a.bot.items().filter(i => a.bot.isFood(i.name) && !HARMFUL.has(i.name)).sort((p, q) => points(q.name) - points(p.name))[0];
            if (!food) return false;
            return (await eatFood(a.bot, food.name, signal)).ok;
        },
        sleep: (ms, signal) => wait(ms, signal),
    };
}
