// The give job (the old skills.giveToPlayer and its messages).
import type { JobStepper, StepResult } from '../types/index.js';
import { giveTo } from '../actuators/give.js';
import { notFound, type JobDeps, type JobOf } from './deps.js';

const failed = (say: string): StepResult => ({ how: 'end', end: { how: 'failed', reason: say }, say });

export function giveRunner(job: JobOf<'give'>, deps: JobDeps): JobStepper {
    const { player: username, item, count } = job.spec;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return failed('not in game');
            if (a.bot.username === username) return failed('You cannot give items to yourself.');
            const player = a.bot.player(username);
            if (!player) return failed(notFound(username));
            const held = a.bot.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0);
            if (!held) return failed(`You do not have any ${item}.`);
            const r = await giveTo(a, player, username, item, count > 0 ? count : held, signal);
            if (signal.aborted) return { how: 'more' };
            if (r.ok) return { how: 'end', end: { how: 'done' }, say: `${username} received ${item}.` };
            if (r.why === 'no-item') return failed(`You do not have any ${item}.`);
            if (r.why === 'cancelled') return { how: 'more' };
            return failed(`Failed to give ${item} to ${username}, ${r.why === 'too close' ? 'too close' : 'it was never received'}.`);
        },
    };
}
