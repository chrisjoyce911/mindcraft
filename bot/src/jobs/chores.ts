// The chores jobs (5.6; skills-spec v1 §1 "Answers"): the answers with no job of their own, each a short actuator
// sequence (no choice is made here; the chores model chose the run and goals.ts its amounts):
//   cook    smelt all carried raw meat in the base furnace, one kind per step (fuel: coal, charcoal, logs, planks)
//   unload  put the pack into the home chest: everything but tools, food, torches and 32 throwaway blocks (the old
//           director's unload: mine depositList), into the chests touching it when it is full
//   kit     put cooked food (up to KIT_FOOD in the kit) and torches (up to KIT_TORCHES, when 8 are left carried) into
//           the home chest's kit
//   sleep   sleep in his bed (home_bed) until morning
//   rest    stay near the centre (within 8) for its seconds; ask: say "I need <item>: …" first, at most once per item
//           per NEED_SAY_MS
//   cobble  mine count more cobblestone from the stone nearest the surface around the centre (the old gatherCobble)
//   craft bed: planks (the craft loop) then the bed of the carried wool's colour; craft into the kit: the tool made
//           goes into the home chest
// Each fails with the Last line's reason (types/chores ChoreReason).
import type { JobStepper, StepResult, Vec3Like } from '../types/index.js';
import type { AskItem } from '../types/jobs.js';
import type { ChoreReason } from '../types/chores.js';
import type { Act } from '../actuators/bot.js';
import { goNear } from '../actuators/approach.js';
import { smeltItem } from '../actuators/smelt.js';
import { depositAtHome, goHome } from '../actuators/unload.js';
import { readChest } from '../actuators/chest.js';
import { collectBlocks } from '../actuators/collect.js';
import { craftRecipe } from '../actuators/craft.js';
import { sleepIn } from '../actuators/sleep.js';
import { HOME_PLACE, isChest } from '../home/chest.js';
import { baseCentre } from '../home/centre.js';
import { KIT_FOOD, KIT_TORCHES, NOT_FOOD, RAW_MEAT, kitReserved } from '../home/kit.js';
import { depositList } from '../models/mine/index.js';
import { inColumns, reachOf } from '../sensors/chores.js';
import { pause, type JobDeps, type JobOf } from './deps.js';
import { makeItem, craftRunner } from './craft.js';

export const BASE = 21;
export const BASE_HEIGHT = 16;
/** Rest stays within this of the centre. */
export const REST_NEAR = 8;
/** "I need <item>" is said at most once per item per this long (the old NEED_SAY_MS). */
export const NEED_SAY_MS = 5 * 60_000;
/** Throwaway blocks an unload keeps (the old director's 32). */
export const UNLOAD_KEEP_BLOCKS = 32;
/** Torches kept carried when the kit takes some (the old stockKit's + 8). */
export const KIT_TORCHES_KEPT = 8;
/** The stone the cobble job and the Near stone line look for, and how deep under open sky. */
export const STONES = ['stone', 'deepslate', 'andesite', 'diorite', 'granite'] as const;
export const SURFACE_DEPTH = 4;
/** Stone positions the cobble job tries (nearest first). */
export const COBBLE_TRIES = 6;
/** Planks a bed needs. */
export const BED_PLANKS = 3;
export const BED_WOOL = 3;

/** What andy says when he needs something (the ask targets as the old need words). */
export const NEED_WORDS: Readonly<Record<AskItem, string>> = { logs: 'wood', cobble: 'cobblestone', coal: 'coal', wool: 'wool', food: 'food' };
export const needText = (item: AskItem) => `I need ${NEED_WORDS[item]}: there's none near enough for me to get.`;

const end = (say?: string): StepResult => ({ how: 'end', end: { how: 'done' }, ...(say ? { say } : {}) });
const failed = (reason: ChoreReason, note?: string): StepResult => ({ how: 'end', end: { how: 'failed', reason }, ...(note ? { say: note } : {}) });
const notInGame: StepResult = { how: 'end', end: { how: 'failed', reason: 'stuck' }, say: 'not in game' };
const count = (a: Act, test: (n: string) => boolean) => a.bot.items().filter(i => test(i.name)).reduce((n, i) => n + i.count, 0);
const floorP = (p: readonly [number, number, number]): Vec3Like => ({ x: Math.floor(p[0]), y: Math.floor(p[1]), z: Math.floor(p[2]) });
const centreOf = (a: Act, deps: JobDeps) => baseCentre(deps.places, a.bot.entity.position);

