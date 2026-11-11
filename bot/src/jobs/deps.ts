// What the jobs need from the bot: the actuator context, the places, the follow settings and the logs.
import type { JobSpec, JobState, JobStepper, ModelDecider } from '../types/index.js';
import type { Act } from '../actuators/bot.js';
import type { PlaceBook } from '../home/places.js';
import type { CraftLine, FollowLine, MineLine } from '../log/jsonl.js';
import type { FollowPrompt } from '../models/follow/index.js';
import type { MineBook } from '../home/mines.js';
import { PLAN_DEFAULTS, type PlanOptions } from '../models/mine/plan.js';

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

/** decision_models.tasks.craft (the old craft.js DEFAULTS' keys); enabled false: the task is off. model null: rules only. */
export interface CraftSettings {
    enabled: boolean;
    min_confidence: number;
    max_steps: number;
    log_steps: boolean;
    model: ModelDecider | null;
}
export const CRAFT_DEFAULTS: Omit<CraftSettings, 'model' | 'enabled'> = { min_confidence: 0.3, max_steps: 40, log_steps: true };

export const MINE_PROMPTS = ['v1', 'v2', 'v2.1'] as const;
/** The mine prompt: v1 (no plan), v2 (the plan), v2.1 (v2's prompt with v2.1's rules: the same here). */
export type MinePrompt = (typeof MINE_PROMPTS)[number];

/** decision_models.tasks.mine (the old mine.js DEFAULTS and the plan's keys); enabled false: the task is off. */
export interface MineSettings extends PlanOptions {
    enabled: boolean;
    prompt: MinePrompt;
    /** Steps before giving up (default: v1 300, v2 2000). */
    max_steps: number | null;
    max_failures: number;
    log_steps: boolean;
    torch_batch: number;
    torch_low: number;
    torch_retry_steps: number;
    keep_blocks: number;
    unload_retry_steps: number;
    unload_fail_steps: number;
    collect_range: number;
    collect_budget: number;
    collect_below: number;
    collect_below_open: number;
    walk_restart: number;
    max_abandons: number;
    max_unsafe_restarts: number;
    torch_place_retry: number;
    max_drop: number;
    heal_health: number;
    eat_to: number;
    heal_wait_s: number;
    floor_vetoes: number;
    /** The mine model; null: the rules alone (every step a no-answer fallback, as with a model that's down). */
    model: ModelDecider | null;
}
export const MINE_DEFAULTS: Omit<MineSettings, 'model' | 'enabled'> = {
    ...PLAN_DEFAULTS, prompt: 'v2', max_steps: null,
    max_failures: 4, log_steps: true, torch_batch: 4, torch_low: 4, torch_retry_steps: 50, keep_blocks: 32, unload_retry_steps: 50,
    unload_fail_steps: 200, collect_range: 12, collect_budget: 24, collect_below: 4, collect_below_open: 8, walk_restart: 2, max_abandons: 8,
    max_unsafe_restarts: 3, torch_place_retry: 3, max_drop: 3, heal_health: 8, eat_to: 18, heal_wait_s: 60, floor_vetoes: 2,
};
/** The mine settings' number keys (settings.js may set any). */
export const MINE_NUMBER_KEYS = (Object.keys(MINE_DEFAULTS) as (keyof typeof MINE_DEFAULTS)[])
    .filter(k => typeof MINE_DEFAULTS[k] === 'number') as Exclude<keyof typeof MINE_DEFAULTS, 'prompt' | 'max_steps' | 'log_steps'>[];

export interface JobDeps {
    /** The actuator context, or null when not in game. */
    act(): Act | null;
    places: PlaceBook;
    /** The follow task's settings now. */
    follow(): FollowSettings;
    /** Writes a laya-follow.jsonl line. */
    followLog(line: FollowLine): void;
    /** The craft task's settings now (missing: the task is off). */
    craft?: () => CraftSettings;
    /** Writes a laya-craft.jsonl line. */
    craftLog?: (line: CraftLine) => void;
    /** The mine task's settings now (missing: the task is off). */
    mine?: () => MineSettings;
    /** Writes a laya-mine.jsonl line. */
    mineLog?: (line: MineLine) => void;
    /** The mine memory (bots/<name>/laya-mines.json). */
    mines?: MineBook;
    /** Says something in game (the old chat dep; the mine's start line). */
    chat?: (text: string) => void;
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
