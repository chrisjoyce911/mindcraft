// The director's answer: the Activity answer word → Activity, or why the rules decide instead.

import { ACTIVITIES, type Activity, type FallbackWhy } from '../../types/decisions.js';
import type { DecideResult } from '../../types/models.js';
import type { DirectorSituation } from './render.js';

export type DirectorRead =
    | { ok: true; activity: Activity; p: number }
    | { ok: false; why: FallbackWhy; model?: string; p?: number };

const isActivity = (a: string): a is Activity => (ACTIVITIES as readonly string[]).includes(a);

/**
 * refusal says why an answer can't be acted on: defend with neither the bot nor a player attacked
 * (v1.3), or eat at full hunger (Minecraft won't let him). null when it can.
 */
export function refusal(s: DirectorSituation, activity: string): 'nothing-to-defend' | 'not-hungry' | null {
    if (activity === 'defend' && !s.me?.attacked && !s.player?.attacked) return 'nothing-to-defend';
    if (activity === 'eat' && s.food >= 20) return 'not-hungry';
    return null;
}

/** read checks a director reply: a confident, known, actable Activity, or why not (the old nextActivity's order). */
export function read(result: DecideResult | null, s: DirectorSituation): DirectorRead {
    const a = result?.answers.Activity;
    if (!result || !a) return { ok: false, why: 'no-answer' };
    const nothing = refusal(s, a.top);
    if (nothing) return { ok: false, why: nothing, model: a.top, p: a.topProbability };
    if (!isActivity(a.top)) return { ok: false, why: 'malformed', model: a.top, p: a.topProbability };
    if (!a.confident) return { ok: false, why: 'low-confidence', model: a.top, p: a.topProbability };
    return { ok: true, activity: a.top, p: a.topProbability };
}