/** homeChest: the saved home chest when a chest stands there (or it isn't loaded), else null. */
function homeChest(a: Act, deps: JobDeps): Vec3Like | null {
    const h = deps.places.recall(HOME_PLACE);
    if (!h) return null;
    const p = floorP(h);
    const b = a.bot.blockAt(p.x, p.y, p.z);
    return b && !isChest(b) ? null : p;
}

/** inBaseOf: blocks named one of names in the base area around the centre, nearest the centre first. */
function inBaseOf(a: Act, names: readonly string[], c: Vec3Like): Vec3Like[] {
    return a.bot.findBlocks(names, c, reachOf(BASE), 16)
        .filter(p => inColumns(c, p, BASE) && Math.abs(p.y - Math.floor(c.y)) <= BASE_HEIGHT);
}

/** surfaceStone: stone with open sky above within SURFACE_DEPTH (not in a cave). */
export function surfaceStone(a: Act, p: Vec3Like): boolean {
    for (let dy = 1; dy <= SURFACE_DEPTH; dy++) {
        const b = a.bot.blockAt(p.x, p.y + dy, p.z);
        if (!b) return false;
        if (b.boundingBox !== 'block') return (a.bot.skyLight?.({ x: p.x, y: p.y + dy, z: p.z }) ?? 15) > 0;
    }
    return false;
}

/** stoneNear: surface stone within size×size columns of the centre, nearest the centre first (at most n). */
export function stoneNear(a: Act, c: Vec3Like, size: number, n = 24): Vec3Like[] {
    return a.bot.findBlocks(STONES, c, reachOf(size), n * 4).filter(p => inColumns(c, p, size) && surfaceStone(a, p)).slice(0, n);
}

// ---- cook ----

export function cookRunner(_job: JobOf<'cook'>, deps: JobDeps): JobStepper {
    let cooked = 0;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            const raw = a.bot.items().find(i => RAW_MEAT.has(i.name));
            if (!raw) return cooked ? end(`Cooked ${cooked} food.`) : failed('missing_food', 'I have no raw meat to cook.');
            const c = centreOf(a, deps);
            const f = inBaseOf(a, ['furnace', 'smoker'], c)[0];
            if (!f) return failed('no_spot', 'There is no furnace in the base.');
            const near = await goNear(a, f, 3, signal);
            if (signal.aborted) return { how: 'more' };
            if (!near.ok) return failed('stuck', "I couldn't reach the furnace.");
            const n = count(a, x => x === raw.name);
            const r = await smeltItem(a, raw.name, n, signal);
            if (r.cancelled || signal.aborted) return { how: 'more' };
            cooked += r.smelted;
            if (!r.ok) return failed(/fuel/i.test(r.message) ? 'missing_coal' : 'stuck', r.message);
            return { how: 'more' };
        },
    };
}

// ---- unload ----

export function unloadRunner(_job: JobOf<'unload'>, deps: JobDeps): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            const home = homeChest(a, deps);
            if (!home) return failed('no_spot', "I don't have a home chest to unload into.");
            if (!(await goHome(a, home, signal))) return signal.aborted ? { how: 'more' } : failed('stuck', "I couldn't reach the home chest.");
            const inv: Record<string, number> = {};
            for (const i of a.bot.items()) inv[i.name] = (inv[i.name] ?? 0) + i.count;
            const items = depositList(inv, n => a.bot.isFood(n), UNLOAD_KEEP_BLOCKS);
            if (!items.length) return end();
            deps.checkpoint?.();
            const left = await depositAtHome(a, home, items, signal);
            if (signal.aborted) return { how: 'more' };
            if (left === null) return failed('no_spot', "I don't have a home chest to unload into.");
            return left.length ? failed('full', 'The home chest is full.') : end('Emptied my pack into the home chest.');
        },
    };
}

// ---- kit ----

