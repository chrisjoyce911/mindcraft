// The follow job's moves (the old skills.followPlayerWithLaya stepTo and fallback), through Motion.
import type { Outcome } from '../types/index.js';
import type { Act, ActEntity } from './bot.js';

/**
 * stepTo walks into the block column (x, z) (GoalXZ: x and z only, so a misread height can't make the step
 * unreachable). ok once the bot stands in that column; stuck after ms; cancelled on abort.
 */
export function stepTo(a: Act, x: number, z: number, ms: number, signal: AbortSignal): Promise<Outcome> {
    const inColumn = () => { const p = a.bot.entity.position; return Math.floor(p.x) === x && Math.floor(p.z) === z; };
    return a.motion.moveUntil(a.goals.xz(x, z), ms, inColumn, signal);
}

/** followFor chases the entity with the ordinary pathfinder follow for ms (the fallback), then clears the goal. */
export function followFor(a: Act, entity: ActEntity, distance: number, ms: number, signal: AbortSignal): Promise<Outcome> {
    return a.motion.moveFor(a.goals.follow(entity, distance), ms, signal);
}
