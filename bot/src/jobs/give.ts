// The give job (the old skills.giveToPlayer and its messages).
import type { JobStepper, StepResult } from '../types/index.js';
import { giveTo } from '../actuators/give.js';
import { notFound, type JobDeps, type JobOf } from './deps.js';

const failed = (say: string): StepResult => ({ how: 'end', end: { how: 'failed', reason: say }, say });

/**
 * A give's progress: once tossed, never toss again (a runner is rebuilt on resume; this is all it keeps). tossing is
 * set and checkpointed to disk right before the toss, so a restart never restores a give whose items may be gone.
 */
export interface GiveProgress { tossing?: boolean; tossed?: number; received?: boolean }

/** The pickup wait still running when a give paused after its toss (not saved: ≤ COLLECT_MS long). */
const pickups = new WeakMap<object, Promise<boolean>>();

const neverReceived = (item: string, username: string) => failed(`Failed to give ${item} to ${username}, it was never received.`);

export function giveRunner(job: JobOf<'give'>, deps: JobDeps): JobStepper {
    const { player: username, item, count } = job.spec;
    return {
        async step(_f, signal): Promise<StepResult> {
            const p = job.progress as GiveProgress;
            if (p.tossed) {
                // resumed after a pause that came after the toss: end on what the pickup wait saw
                const pending = pickups.get(p);
                if (p.received === undefined && pending) p.received = await pending;
                return p.received ? { how: 'end', end: { how: 'done' }, say: `${username} received ${item}.` } : neverReceived(item, username);
            }
            const a = deps.act();
            if (!a) return failed('not in game');
            if (a.bot.username === username) return failed('You cannot give items to yourself.');
            const player = a.bot.player(username);
            if (!player) return failed(notFound(username));
            const held = a.bot.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
            if (!held) return failed(`You do not have any ${item}.`);
            if (p.tossing) return neverReceived(item, username); // a toss that never returned: never toss again
            const r = await giveTo(a, player, username, item, count > 0 ? count : held, signal, () => {
                p.tossing = true;
                deps.checkpoint?.();
            });
            if (r.ok) return { how: 'end', end: { how: 'done' }, say: `${username} received ${item}.` };
            if ('tossed' in r) {
                p.tossed = r.tossed;
                const seen = r.collected.then(v => { p.received = v; pickups.delete(p); return v; });
                pickups.set(p, seen);
                deps.checkpoint?.();
                return { how: 'more' };
            }
            if (signal.aborted || r.why === 'cancelled') return { how: 'more' };
            if (r.why === 'no-item' && p.tossing) delete p.tossing; // nothing left andy
            if (r.why === 'no-item') return failed(`You do not have any ${item}.`);
            if (r.why === 'too close') return failed(`Failed to give ${item} to ${username}, too close.`);
            return neverReceived(item, username);
        },
    };
}
