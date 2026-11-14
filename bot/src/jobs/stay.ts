// The stay job (the old skills.stay): stand still until `seconds` have passed since the job started (−1:
// until told otherwise). The director's safety activities still pause it (design §5.2: safety > job) and
// resume it after; the old stay paused every mode instead.
import type { JobStepper, StepResult } from '../types/index.js';
import { pause, type JobDeps, type JobOf } from './deps.js';

export const STAY_SLICE_MS = 500;

export function stayRunner(job: JobOf<'stay'>, deps: JobDeps): JobStepper {
    const now = deps.now ?? Date.now;
    const { seconds } = job.spec;
    return {
        async step(_f, signal): Promise<StepResult> {
            const elapsed = now() - job.startedAt;
            if (seconds !== -1 && elapsed >= seconds * 1000) {
                return { how: 'end', end: { how: 'done' }, say: `Stayed for ${elapsed / 1000} seconds.` };
            }
            const left = seconds === -1 ? STAY_SLICE_MS : Math.min(STAY_SLICE_MS, seconds * 1000 - elapsed);
            await pause(Math.max(1, left), signal);
            return { how: 'more' };
        },
    };
}
