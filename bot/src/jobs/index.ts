// The jobs (4.2: follow, come, stay, give, store, home; 5.1: craft, gather; 5.2: mine; 5.3: farm; 5.4: hunt). makeRunner
// builds a job's runner; null for the kinds that arrive later (eat as a job: not yet).
import type { JobState, JobStepper } from '../types/index.js';
import type { JobDeps, JobOf } from './deps.js';
import { followRunner } from './follow.js';
import { comeRunner } from './come.js';
import { stayRunner } from './stay.js';
import { giveRunner } from './give.js';
import { storeRunner } from './store.js';
import { homeRunner } from './home.js';
import { craftRunner } from './craft.js';
import { mineRunner } from './mine.js';
import { farmRunner } from './farm.js';
import { huntRunner } from './hunt.js';

export * from './deps.js';
export { summary, newCounters, followRunner, type FollowCounters, type FollowStepper } from './follow.js';
export { craftRunner, craftStep, makeItem, type CraftWorld, type CraftProgress, type CraftRunContext } from './craft.js';
export { jobFailedMessage } from './message.js';
export { mineRunner, MineRun, mineSummary, newMineCounters, type MineWorld, type MineProgress, type MineRunContext, type MineCounters, type MineEnd, type MineStep } from './mine.js';
export { mineWorld, homeFinder, makeOrCraft } from './mineWorld.js';
export { farmRunner, FarmRun, farmSummary, newFarmCounters, FARM_OFF, type FarmWorld, type FarmProgress, type FarmRunContext, type FarmCounters, type FarmEnd, type FarmStep } from './farm.js';
export { farmWorld } from './farmWorld.js';
export { huntRunner, huntStep, maxTries, type HuntWorld, type HuntProgress, type HuntRunContext } from './hunt.js';
export { huntWorld } from './huntWorld.js';

export function makeRunner(job: JobState, deps: JobDeps): JobStepper | null {
    const s = job.spec;
    switch (s.kind) {
        case 'follow': return followRunner(job as JobOf<'follow'>, deps);
        case 'come': return comeRunner(job as JobOf<'come'>, deps);
        case 'stay': return stayRunner(job as JobOf<'stay'>, deps);
        case 'give': return giveRunner(job as JobOf<'give'>, deps);
        case 'store': return storeRunner(job as JobOf<'store'>, deps);
        case 'home': return homeRunner(job as JobOf<'home'>, deps);
        case 'craft': return craftRunner(job as JobOf<'craft'>, deps);
        case 'gather': return craftRunner(job as JobOf<'gather'>, deps);
        case 'mine': return mineRunner(job as JobOf<'mine'>, deps);
        case 'farm': return farmRunner(job as JobOf<'farm'>, deps);
        case 'hunt': return huntRunner(job as JobOf<'hunt'>, deps);
        default: return null;
    }
}
