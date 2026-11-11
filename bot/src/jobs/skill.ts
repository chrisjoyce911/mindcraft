// What the skill jobs (5.5: huntFood, gatherSkill, place) share: their settings and log, the end results with a
// typed FailReason (design §11.3: the chores Last line reads failed:<reason> from JobEnd.reason), the step bound
// and the stuck check (the same step on the same state again and again: farm 5.3's "a done step repeated on the same
// state fails", here for every step).
import type { SkillFailReason, StepResult, Vec3Like } from '../types/index.js';
import { skillLine, type SkillLogInput, type SkillLogTask, type SkillOutcome } from '../log/jsonl.js';
import { SKILL_DEFAULTS, type JobDeps, type SkillSettings } from './deps.js';

/** A step repeated on the same state this many times in a row ends the run stuck. */
export const STUCK_REPEATS = 3;

/** Steps a run may take per item of its goal: most goals give an item or more per act. */
export const STEPS_PER_ITEM = 4;
/** Seeds: short grass drops a seed about 1 cut in 8, and a cut may need an approach first. */
export const SEED_STEPS_PER_ITEM = 16;

/** The step bound of a hunt or gather run (a run that keeps going without reaching the goal ends timeout). */
export const maxSkillSteps = (goal: number, perItem: number = STEPS_PER_ITEM): number => perItem * goal + 20;

/** The stuck check's memory (in the job's progress). */
export interface Repeat { key: string; n: number }

/**
 * worked: the step's act did its work (a kill, a cut, a shear): the stuck count starts again, since the same state
 * after a working act is progress the state can't show (a cut grass without a seed, a count capped at 9).
 */
export function worked(p: { repeat?: Repeat }): void { delete p.repeat; }

/** repeated: counts this (state, answer) and says whether it has now come STUCK_REPEATS times in a row. */
export function repeated(p: { repeat?: Repeat }, state: string, words: Readonly<Record<string, string>>): boolean {
    const key = `${state}\n${Object.values(words).join(' ')}`;
    p.repeat = p.repeat?.key === key ? { key, n: p.repeat.n + 1 } : { key, n: 1 };
    return p.repeat.n >= STUCK_REPEATS;
}

/** Ground items a collect left lying (unreachable: on leaves, in a hole) are this many at most in the progress. */
export const MAX_SKIPPED = 32;

/**
 * collectAndSkip: pick up, then remember the wanted items within reach that are still lying there: the sensors leave
 * them out from now on (as collectBlocks' failed list), so an item andy can't reach doesn't hold the run.
 */
export async function collectAndSkip(p: { skip?: number[] }, wanted: () => readonly { id: number }[], collect: (signal: AbortSignal) => Promise<number>, signal: AbortSignal): Promise<void> {
    const before = new Set(wanted().map(g => g.id));
    await collect(signal);
    if (signal.aborted) return;
    const left = wanted().filter(g => before.has(g.id)).map(g => g.id);
    if (left.length) p.skip = [...(p.skip ?? []), ...left].slice(-MAX_SKIPPED);
}

/** Sources an act failed on (unreachable trees, grass, animals) are this many at most in the progress. */
export const MAX_SKIPPED_SOURCES = 32;

/** skipSource: remember a source the act failed on (a block position key or an entity id); the sensors leave it out. */
export function skipSource<T>(list: T[] | undefined, key: T): T[] {
    return [...(list ?? []).filter(k => k !== key), key].slice(-MAX_SKIPPED_SOURCES);
}
export const posKey = (p: Vec3Like): string => `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;

export const skillSettings = (deps: JobDeps, task: SkillLogTask) => (): SkillSettings =>
    deps.skill?.(task) ?? { ...SKILL_DEFAULTS, enabled: false, model: null };

/** The log of one skill job: writes a line when log_steps. */
export function skillLogger(deps: JobDeps, task: SkillLogTask, settings: () => SkillSettings) {
    return (d: SkillLogInput, outcome: SkillOutcome, reason?: string) => {
        if (settings().log_steps) deps.skillLog?.(task, skillLine(d, outcome, reason));
    };
}

export const skillDone = (say: string): StepResult => ({ how: 'end', end: { how: 'done' }, say });
export const skillFailed = (reason: SkillFailReason | 'not in game', say: string): StepResult => ({ how: 'end', end: { how: 'failed', reason }, say });
