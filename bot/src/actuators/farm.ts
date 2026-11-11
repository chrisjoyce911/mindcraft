// The farm acts in the game (the old farm_actions.js): reach a cell with the farm movements (no parkour, no sprint,
// no digging, farmland and crops avoided, so andy never tramples a field), and harvest, plant, till, water, dig a
// pond, bone meal or breed. Water goes into a hole dug in dry farmland or ground, so it can't flow onto crops: a cell
// whose sides would let water out is refused (floods). Till and plant are checked in the world (until), as is the
// pour (an item use aimed at the top of the block below, not a block activation). Every wait takes the signal.
import type { Vec3Like } from '../types/index.js';
import { CROP_BLOCKS, KINDS, type AnimalKind, type CellAction } from '../models/farm/data.js';
import type { Act, ActEntity } from './bot.js';
import { digAt, pickupNearby, PICKUP_RANGE } from './collect.js';
import { hold } from './equip.js';
import { wait } from './settle.js';

export const REACH_MS = 30000;
export const REACH_RANGE = 3;
/** A path that only crosses the field fails: within this of the cell, andy acts from where he stands. */
export const REACH_FALLBACK = 4.5;
export const UNTIL_MS = 1500;
export const WATER_REACH = 3;

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const up = { x: 0, y: 1, z: 0 };
const above = (p: Vec3Like): Vec3Like => ({ x: p.x, y: p.y + 1, z: p.z });

/** reach walks within REACH_RANGE of p with the farm movements; true there, or when it failed within REACH_FALLBACK. */
export async function reach(a: Act, p: Vec3Like, signal: AbortSignal): Promise<boolean> {
    const o = await a.motion.goTo(a.goals.near(p, REACH_RANGE), signal, { timeoutMs: REACH_MS, farm: true });
    if (signal.aborted) return false;
    return o.ok || dist(a.bot.entity.position, p) <= REACH_FALLBACK;
}

/** A block as floods reads it. */
export type BoxAt = (x: number, y: number, z: number) => { boundingBox?: string } | null | undefined;

/** floods: water placed at pos (a hole) could flow out: a side at that level isn't solid. */
export function floods(blockAt: BoxAt, pos: Vec3Like): boolean {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const b = blockAt(pos.x + dx, pos.y, pos.z + dz);
        if (!b || b.boundingBox !== 'block') return true;
    }
    return false;
}

/**
 * until polls cond every 100 ms until it holds or ms pass (the world and the inventory update a moment after an
 * act); false on an abort.
 */
export async function until(cond: () => boolean, ms = UNTIL_MS, signal?: AbortSignal, sleep: (t: number, signal?: AbortSignal) => Promise<boolean> = wait): Promise<boolean> {
    for (let waited = 0; ; waited += 100) {
        if (cond()) return true;
        if (waited >= ms || signal?.aborted) return false;
        if (!(await sleep(100, signal))) return false;
    }
}

/** pourInto pours the held water bucket into the hole at pos: look at the top of the block below, use the item. */
export async function pourInto(a: Act, pos: Vec3Like, signal: AbortSignal): Promise<boolean> {
    await a.bot.lookAt({ x: pos.x + 0.5, y: pos.y + 0.05, z: pos.z + 0.5 }, true);
    if (signal.aborted) return false;
    a.bot.activateItem();
    return until(() => a.bot.blockAt(pos.x, pos.y, pos.z)?.name === 'water', UNTIL_MS, signal);
}

/** ADULT_HEIGHT: babies are about half an adult's height. */
const ADULT_HEIGHT: Readonly<Record<AnimalKind, number>> = { cow: 1.4, sheep: 1.3, pig: 0.9, chicken: 0.7 };
export function isBaby(e: ActEntity): boolean {
    const kind = e.name as AnimalKind;
    return typeof e.height === 'number' && e.height < 0.75 * (ADULT_HEIGHT[kind] ?? 0);
}

/** An animal near andy (for the view and breeding). */
export interface NearAnimal { kind: AnimalKind; x: number; z: number; baby: boolean; entity: ActEntity }

export function animalsNear(a: Act): NearAnimal[] {
    return Object.values(a.bot.entities)
        .filter(e => e.position && (KINDS as readonly string[]).includes(e.name ?? ''))
        .map(e => ({ kind: e.name as AnimalKind, x: Math.floor(e.position.x), z: Math.floor(e.position.z), baby: isBaby(e), entity: e }));
}

/** holdItem holds an item (hoe: any hoe carried). */
async function holdItem(a: Act, item: string): Promise<boolean> {
    const name = item === 'hoe' ? a.bot.items().find(i => i.name.endsWith('_hoe'))?.name : item;
    return !!name && hold(a.bot, name);
}

