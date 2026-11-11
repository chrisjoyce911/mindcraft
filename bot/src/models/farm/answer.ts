// The farm answer: Action, Target and Item (choices) and Unload (noul, v2) → typed; a malformed reply reads as no
// answer. Confident is the client's flag (the task's min_confidence).
import type { DecideResult } from '../../types/models.js';
import { isFarmAction, type FarmAction } from './data.js';

export interface FarmAsked {
    action: FarmAction;
    /** The Target question's top option (a cell name, an animal kind or none: the veto checks it). */
    target: string;
    /** The Item question's top option. */
    item: string;
    /** The Action top probability. */
    p: number;
    /** Action and Target are both confident. */
    sure: boolean;
    /** The Unload answer (v2), when asked. */
    unload?: { probability: number; confident: boolean };
    ms: number;
}

/** readFarmAnswer reads a farm reply; null when there is none or it is malformed. */
export function readFarmAnswer(r: DecideResult | null): FarmAsked | null {
    const a = r?.answers.Action, t = r?.answers.Target, i = r?.answers.Item;
    if (!r || !a || !t || !i || a.type === 'noul' || t.type === 'noul' || i.type === 'noul' || !isFarmAction(a.top)) return null;
    const u = r.answers.Unload;
    return {
        action: a.top, target: t.top, item: i.top, p: a.topProbability, sure: a.confident && t.confident, ms: r.ms,
        ...(u && u.type === 'noul' ? { unload: { probability: u.probability, confident: u.confident } } : {}),
    };
}
