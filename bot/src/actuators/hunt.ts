// Hunting one mob (the old skills.attackNearest's find and attackEntity's kill loop): the nearest mob of a kind
// within HUNT_RANGE, and killEntity, which fights it (fight: hold the best weapon, close in through Motion, strike)
// until it is gone or the ceiling passes. Not bot.pvp: every wait takes the signal and the walk uses Motion's moves.
// No choice is made here: the hunt job (5.4) or the hunt skill model (5.5) says what to kill.
import { fail, OK, type Outcome, type Vec3Like } from '../types/index.js';
import { sleep, timedOut, withTimeout } from '../core/abort.js';
import type { Act, ActEntity } from './bot.js';
import { bestWeapon } from './equip.js';
import { fight, STRIKE_REACH } from './fight.js';

/** How far a hunt looks for its mob (the old getNearbyEntities(bot, 24)). */
export const HUNT_RANGE = 24;
/** The longest one kill may take. */
export const KILL_CEILING_MS = 30_000;
/** The pause after a strike, so the next one hits at full strength (a sword's cooldown is 625 ms). */
export const STRIKE_GAP_MS = 650;

const dist = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** nearestMob: the nearest live entity named mob within range of andy, or null. */
export function nearestMob(a: Act, mob: string, range = HUNT_RANGE): ActEntity | null {
    const me = a.bot.entity;
    let best: ActEntity | null = null;
    for (const e of Object.values(a.bot.entities)) {
        if (e.name !== mob || e.username === a.bot.username || e.isValid === false) continue;
        const d = dist(me.position, e.position);
        if (d > range) continue;
        if (!best || d < dist(me.position, best.position)) best = e;
    }
    return best;
}

/** alive: the entity is still in the world (it leaves bot.entities when it dies). */
const alive = (a: Act, e: ActEntity): boolean => {
    const now = a.bot.entities[String(e.id)];
    return !!now && now.isValid !== false;
};

/**
 * killEntity fights e until it leaves the world (OK), the ceiling passes (timeout) or the signal aborts (cancelled).
 * A mob that runs beyond HUNT_RANGE fails unreachable.
 */
export async function killEntity(a: Act, e: ActEntity, signal: AbortSignal, ceilingMs = KILL_CEILING_MS): Promise<Outcome> {
    if (signal.aborted) return fail('cancelled');
    const t = withTimeout(ceilingMs, signal);
    try {
        const weapon = bestWeapon(a.bot.items().map(i => i.name));
        while (alive(a, e)) {
            if (signal.aborted) return fail('cancelled');
            if (t.signal.aborted) return fail('timeout', 'kill');
            const now = a.bot.entities[String(e.id)] ?? e;
            if (dist(a.bot.entity.position, now.position) > HUNT_RANGE) return fail('unreachable', `${e.name ?? 'mob'} ran off`);
            const o = await fight(a, now, weapon, t.signal);
            if (signal.aborted) return fail('cancelled');
            if (timedOut(t.signal)) return fail('timeout', 'kill');
            if (!o.ok && o.reason !== 'cancelled') return o;
            const after = a.bot.entities[String(e.id)];
            if (after && dist(a.bot.entity.position, after.position) <= STRIKE_REACH) {
                try { await sleep(STRIKE_GAP_MS, t.signal); } catch { /* the loop's checks say why */ }
            }
        }
        return OK;
    } finally { t.dispose(); }
}
