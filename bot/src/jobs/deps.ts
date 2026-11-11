// What the jobs need from the bot: the actuator context, the places, the follow settings and the logs.
import type { JobSpec, JobState, JobStepper, ModelDecider } from '../types/index.js';
import type { Act } from '../actuators/bot.js';
import type { PlaceBook } from '../home/places.js';
import type { FollowLine } from '../log/jsonl.js';
import type { FollowPrompt } from '../models/follow/index.js';

/** decision_models.tasks.follow (the old follow.js DEFAULTS' keys); model null: the task is off. */
export interface FollowSettings {
    step_ms: number;
    fallback_ms: number;
    stuck_ms: number;
    max_waits: number;
    log_steps: boolean;
    prompt: FollowPrompt;
    model: ModelDecider | null;
}
export const FOLLOW_DEFAULTS: Omit<FollowSettings, 'model'> = {
    step_ms: 250, fallback_ms: 4000, stuck_ms: 1500, max_waits: 2, log_steps: true, prompt: 'v1',
};

export interface JobDeps {
    /** The actuator context, or null when not in game. */
    act(): Act | null;
    places: PlaceBook;
    /** The follow task's settings now. */
    follow(): FollowSettings;
    /** Writes a laya-follow.jsonl line. */
    followLog(line: FollowLine): void;
    /** The console. */
    note(text: string): void;
    /**
     * checkpoint writes the jobs' progress to disk now, unthrottled: a job calls it right before an act that
     * can't be undone (a toss, a deposit), so a kill -9 during the act never restores the job as if it hadn't run.
     */
    checkpoint?: () => void;
    now?: () => number;
}

/** A job on the stack as a runner sees it, with its spec narrowed to one kind. */
export type JobOf<K extends JobSpec['kind']> = JobState & { spec: Extract<JobSpec, { kind: K }> };

export type RunnerOf<K extends JobSpec['kind']> = (job: JobOf<K>, deps: JobDeps) => JobStepper;

/** pause waits ms; false as soon as the signal aborts (never rejects). */
export function pause(ms: number, signal: AbortSignal): Promise<boolean> {
    return new Promise(resolve => {
        if (signal.aborted) return resolve(false);
        const t = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(true); }, ms);
        const onAbort = () => { clearTimeout(t); resolve(false); };
        signal.addEventListener('abort', onAbort, { once: true });
    });
}

/** The old messages ("Could not find tester."). */
export const notFound = (player: string) => `Could not find ${player}.`;
