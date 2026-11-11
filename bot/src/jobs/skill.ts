// What the skill jobs (5.5: huntFood, gatherSkill, place) share: their settings and log, the end results with a
// typed FailReason (design §11.3: the chores Last line reads failed:<reason> from JobEnd.reason), the step bound
// and the stuck check (the same step on the same state again and again: farm 5.3's "a done step repeated on the same
// state fails", here for every step).
import type { SkillFailReason, StepResult } from '../types/index.js';
import { skillLine, type SkillLogInput, type SkillLogTask, type SkillOutcome } from '../log/jsonl.js';
import { SKILL_DEFAULTS, type JobDeps, type SkillSettings } from './deps.js';

/** A step repeated on the same state this many times in a row ends the run stuck. */
export const STUCK_REPEATS = 3;

/** The step bound of a hunt or gather run (a run that keeps going without reaching the goal ends timeout). */
export const maxSkillSteps = (goal: number): number => 4 * goal + 20;

/** The stuck check's memory (in the job's progress). */
export interface Repeat { key: string; n: number }

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
