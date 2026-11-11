// The craft answer: Action, Item and Count (choices) → a typed step and its p = min(Action, Item), or malformed.
import type { DecideResult } from '../../types/models.js';
import { isCraftAction } from './questions.js';
import type { CraftStep } from './rules.js';

/** What the model said, as the craft log keeps it. */
export interface CraftAsked extends CraftStep { p: number; ms: number }

export type CraftRead = { ok: true; asked: CraftAsked } | { ok: false; why: 'malformed' };

/** readCraft reads a craft reply (null: no reply). */
export function readCraft(r: DecideResult): CraftRead {
    const a = r.answers.Action, i = r.answers.Item, c = r.answers.Count;
    if (!a || !i || !c || a.type === 'noul' || i.type === 'noul' || c.type === 'noul') return { ok: false, why: 'malformed' };
    const count = Number(c.top);
    if (!isCraftAction(a.top) || !Number.isFinite(count) || count < 1) return { ok: false, why: 'malformed' };
    return { ok: true, asked: { action: a.top, item: i.top, count, p: Math.min(a.topProbability, i.topProbability), ms: r.ms } };
}
