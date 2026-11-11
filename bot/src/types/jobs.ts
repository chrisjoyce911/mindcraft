import type { Facts } from './facts.js';
// Job specs (design §3.1, §11.3). The legacy parser and the command model both produce these.
export const ORES = ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond'] as const;
export type Ore = (typeof ORES)[number];
export const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroot'] as const;
export type Crop = (typeof CROPS)[number];
export type ItemName = string;
export type MobName = string;

export type JobSpec =
    | { kind: 'follow'; player: string; distance: number }
    | { kind: 'come'; player: string; distance: number }
    | { kind: 'stay'; seconds: number }                       // -1 = until told otherwise
    | { kind: 'mine'; ore: Ore; count: number | 'forever' }
    | { kind: 'farm'; crop: Crop | 'any'; goal: { count: number } | 'forever' }
    | { kind: 'craft'; item: ItemName; count: number; legacy?: 'craftRecipe' }
    | { kind: 'gather'; item: ItemName; count: number; legacy?: 'collectBlocks' }
    | { kind: 'hunt'; mob: MobName; item: ItemName | null; count: number }
    | { kind: 'give'; player: string; item: ItemName; count: number }
    | { kind: 'store'; item: ItemName; count: number }
    | { kind: 'eat'; item: ItemName }
    | { kind: 'home' };
export type JobKind = JobSpec['kind'];
export type JobOrigin = 'player' | 'chore';
export interface JobState<P = unknown> {
    id: string; spec: JobSpec; origin: JobOrigin; by?: string; progress: P;
    status: 'running' | 'paused'; startedAt: number;
    /** When an activity or a stop paused it. */
    pausedAt?: number;
}
export type JobEnd = { how: 'done' } | { how: 'failed' | 'blocked'; reason: string } | { how: 'cancelled' };

/** A runner's step result; an end may carry what andy says (the old action's output line). */
export type StepResult = { how: 'more' } | { how: 'end'; end: JobEnd; say?: string };

/** What runs a job (jobs/): one bounded piece per step; it settles ≤ 250 ms after the signal aborts. */
export interface JobStepper {
    step(facts: Facts, signal: AbortSignal): Promise<StepResult>;
    /** Called once when this run of the job ends (done, failed, paused, replaced or stopped). */
    close?(): void;
    /** How many are left (the director's Job line), null when it can't say. */
    left?(): number | null;
}

/**
 * A job as bots/<name>/laya-job.json keeps it (design §5.5; 4.3). by and startedAt are kept too: the end lines
 * name the player, and stay measures from startedAt (the time andy was down counts toward the stay).
 */
export interface SavedJob {
    spec: JobSpec; origin: JobOrigin; by?: string; progress: unknown;
    status: 'running' | 'paused'; startedAt: number;
}
/** laya-job.json: the player's jobs on the stack, bottom first, and when they were saved. */
export interface JobFile { savedAt: number; entries: SavedJob[] }