const isAir = (a: Act, p: Vec3Like) => { const b = a.bot.blockAt(p.x, p.y, p.z); return !b || b.name === 'air' || b.name === 'cave_air'; };

/** digIt digs the block at p unless it's air; true when it's gone. A crop is never dug this way (only a harvest takes it). */
async function digIt(a: Act, p: Vec3Like, signal: AbortSignal): Promise<boolean> {
    if (isAir(a, p)) return true;
    if (CROP_BLOCKS.includes(a.bot.blockAt(p.x, p.y, p.z)?.name as never)) return false;
    const o = await digAt(a, p, signal);
    return o.ok;
}

/** breed feeds the two nearest adults of a kind; true when both were fed. */
export async function breed(a: Act, kind: AnimalKind, food: string, signal: AbortSignal): Promise<boolean> {
    const me = a.bot.entity.position;
    const herd = animalsNear(a).filter(x => x.kind === kind && !x.baby)
        .sort((p, q) => dist(me, p.entity.position) - dist(me, q.entity.position));
    let fed = 0;
    for (const x of herd.slice(0, 2)) {
        if (!(await reach(a, x.entity.position, signal)) || !(await holdItem(a, food))) break;
        if (signal.aborted) return false;
        try { await a.bot.activateEntity(x.entity); } catch { break; }
        fed++;
    }
    return fed === 2;
}

/** farmAct carries out a cell action at the ground block (the crop goes on top of it). */
export async function farmAct(a: Act, action: CellAction, ground: Vec3Like, item: string, signal: AbortSignal): Promise<boolean> {
    const crop = above(ground);
    const at = (p: Vec3Like) => a.bot.blockAt(p.x, p.y, p.z);
    if (!(await reach(a, ground, signal))) return false;
    switch (action) {
        case 'harvest': {
            const o = await digAt(a, crop, signal);
            if (!o.ok) return false;
            if (!signal.aborted) await pickupNearby(a, signal, PICKUP_RANGE, { farm: true });
            return true;
        }
        case 'plant':
            if (!(await holdItem(a, item)) || signal.aborted) return false;
            try { await a.bot.activateBlock(ground, up); } catch { return false; }
            return until(() => CROP_BLOCKS.includes(at(crop)?.name as never), UNTIL_MS, signal);
        case 'till':
            // grass or a flower on top first
            if (!(await digIt(a, crop, signal)) || !(await holdItem(a, 'hoe')) || signal.aborted) return false;
            try { await a.bot.activateBlock(ground, up); } catch { return false; }
            return until(() => at(ground)?.name === 'farmland', UNTIL_MS, signal);
        case 'water':
        case 'pond': {
            if (floods((x, y, z) => a.bot.blockAt(x, y, z), ground)) return false;
            if (action === 'pond' && !(await digIt(a, crop, signal))) return false; // grass or a flower on top
            if (!(await digIt(a, ground, signal)) || !(await holdItem(a, 'water_bucket')) || signal.aborted) return false;
            return pourInto(a, ground, signal);
        }
        case 'bone_meal':
            if (!(await holdItem(a, 'bone_meal')) || signal.aborted) return false;
            try { await a.bot.activateBlock(crop, up); } catch { return false; }
            return true;
    }
}

/** waterSource: the nearest water source block within radius, or null. */
export function waterSource(a: Act, radius: number): Vec3Like | null {
    const me = a.bot.entity.position;
    return a.bot.findBlocks(['water'], me, radius, 256)
        .filter(p => a.bot.blockAt(p.x, p.y, p.z)?.metadata === 0)
        .sort((p, q) => dist(me, p) - dist(me, q))[0] ?? null;
}

/** fillBucket walks to the water at w and fills a carried bucket; true when a water bucket is in the pack. */
export async function fillBucket(a: Act, w: Vec3Like, signal: AbortSignal): Promise<boolean> {
    const buckets = () => a.bot.items().filter(i => i.name === 'water_bucket').reduce((n, i) => n + i.count, 0);
    const before = buckets();
    await a.motion.goTo(a.goals.near(w, WATER_REACH), signal, { timeoutMs: 60000, safe: true });
    if (signal.aborted || !(await hold(a.bot, 'bucket'))) return false;
    await a.bot.lookAt({ x: w.x + 0.5, y: w.y + 0.5, z: w.z + 0.5 }, true);
    if (signal.aborted) return false;
    a.bot.activateItem(); // a bucket is an item use, not a block activation
    return until(() => buckets() > before, UNTIL_MS, signal);
}
