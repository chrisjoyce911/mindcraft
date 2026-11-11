// Collect blocks (the old skills.collectBlock) and pick up the items nearby (skills.pickupNearbyItems). The nearest
// matching block first; the fastest carried tool; path to where the block is in reach and in sight; dig; pick up
// the drops. Never the block under andy's feet with a drop of more than 3 under it; water and lava only as
// source blocks (with a bucket). An abort ends the collect: it never goes on to the next block (fix round 3).
import { race, isAborted, withTimeout, timedOut } from '../core/abort.js';
import type { Outcome, Vec3Like } from '../types/index.js';
import type { Act, ActBlock, ActEntity } from './bot.js';
import type { GoToOptions } from '../core/motion.js';
import { hold } from './equip.js';
import { floorDrop } from './floor.js';
import { wait } from './settle.js';

export const COLLECT_RANGE = 64;
export const DIG_TIMEOUT_MS = 20000;
export const REACH_TIMEOUT_MS = 30000;
export const PICKUP_RANGE = 8;
export const PICKUP_TIMEOUT_MS = 5000;

export interface CollectOptions {
    /** Positions never to collect (unripe wheat). */
    exclude?: readonly Vec3Like[];
    /** A further test of a candidate block (wheat: ripe only). */
    accept?: (b: ActBlock, p: Vec3Like) => boolean;
}
export interface CollectResult { collected: number; message: string; cancelled: boolean }

const LIQUIDS = new Set(['water', 'lava']);
const ORE_NAMES = new Set(['coal', 'diamond', 'emerald', 'iron', 'gold', 'lapis_lazuli', 'redstone']);
const same = (a: Vec3Like, b: Vec3Like) => a.x === b.x && a.y === b.y && a.z === b.z;
const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** blockTypes: the block names a collect of blockType takes (coal: its ore too; an ore: its deepslate one; …). */
export function blockTypes(blockType: string): string[] {
    const types = [blockType];
    if (ORE_NAMES.has(blockType)) types.push(`${blockType}_ore`);
    if (blockType.endsWith('ore')) types.push(`deepslate_${blockType}`);
    if (blockType === 'dirt') types.push('grass_block');
    if (blockType === 'cobblestone') types.push('stone');
    return types;
}

/** nextToLiquid: digging the block at p would let water or lava flow (pathfinder's safeToBreak with dontCreateFlow). */
function nextToLiquid(a: Act, p: Vec3Like): boolean {
    for (const [dx, dy, dz] of [[0, 1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const b = a.bot.blockAt(p.x + dx, p.y + dy, p.z + dz);
        if (b && LIQUIDS.has(b.name)) return true;
    }
    return false;
}

/** dig digs the block at p, settling at once on an abort (the dig is stopped). */
export async function digAt(a: Act, p: Vec3Like, signal: AbortSignal, ms = DIG_TIMEOUT_MS): Promise<Outcome> {
    const t = withTimeout(ms, signal);
    try {
        await race(a.bot.dig(p), t.signal, () => { try { a.bot.stopDigging(); } catch { /* not digging */ } });
        return { ok: true };
    } catch (e) {
        if (signal.aborted || (isAborted(e) && !timedOut(t.signal))) return { ok: false, reason: 'cancelled' };
        if (timedOut(t.signal)) return { ok: false, reason: 'timeout', detail: 'dig' };
        return { ok: false, reason: 'error', detail: e instanceof Error ? e.message : String(e) };
    } finally { t.dispose(); }
}

/** pickupNearby walks to each item on the ground within range, nearest first, until none is left or one won't come. */
export async function pickupNearby(a: Act, signal: AbortSignal, range = PICKUP_RANGE, go: GoToOptions = {}): Promise<number> {
    const nearest = (): ActEntity | null => {
        let best: ActEntity | null = null;
        const me = a.bot.entity.position;
        for (const e of Object.values(a.bot.entities)) {
            if (e.name !== 'item' || dist(me, e.position) >= range) continue;
            if (!best || dist(me, e.position) < dist(me, best.position)) best = e;
        }
        return best;
    };
    let item = nearest(), picked = 0;
    for (let i = 0; item && i < 16 && !signal.aborted; i++) {
        const o = await a.motion.goTo(a.goals.follow(item, 1), signal, { timeoutMs: PICKUP_TIMEOUT_MS, ...go });
        if (!o.ok && o.reason === 'cancelled') break;
        if (!(await wait(200, signal))) break;
        const prev = item;
        item = nearest();
        if (item && item.id === prev.id) break;
        picked++;
    }
    return picked;
}

/** collectBlocks collects num blocks of blockType (and its kin, blockTypes). */
export async function collectBlocks(a: Act, blockType: string, num: number, signal: AbortSignal, opts: CollectOptions = {}): Promise<CollectResult> {
    if (!(num >= 1)) return { collected: 0, message: `Invalid number of blocks to collect: ${num}.`, cancelled: false };
    const types = blockTypes(blockType);
    const liquid = LIQUIDS.has(blockType);
    const failed: Vec3Like[] = [...(opts.exclude ?? [])];
    const at = (x: number, y: number, z: number) => a.bot.blockAt(x, y, z);
    let collected = 0;
    let note: string | null = null;
    for (let i = 0; i < num; i++) {
        if (signal.aborted) break;
        const me = a.bot.entity.position;
        const block = a.bot.findBlocks(types, me, COLLECT_RANGE, 256)
            .filter(p => !failed.some(f => same(f, p)))
            .sort((p, q) => dist(me, p) - dist(me, q))
            .find(p => {
                const b = a.bot.blockAt(p.x, p.y, p.z);
                if (!b || !types.includes(b.name)) return false;
                if (floorDrop(at, me, p)) return false;
                if (opts.accept && !opts.accept(b, p)) return false;
                if (liquid) return b.metadata === 0;
                return !nextToLiquid(a, p);
            });
        if (!block) {
            note = collected === 0 ? `No ${blockType} nearby to collect.` : `No more ${blockType} nearby to collect.`;
            break;
        }
        if (liquid) {
            if (!(await hold(a.bot, 'bucket'))) return { collected, message: `Don't have bucket to harvest ${blockType}.`, cancelled: false };
        } else {
            await hold(a.bot, a.bot.bestTool(block));
            if (!a.bot.canHarvest(block)) return { collected, message: `Don't have right tools to harvest ${blockType}.`, cancelled: false };
        }
        const reach = await a.motion.goTo(a.goals.lookAt(block), signal, { timeoutMs: REACH_TIMEOUT_MS });
        if (signal.aborted || (!reach.ok && reach.reason === 'cancelled')) break;
        if (!reach.ok) { failed.push(block); continue; }
        if (liquid) {
            try { await a.bot.lookAt({ x: block.x + 0.5, y: block.y + 0.5, z: block.z + 0.5 }); a.bot.activateItem(); collected++; } catch { failed.push(block); }
            continue;
        }
        const dug = await digAt(a, block, signal);
        // an interrupt makes the dig fail: stop, don't go for the next block
        if (signal.aborted || (!dug.ok && dug.reason === 'cancelled')) break;
        if (!dug.ok) { failed.push(block); continue; }
        collected++;
        await pickupNearby(a, signal);
    }
    const done = `Collected ${collected} ${blockType}.`;
    return { collected, message: note ? `${note} ${done}` : done, cancelled: signal.aborted };
}
