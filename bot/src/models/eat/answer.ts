// The eat answer: Eat (noul) and Food (choice) → whether and what to eat, or why the rules decide
// instead. The checks and their order are the old bot's eat.js decide(): confident, the two answers
// agree, then laya-go's safety-critical rules (safety).

import type { EatVeto, FallbackWhy } from '../../types/decisions.js';
import type { DecideResult } from '../../types/models.js';
import { foodOptions } from './questions.js';
import { foodInfo, isFood, NONE, type EatSituation, type FoodName } from './render.js';
import { EMERGENCY } from './rules.js';

/** safety returns null when eating food is allowed in situation s, or the reason it isn't. */
export function safety(s: EatSituation, food: FoodName): EatVeto | null {
    if (!s.carry.some(c => c.food === food)) return 'not-carried';
    const f = foodInfo(food);
    const emergencyApple = (food === 'golden_apple' || food === 'enchanted_golden_apple') && s.health <= EMERGENCY;
    if (emergencyApple) return null;
    if (f.tag === 'rare') return 'rare';
    if (s.danger) return 'danger';
    if (s.food >= 20) return 'full';
    if (f.tag === 'bad' && s.food > 6) return 'bad';
    return null;
}

/** What the model said, for the log line (the old eat log's eat, food, p and ms). */
export interface EatAsked { eatP: number; food: string; p: number; ms: number; model: string }

export type EatRead =
    | { ok: true; eat: boolean; food: FoodName | null; asked: EatAsked }
    | { ok: false; why: FallbackWhy; veto?: EatVeto; asked?: EatAsked };

/** read checks an eat reply against the situation it was asked about. */
export function read(result: DecideResult | null, s: EatSituation): EatRead {
    const eatA = result?.answers.Eat, foodA = result?.answers.Food;
    if (!result || !eatA || !foodA || eatA.type !== 'noul') return { ok: false, why: 'no-answer' };
    const asked: EatAsked = { eatP: eatA.probability, food: foodA.top, p: foodA.topProbability, ms: result.ms, model: result.model };
    if (!(foodOptions(s) as string[]).includes(foodA.top)) return { ok: false, why: 'malformed', asked };
    if (!eatA.confident || !foodA.confident) return { ok: false, why: 'low-confidence', asked };
    const wantsEat = eatA.probability > 0.5;
    if (wantsEat !== (foodA.top !== NONE)) return { ok: false, why: 'disagree', asked };
    if (!wantsEat || !isFood(foodA.top)) return { ok: true, eat: false, food: null, asked };
    const veto = safety(s, foodA.top);
    if (veto) return { ok: false, why: 'veto', veto, asked };
    return { ok: true, eat: true, food: foodA.top, asked };
}
