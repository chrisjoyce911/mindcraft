// Run from hostile mobs until none is within `dist` (the old skills.avoidEnemies(bot, 24)): chase an
// inverted follow goal on the nearest one, 500 ms at a time, at most ceilingMs.
import { fail, OK, type Outcome } from '../types/index.js';
import type { Act, ActEntity } from './bot.js';

export const AVOID_DIST = 24;
export const AVOID_CEILING_MS = 10000;
export const AVOID_STEP_MS = 500;

/** nearest: the mob to run from now (the caller's sensor read), or null when none is within dist. */
export type NearestHostile = (dist: number) => ActEntity | null;

export async function avoidMobs(a: Act, nearest: NearestHostile, signal: AbortSignal, dist = AVOID_DIST, ceilingMs = AVOID_CEILING_MS, now = Date.now): Promise<Outcome> {
    const end = now() + ceilingMs;
    for (let mob = nearest(dist); mob; mob = nearest(dist)) {
        if (signal.aborted) return fail('cancelled');
        if (now() >= end) return fail('timeout');
        const o = await a.motion.moveFor(a.goals.invert(a.goals.follow(mob, dist + 1)), AVOID_STEP_MS, signal);
        if (!o.ok) return o;
    }
    return signal.aborted ? fail('cancelled') : OK;
}
