// The jobs (4.2: follow, come, stay, give, store, home). makeRunner builds a job's runner; null for the kinds
// that arrive later (mine, farm, craft, gather, hunt: 5.x; eat as a job: not yet).
import type { JobState, JobStepper } from '../types/index.js';
import type { JobDeps, JobOf } from './deps.js';
import { followRunner } from './follow.js';
import { comeRunner } from './come.js';
import { stayRunner } from './stay.js';
import { giveRunner } from './give.js';
import { storeRunner } from './store.js';
import { homeRunner } from './home.js';

export * from './deps.js';
export { summary, newCounters, followRunner, type FollowCounters, type FollowStepper } from './follow.js';

export function makeRunner(job: JobState, deps: JobDeps): JobStepper | null {
    const s = job.spec;
    switch (s.kind) {
        case 'follow': return followRunner(job as JobOf<'follow'>, deps);
        case 'come': return comeRunner(job as JobOf<'come'>, deps);
        case 'stay': return stayRunner(job as JobOf<'stay'>, deps);
        case 'give': return giveRunner(job as JobOf<'give'>, deps);
        case 'store': return storeRunner(job as JobOf<'store'>, deps);
        case 'home': return homeRunner(job as JobOf<'home'>, deps);
        default: return null;
    }
}
