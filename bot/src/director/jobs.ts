// What the director needs of a job: run its next step under the lease. The runners are jobs/ (4.2 on);
// tests may pass a fake. A runner keeps its own progress (entry.progress), so a resumed job goes on from it.
import type { JobStepper } from '../types/index.js';
import type { JobEntry } from './stack.js';

export type { StepResult } from '../types/index.js';

export interface JobRunner extends JobStepper {
    readonly entry?: JobEntry;
}

/** makeRunner builds the runner of a job on the stack; null when its kind isn't built yet. */
export type RunnerFactory = (entry: JobEntry) => JobRunner | null;
