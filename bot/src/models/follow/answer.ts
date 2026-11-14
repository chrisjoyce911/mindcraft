// The follow answer: Move (choice) and Hazard (noul) → the step to take, or why the job falls back to the
// pathfinder follow (the old follow.js branches: no answer, low confidence). A move word outside the options
// (the client normally refuses those) counts as no answer: the old log's reasons are kept.

import type { DecideResult } from '../../types/models.js';
import { isMove, type Move } from './render.js';

/** What the model said, for the step log (the old line's move, p, hazard and ms). */
export interface FollowAsked { move: string; p: number; hazard: number; ms: number }

export type FollowRead =
    | { ok: true; move: Move; asked: FollowAsked }
    | { ok: false; why: 'no-answer' }
    | { ok: false; why: 'low-confidence'; asked: FollowAsked };

/** read checks a follow reply. */
export function read(result: DecideResult | null): FollowRead {
    const m = result?.answers.Move, h = result?.answers.Hazard;
    if (!result || !m || !h || m.type === 'noul' || h.type !== 'noul') return { ok: false, why: 'no-answer' };
    if (!isMove(m.top)) return { ok: false, why: 'no-answer' };
    const asked: FollowAsked = { move: m.top, p: m.topProbability, hazard: h.probability, ms: result.ms };
    if (!m.confident) return { ok: false, why: 'low-confidence', asked };
    return { ok: true, move: m.top, asked };
}
