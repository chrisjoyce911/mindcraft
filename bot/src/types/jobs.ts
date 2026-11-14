import type { Facts } from './facts.js';
// Job specs (design §3.1, §11.3). The legacy parser and the command model both produce these.
export const ORES = ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond'] as const;
export type Ore = (typeof ORES)[number];
export const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroot'] as const;
export type Crop = (typeof CROPS)[number];
export type ItemName = string;
/** The skill jobs' goals (skills-spec v1 §2–4): what gather collects and what place puts down. */
export const GATHER_GOALS = ['logs', 'seeds', 'wool', 'saplings'] as const;
export type GatherGoal = (typeof GATHER_GOALS)[number];
export const PLACE_ITEMS = ['crafting_table', 'furnace', 'chest', 'bed', 'torch', 'saplings'] as const;
export type PlaceItem = (typeof PLACE_ITEMS)[number];
/**
 * Why a skill run failed (design §11.3; the chores Last line's failed:<reason>): no_source (give_up with nothing
 * left in the widest search), full (no free slot), no_spot (no cell for the thing, or the cell changed),
 * missing_<item> (the thing to place isn't carried), stuck (the same step on the same state again and again),
 * interrupted (cut short and not resumed), timeout (the step bound).
 */
export const SKILL_FAIL_REASONS = ['no_source', 'full', 'no_spot', 'stuck', 'interrupted', 'timeout'] as const;
export type SkillFailReason = (typeof SKILL_FAIL_REASONS)[number] | `missing_${string}`;
export type MobName = string;

export type JobSpec =
    | { kind: 'follow'; player: string; distance: number }
    | { kind: 'come'; player: string; distance: number }
    | { kind: 'stay'; seconds: number }                       // -1 = until told otherwise
    /** until 'day': a chore at night (mine iron from the home staircase until day) ends done when day comes. */
    | { kind: 'mine'; ore: Ore; count: number | 'forever'; until?: 'day' }
    /** goal minutes: timed farming (the old !layaFarm(minutes); the chores' tend and start). */
    | { kind: 'farm'; crop: Crop | 'any'; goal: { count: number } | { minutes: number } | 'forever' }
    /** into 'kit': a chore's kit tool goes into the home chest once made (5.6). */
    | { kind: 'craft'; item: ItemName; count: number; legacy?: 'craftRecipe'; into?: 'kit' }
    | { kind: 'gather'; item: ItemName; count: number; legacy?: 'collectBlocks' }
    | { kind: 'hunt'; mob: MobName; item: ItemName | null; count: number }
    /** The hunt skill (5.5): food to have, carried plus chest (what the home chest holds less the kit, as the caller knows it). */
    | { kind: 'huntFood'; goal: number; chest?: number }
    /** The gather skill (5.5): logs (as wood), seeds, wool or saplings to have, carried plus chest. */
    | { kind: 'gatherSkill'; target: GatherGoal; goal: number; chest?: number }
    /** The place skill (5.5): put one carried thing in the base, where the place model says. */
    | { kind: 'place'; item: PlaceItem }
    | { kind: 'give'; player: string; item: ItemName; count: number }
    | { kind: 'store'; item: ItemName; count: number }
    | { kind: 'eat'; item: ItemName }
    | { kind: 'home' }
    // the chores jobs (5.6, skills-spec v1 §1 Answers): actuators run as one job each
    /** Smelt all carried raw meat in the base furnace. */
    | { kind: 'cook' }
    /** Put the pack into the home chest (tools, food, torches and some throwaway blocks stay). */
    | { kind: 'unload' }
    /** Put cooked food (up to 8) and torches (up to 16) into the kit in the home chest. */
    | { kind: 'kit' }
    /** Sleep in his bed until morning. */
    | { kind: 'sleep' }
    /** Stay near the centre for seconds; ask: say "I need <item>" first (once per item per 5 minutes). */
    | { kind: 'rest'; seconds: number; ask?: AskItem }
    /** Mine count more cobblestone from stone near the surface around the centre. */
    | { kind: 'cobble'; count: number };
/** What a rest asks the player for (the chores ask targets). */
export const ASK_ITEMS = ['logs', 'cobble', 'coal', 'wool', 'food'] as const;
export type AskItem = (typeof ASK_ITEMS)[number];
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
