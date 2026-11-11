// The come job (the old skills.goToPlayer): path to within distance (≥ 0.5) of the player, once.
import type { JobStepper, StepResult } from '../types/index.js';
import { notFound, type JobDeps, type JobOf } from './deps.js';

export const COME_CEILING_MS = 60000;

export function comeRunner(job: JobOf<'come'>, deps: JobDeps): JobStepper {
    const { player: username, distance } = job.spec;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return { how: 'end', end: { how: 'failed', reason: 'not in game' } };
            if (a.bot.username === username) return { how: 'end', end: { how: 'done' }, say: `You are already at ${username}.` };
            const player = a.bot.player(username);
            if (!player) return { how: 'end', end: { how: 'failed', reason: notFound(username) }, say: notFound(username) };
            const o = await a.motion.goTo(a.goals.follow(player, Math.max(distance, 0.5)), signal, { timeoutMs: COME_CEILING_MS });
            if (signal.aborted) return { how: 'more' };
            if (o.ok) return { how: 'end', end: { how: 'done' }, say: `You have reached ${username}.` };
            const why = `Could not reach ${username}: ${o.reason}.`;
            return { how: 'end', end: { how: 'failed', reason: why }, say: why };
        },
    };
}
