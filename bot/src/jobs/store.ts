// The store job (the old skills.putInChest): put count (≤ what andy carries; 0 or less: all) of an item into
// the nearest chest within 32 (any chest, not only the home chest: the old behaviour).
import type { JobStepper, StepResult } from '../types/index.js';
import { nearestChest } from '../home/chest.js';
import { deposit } from '../actuators/chest.js';
import type { JobDeps, JobOf } from './deps.js';

export const STORE_RANGE = 32;

const failed = (say: string): StepResult => ({ how: 'end', end: { how: 'failed', reason: say }, say });

export function storeRunner(job: JobOf<'store'>, deps: JobDeps): JobStepper {
    const { item, count } = job.spec;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return failed('not in game');
            const pos = a.bot.entity.position;
            const chest = nearestChest(a.bot.findBlocks(['chest'], pos, STORE_RANGE, 16), pos, STORE_RANGE);
            if (!chest) return failed('Could not find a chest nearby.');
            const held = a.bot.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
            if (!held) return failed(`You do not have any ${item} to put in the chest.`);
            const n = count > 0 ? Math.min(count, held) : held;
            const o = await deposit(a, chest, item, n, signal);
            if (signal.aborted) return { how: 'more' };
            if (o.ok) return { how: 'end', end: { how: 'done' }, say: `Successfully put ${n} ${item} in the chest.` };
            return failed(`Could not put ${item} in the chest: ${o.reason}.`);
        },
    };
}
