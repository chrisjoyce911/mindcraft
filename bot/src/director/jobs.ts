// What the director needs of a job: run its next step under the lease. The real jobs arrive in phase 4;
// tests use a fake. A runner keeps its own progress (entry.progress), so a resumed job goes on from it.
import type { Facts, JobEnd } from '../types/index.js';
import type { JobEntry } from './stack.js';

export type StepResult = { how: 'more' } | { how: 'end'; end: JobEnd };

export interface JobRunner {
    readonly entry: JobEntry;
    /** step does one bounded piece of the job; it settles ≤ 250 ms after the signal aborts. */
    step(facts: Facts, signal: AbortSignal): Promise<StepResult>;
}

/** makeRunner builds the runner of a job on the stack (phase 4's jobs/); null when the kind isn't built yet. */
export type RunnerFactory = (entry: JobEntry) => JobRunner | null;
