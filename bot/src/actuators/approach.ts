// Go near an entity or a place (defend-player: go to the attacked player) through Motion.
import type { Outcome, Vec3Like } from '../types/index.js';
import type { Act, ActEntity } from './bot.js';

export const APPROACH_CEILING_MS = 15000;

/** goNear paths to within range of where the target is now (a moving player: the caller asks again). */
export function goNear(a: Act, target: ActEntity | Vec3Like, range: number, signal: AbortSignal, ceilingMs = APPROACH_CEILING_MS): Promise<Outcome> {
    const p = 'position' in target ? target.position : target;
    return a.motion.goTo(a.goals.near(p, range), signal, { timeoutMs: ceilingMs });
}
