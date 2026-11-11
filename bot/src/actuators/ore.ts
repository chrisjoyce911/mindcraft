// Collect one ore block (the old skills.collectOreAt): path to where it is in reach and in sight with the safe
// movements (out of water and lava, never off a drop of more than 3), over a hollow never standing on top of it;
// never dig it from on top when there is a drop under it; the best tool that can harvest it; dig; then make sure
// its drop reached the pack (pickUpDrop: wait, fetch the item left lying with the safe movements, up to 3 times). Also dig one block of a
// mine step (the old mine dig dep) and walk to a mine cell (the old moveTo dep: GoalBlock, safe movements).
import type { Vec3Like } from '../types/index.js';
import { floorDrop, hollowUnder, MAX_SAFE_DROP, pickUpDrop } from '../models/mine/geometry.js';
import type { Act, ActEntity } from './bot.js';
import { digAt } from './collect.js';
import { hold } from './equip.js';
import { wait } from './settle.js';

export const ORE_TIMEOUT_MS = 30000;
export const FETCH_TIMEOUT_MS = 4000;
export const ORE_REACH = 5;

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const centre = (p: Vec3Like) => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });

export interface OreResult { ok: boolean; cancelled: boolean; message?: string }

/** carried: how many of item andy carries. */
export const carried = (a: Act, item: string): number => a.bot.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);

/** collectOreAt digs the ore block at o (one of names) and picks up its drop; ok when the drop is in the pack. */
export async function collectOreAt(a: Act, o: Vec3Like, names: readonly string[], drop: string, signal: AbortSignal, ms = ORE_TIMEOUT_MS): Promise<OreResult> {
    const at = (x: number, y: number, z: number) => a.bot.blockAt(x, y, z);
    const block = at(o.x, o.y, o.z);
    if (!block || !names.includes(block.name)) return { ok: false, cancelled: false };
    // a cave under the ore: stand anywhere but on top of it
    const goal = hollowUnder(at, o, MAX_SAFE_DROP) ? a.goals.lookAtNotOn(o) : a.goals.lookAt(o);
    const reach = await a.motion.goTo(goal, signal, { timeoutMs: ms, safe: true });
    if (signal.aborted || (!reach.ok && reach.reason === 'cancelled')) return { ok: false, cancelled: true };
    if (dist(a.bot.entity.position, centre(o)) > ORE_REACH) return { ok: false, cancelled: false };
    if (floorDrop(at, a.bot.entity.position, o, MAX_SAFE_DROP)) {
        return { ok: false, cancelled: false, message: `Not digging the ${block.name} under my feet at ${o.x} ${o.y} ${o.z}: there is a drop under it.` };
    }
    await hold(a.bot, a.bot.bestTool(o));
    if (!a.bot.canHarvest(o)) return { ok: false, cancelled: false };
    const before = carried(a, drop);
    const dug = await digAt(a, o, signal);
    if (signal.aborted || (!dug.ok && dug.reason === 'cancelled')) return { ok: false, cancelled: true };
    if (!dug.ok) return { ok: false, cancelled: false };
    const c = centre(o);
    const got = await pickUpDrop<ActEntity>({
        count: () => carried(a, drop), before,
        findItem: () => {
            let best: ActEntity | null = null;
            for (const e of Object.values(a.bot.entities)) {
                if (e.name !== 'item' || dist(e.position, c) >= 4) continue;
                if (!best || dist(a.bot.entity.position, e.position) < dist(a.bot.entity.position, best.position)) best = e;
            }
            return best;
        },
        // the fetch keeps the safe movements too (the old collectOreAt swapped them back only after pickUpDrop)
        fetch: item => a.motion.goTo(a.goals.near(item.position, 0.5), signal, { timeoutMs: FETCH_TIMEOUT_MS, safe: true }),
        sleep: t => wait(t, signal),
    });
    if (signal.aborted) return { ok: got, cancelled: true };
    if (!got) {
        const full = a.bot.emptySlots?.() === 0 ? ' (my pack is full)' : '';
        return { ok: false, cancelled: false, message: `Broke ${block.name} but couldn't pick up the ${drop}${full}.` };
    }
    return { ok: true, cancelled: false };
}

/** digBlock digs one block of a mine step: air (nothing to dig) is done; ok when it is gone. */
export async function digBlock(a: Act, p: Vec3Like, signal: AbortSignal): Promise<boolean> {
    const b = a.bot.blockAt(p.x, p.y, p.z);
    if (!b || b.boundingBox === 'empty') return true;
    await hold(a.bot, a.bot.bestTool(p));
    const o = await digAt(a, p, signal);
    return o.ok;
}

/**
 * walkTo walks to the mine cell c (GoalBlock) with the safe movements, for at most ms; ok when andy ends in that
 * column within one block of its height (the old moveTo's check).
 */
export async function walkTo(a: Act, c: Vec3Like, ms: number, signal: AbortSignal): Promise<{ ok: boolean; cancelled: boolean }> {
    const o = await a.motion.goTo(a.goals.block(c), signal, { timeoutMs: ms, safe: true });
    if (signal.aborted || (!o.ok && o.reason === 'cancelled')) return { ok: false, cancelled: true };
    const p = a.bot.entity.position;
    return { ok: Math.floor(p.x) === c.x && Math.floor(p.z) === c.z && Math.abs(Math.floor(p.y) - c.y) <= 1, cancelled: false };
}