/** kitPuts: what goes into the kit: cooked food up to KIT_FOOD and torches up to KIT_TORCHES (keeping 8 carried). */
export function kitPuts(carried: readonly { name: string; count: number }[], reserved: Readonly<Record<string, number>>, isFood: (n: string) => boolean): { name: string; count: number }[] {
    const kitFood = Object.entries(reserved).filter(([n]) => n !== 'torch' && isFood(n)).reduce((s, [, c]) => s + c, 0);
    const kitTorches = reserved.torch ?? 0;
    const put: { name: string; count: number }[] = [];
    let need = KIT_FOOD - kitFood;
    for (const i of carried) {
        if (need <= 0) break;
        if (!isFood(i.name) || RAW_MEAT.has(i.name) || NOT_FOOD.has(i.name)) continue;
        const already = put.find(x => x.name === i.name);
        const n = Math.min(need, i.count);
        if (already) already.count += n; else put.push({ name: i.name, count: n });
        need -= n;
    }
    const torches = carried.filter(i => i.name === 'torch').reduce((s, i) => s + i.count, 0);
    const want = KIT_TORCHES - kitTorches;
    if (want > 0 && torches - want >= KIT_TORCHES_KEPT) put.push({ name: 'torch', count: want });
    return put.filter(p => p.count > 0);
}

export function kitRunner(_job: JobOf<'kit'>, deps: JobDeps): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            const home = homeChest(a, deps);
            if (!home) return failed('no_spot', "I don't have a home chest for the kit.");
            const r = await readChest(a, home, signal);
            if (signal.aborted) return { how: 'more' };
            if (!r.ok) return failed('stuck', "I couldn't open the home chest.");
            const put = kitPuts(a.bot.items(), kitReserved(r.items, n => a.bot.isFood(n)), n => a.bot.isFood(n));
            if (!put.length) return failed('missing_food', 'I have nothing to put in the kit.');
            deps.checkpoint?.();
            const left = await depositAtHome(a, home, put, signal);
            if (signal.aborted) return { how: 'more' };
            if (left === null) return failed('no_spot');
            return left.length ? failed('full', 'The home chest is full.') : end(`Kit: ${put.map(i => `${i.count} ${i.name.replace(/_/g, ' ')}`).join(', ')}.`);
        },
    };
}

// ---- sleep ----

export function sleepRunner(_job: JobOf<'sleep'>, deps: JobDeps): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            const h = deps.places.recall('home_bed');
            if (!h) return failed('no_spot', "I don't have a bed.");
            const o = await sleepIn(a, floorP(h), signal);
            if (signal.aborted || (!o.ok && o.reason === 'cancelled')) return { how: 'more' };
            return o.ok ? end() : failed('stuck', `I couldn't sleep${!o.ok && o.detail ? `: ${o.detail}` : ''}.`);
        },
    };
}

// ---- rest and ask ----

/** The times andy last said he needs each item (the deps keep one map per bot). */
export type NeedSaid = Map<AskItem, number>;

export function restRunner(job: JobOf<'rest'>, deps: JobDeps): JobStepper {
    const now = deps.now ?? Date.now;
    const { seconds, ask } = job.spec;
    let asked = false;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            if (ask && !asked) {
                asked = true;
                const said = deps.needSaid;
                const t = now();
                if (!said || !(t - (said.get(ask) ?? -Infinity) < NEED_SAY_MS)) {
                    said?.set(ask, t);
                    deps.chat?.(needText(ask));
                }
            }
            const elapsed = now() - job.startedAt;
            if (elapsed >= seconds * 1000) return end();
            const c = centreOf(a, deps);
            const me = a.bot.entity.position;
            if (Math.hypot(me.x - c.x, me.y - c.y, me.z - c.z) > REST_NEAR) {
                await goNear(a, c, REST_NEAR / 2, signal);
                return { how: 'more' };
            }
            await pause(Math.max(1, Math.min(500, seconds * 1000 - elapsed)), signal);
            return { how: 'more' };
        },
    };
}

// ---- cobble ----

export interface CobbleProgress { start?: number; tried?: string[] }
const cobbleOf = (a: Act) => count(a, n => n === 'cobblestone' || n === 'cobbled_deepslate');

