// Place a station (crafting table, furnace, chest) on the nearest free space (the old world.getNearestFreeSpace and
// skills.placeBlock), and take a placed station back (dig it, pick it up). The place relies on mineflayer's
// patched 500 ms place timeout: a place that timed out is checked by looking at the block.
import { race, withTimeout } from '../core/abort.js';
import { fail, type Outcome, type Vec3Like } from '../types/index.js';
import type { Act } from './bot.js';
import { goNear } from './approach.js';
import { hold } from './equip.js';
import { digAt, pickupNearby } from './collect.js';
import { settle } from './settle.js';

export const PLACE_RANGE = 8;
export const PLACE_TIMEOUT_MS = 3000;
const REACH = 4.5;

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const centre = (p: Vec3Like) => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });

/**
 * freeSpot: the nearest air block within range with a solid block under it, not where andy stands (a block placed
 * there would push andy) and not right next to andy's middle.
 */
export function freeSpot(a: Act, range = PLACE_RANGE): Vec3Like | null {
    const me = a.bot.entity.position;
    const feet = { x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) };
    const spots = a.bot.findBlocks(['air'], me, range, 1000).sort((p, q) => dist(me, centre(p)) - dist(me, centre(q)));
    for (const p of spots) {
        if (p.x === feet.x && p.z === feet.z && (p.y === feet.y || p.y === feet.y + 1)) continue;
        if (Math.hypot(p.x + 0.5 - me.x, p.z + 0.5 - me.z) < 1.5 && p.y >= feet.y - 1 && p.y <= feet.y + 1) continue;
        const top = a.bot.blockAt(p.x, p.y, p.z), under = a.bot.blockAt(p.x, p.y - 1, p.z);
        if (!top || top.name !== 'air' || !under || under.boundingBox !== 'block') continue;
        return p;
    }
    return null;
}

export type PlaceResult = { ok: true; at: Vec3Like } | { ok: false; outcome: Outcome };

/** placeStation places one carried block (a station) on the nearest free space within range. */
export async function placeStation(a: Act, name: string, signal: AbortSignal, range = PLACE_RANGE): Promise<PlaceResult> {
    if (!a.bot.items().some(i => i.name === name)) return { ok: false, outcome: fail('missing-item', name) };
    const spot = freeSpot(a, range);
    if (!spot) return { ok: false, outcome: fail('no-block', 'no free space') };
    if (dist(a.bot.entity.position, centre(spot)) > REACH) {
        const o = await goNear(a, spot, 3, signal);
        if (!o.ok) return { ok: false, outcome: o };
    }
    if (signal.aborted) return { ok: false, outcome: fail('cancelled') };
    if (!(await hold(a.bot, name))) return { ok: false, outcome: fail('missing-item', name) };
    const under = { x: spot.x, y: spot.y - 1, z: spot.z };
    const t = withTimeout(PLACE_TIMEOUT_MS, signal);
    try {
        try { await a.bot.lookAt(centre(under)); } catch { /* best effort */ }
        // the patched place times out after 500 ms when the block update is late: the block decides
        await race(a.bot.placeBlock(under, { x: 0, y: 1, z: 0 }), t.signal).catch(() => {});
    } finally { t.dispose(); }
    if (signal.aborted) return { ok: false, outcome: fail('cancelled') };
    const placed = await settle(() => a.bot.blockAt(spot.x, spot.y, spot.z)?.name === name, { ms: 1000, quiet: 0, signal });
    return placed ? { ok: true, at: spot } : { ok: false, outcome: fail('error', `${name} not placed`) };
}

/** takeBack digs a station andy placed and picks it up; false when it couldn't (then it stays where it is). */
export async function takeBack(a: Act, at: Vec3Like, name: string, signal: AbortSignal): Promise<boolean> {
    if (a.bot.blockAt(at.x, at.y, at.z)?.name !== name) return false;
    const before = a.bot.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
    if (dist(a.bot.entity.position, centre(at)) > REACH) {
        const o = await goNear(a, at, 3, signal);
        if (!o.ok) return false;
    }
    await hold(a.bot, a.bot.bestTool(at));
    const dug = await digAt(a, at, signal);
    if (!dug.ok) return false;
    await pickupNearby(a, signal);
    return settle(() => a.bot.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0) > before, { ms: 1000, quiet: 0, signal });
}
