// The store job (the old skills.putInChest): put count (≤ what andy carries; 0 or less: all) of an item into
// the nearest chest within 32 (any chest, not only the home chest: the old behaviour).
import type { JobStepper, StepResult } from '../types/index.js';
import { nearestChest } from '../home/chest.js';
import { deposit } from '../actuators/chest.js';
import type { JobDeps, JobOf } from './deps.js';

export const STORE_RANGE = 32;

const failed = (say: string): StepResult => ({ how: 'end', end: { how: 'failed', reason: say }, say });

/**
 * A store's progress: how many are in the chest so far, and what andy held when a deposit started that a pause
 * cut short (on resume, what left the inventory since went in). A resumed store never deposits more than asked.
 */
export interface StoreProgress { deposited?: number; heldAtDeposit?: number }

export function storeRunner(job: JobOf<'store'>, deps: JobDeps): JobStepper {
    const { item, count } = job.spec;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return failed('not in game');
            const p = job.progress as StoreProgress;
            const held = a.bot.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
            if (p.heldAtDeposit !== undefined) {
                p.deposited = (p.deposited ?? 0) + Math.max(0, p.heldAtDeposit - held);
                delete p.heldAtDeposit;
            }
            const done = p.deposited ?? 0;
            const stored = (): StepResult => ({ how: 'end', end: { how: 'done' }, say: `Successfully put ${p.deposited} ${item} in the chest.` });
            if (count > 0 && done >= count) return stored();
            const pos = a.bot.entity.position;
            const chest = nearestChest(a.bot.findBlocks(['chest'], pos, STORE_RANGE, 16), pos, STORE_RANGE);
            if (!chest) return failed('Could not find a chest nearby.');
            if (!held) return done ? stored() : failed(`You do not have any ${item} to put in the chest.`);
            const n = count > 0 ? Math.min(count - done, held) : held;
            p.heldAtDeposit = held;
            const o = await deposit(a, chest, item, n, signal);
            if (o.ok) {
                delete p.heldAtDeposit;
                p.deposited = done + n;
                return stored();
            }
            if (signal.aborted || o.reason === 'cancelled') return { how: 'more' };
            delete p.heldAtDeposit;
            return failed(`Could not put ${item} in the chest: ${o.reason}.`);
        },
    };
}
