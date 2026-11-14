// The eat questions (prompt v1): Eat (noul) and Food (the carried foods in order, then none).

import type { Questions } from '../../types/models.js';
import { NONE, type EatSituation, type FoodName } from './render.js';

export type FoodOption = FoodName | typeof NONE;

/** foodOptions are the Food question's options: the carried foods in order, then none. */
export const foodOptions = (s: EatSituation): FoodOption[] => [...s.carry.map(c => c.food), NONE];

/** eatQuestions returns both questions for a situation, in the golden request's key order. */
export function eatQuestions(s: EatSituation) {
    return {
        Eat: { criteria: null, instructions: 'I should eat now.', type: 'noul' },
        Food: { criteria: foodOptions(s), instructions: 'Which food should I eat?', type: 'choice' },
    } as const satisfies Questions;
}
