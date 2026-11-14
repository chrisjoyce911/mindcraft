// The mine answer: Action (a choice), Hazard and Unload (noul) → typed; a malformed reply reads as no answer.
import type { DecideResult } from '../../types/models.js';
import { isMineAction, type MineAction } from './questions.js';

export interface MineAsked {
    /** The Action question's top option. */
    action: MineAction;
    /** Its probability. */
    p: number;
    /** Whether the client found it confident (its min_confidence). */
    confident: boolean;
    /** The Hazard probability (undefined: not answered). */
    hazard?: number;
    /** The Unload answer (v2). */
    unload?: { probability: number; confident: boolean };
    ms: number;
}

/** readMine reads a mine reply; null when there is none or it is malformed. */
export function readMine(r: DecideResult | null): MineAsked | null {
    const a = r?.answers.Action;
    if (!r || !a || a.type === 'noul' || !isMineAction(a.top)) return null;
    const h = r.answers.Hazard, u = r.answers.Unload;
    return {
        action: a.top, p: a.topProbability, confident: a.confident, ms: r.ms,
        ...(h && h.type === 'noul' ? { hazard: h.probability } : {}),
        ...(u && u.type === 'noul' ? { unload: { probability: u.probability, confident: u.confident } } : {}),
    };
}