export function cobbleRunner(job: JobOf<'cobble'>, deps: JobDeps): JobStepper {
    const p = job.progress as CobbleProgress;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            p.start ??= cobbleOf(a);
            p.tried ??= [];
            const got = () => cobbleOf(a) - p.start!;
            if (got() >= job.spec.count) return end(`Mined ${got()} cobblestone.`);
            if (!a.bot.items().some(i => i.name.endsWith('_pickaxe'))) return failed('no_tool', 'I have no pickaxe for stone.');
            const c = centreOf(a, deps);
            const key = (q: Vec3Like) => `${q.x},${q.y},${q.z}`;
            const stone = stoneNear(a, c, 193).filter(q => !p.tried!.includes(key(q)));
            if (!stone.length || p.tried.length >= COBBLE_TRIES) {
                return got() > 0 ? end(`Mined ${got()} cobblestone.`) : failed('no_source', 'There is no stone I could mine near the surface.');
            }
            const at = stone.sort((x, y) => Math.hypot(x.x - a.bot.entity.position.x, x.z - a.bot.entity.position.z) - Math.hypot(y.x - a.bot.entity.position.x, y.z - a.bot.entity.position.z))[0]!;
            p.tried.push(key(at));
            const near = await goNear(a, at, 4, signal);
            if (signal.aborted) return { how: 'more' };
            if (!near.ok) return { how: 'more' };
            const r = await collectBlocks(a, 'stone', job.spec.count - got(), signal);
            if (r.cancelled || signal.aborted) return { how: 'more' };
            if (/right tools/i.test(r.message)) return failed('no_tool', r.message);
            return { how: 'more' };
        },
        left: () => { const a = deps.act(); return a && p.start !== undefined ? job.spec.count - (cobbleOf(a) - p.start) : null; },
    };
}

// ---- craft: a bed, a kit tool ----

export interface BedProgress { planks?: boolean }

/** bedRunner: planks with the craft loop, then the bed of the most carried wool colour (3 of it). */
export function bedRunner(job: JobOf<'craft'>, deps: JobDeps): JobStepper {
    const p = job.progress as BedProgress;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return notInGame;
            const wool = a.bot.items().filter(i => i.name.endsWith('_wool') && i.count >= BED_WOOL).sort((x, y) => y.count - x.count)[0];
            if (!wool) return failed('missing_wool', 'I need 3 wool of one colour for a bed.');
            const bed = wool.name.replace(/_wool$/, '_bed');
            const planks = count(a, n => n.endsWith('_planks'));
            if (planks < BED_PLANKS && !p.planks) {
                p.planks = true;
                const r = await makeItem(deps, 'planks', BED_PLANKS - planks, signal, { purpose: 'chore' });
                if (signal.aborted) { p.planks = false; return { how: 'more' }; }
                if (!r.ok) return failed(r.reason.startsWith('missing_') ? r.reason as ChoreReason : 'missing_logs', `I couldn't make planks for a bed.`);
            }
            const before = count(a, n => n.endsWith('_bed'));
            const r = await craftRecipe(a, bed, 1, signal);
            if (r.cancelled || signal.aborted) return { how: 'more' };
            if (count(a, n => n.endsWith('_bed')) > before) return end(`Made a ${bed.replace(/_/g, ' ')}.`);
            return failed(/resources/i.test(r.message) ? 'missing_logs' : 'stuck', r.message);
        },
        left: () => 1,
    };
}

/** intoKitRunner: craft the tool (one more than carried), then put one into the home chest's kit. */
export function intoKitRunner(job: JobOf<'craft'>, deps: JobDeps): JobStepper {
    const inner = craftRunner(job, deps);
    const p = job.progress as { made?: boolean };
    return {
        async step(f, signal): Promise<StepResult> {
            if (!p.made) {
                const r = await inner.step(f, signal);
                if (r.how === 'more' || r.end.how !== 'done') return r;
                p.made = true;
                deps.checkpoint?.();
            }
            const a = deps.act();
            if (!a) return notInGame;
            const home = homeChest(a, deps);
            if (!home) return failed('no_spot', "I don't have a home chest for the kit.");
            const left = await depositAtHome(a, home, [{ name: job.spec.item, count: 1 }], signal);
            if (signal.aborted) return { how: 'more' };
            if (left === null) return failed('no_spot');
            return left.length ? failed('full', 'The home chest is full.') : end(`Put a ${job.spec.item.replace(/_/g, ' ')} in the kit.`);
        },
        close: () => inner.close?.(),
        left: () => (p.made ? 1 : inner.left?.() ?? null),
    };
}
