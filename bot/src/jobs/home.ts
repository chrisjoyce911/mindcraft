// The home job (the old !setHomeChest): the chest nearest the player who spoke (else andy) within 8 becomes
// the home chest; a player's home replaces a table home and the chores centre. One instant step.
import type { JobStepper, StepResult } from '../types/index.js';
import { CHESTS, HOME_PLACE, HOME_REPLACES, nearestChest, SET_RANGE } from '../home/chest.js';
import type { JobDeps, JobOf } from './deps.js';

export const NO_CHEST = "I can't see a chest near you.";

export function homeRunner(job: JobOf<'home'>, deps: JobDeps): JobStepper {
    return {
        async step(): Promise<StepResult> {
            const a = deps.act();
            if (!a) return { how: 'end', end: { how: 'failed', reason: 'not in game' } };
            const speaker = job.by ? a.bot.player(job.by) : null;
            const at = (speaker ?? a.bot.entity).position;
            const c = nearestChest(a.bot.findBlocks(CHESTS, at, SET_RANGE, 32), at, SET_RANGE);
            if (!c) return { how: 'end', end: { how: 'failed', reason: NO_CHEST }, say: NO_CHEST };
            deps.places.remember(HOME_PLACE, c);
            for (const p of HOME_REPLACES) deps.places.forget(p);
            return { how: 'end', end: { how: 'done' }, say: `Home chest set at ${c.x} ${c.y} ${c.z}.` };
        },
    };
}
