// The follow questions (laya-go follow prompt v1 and v2): Hazard (noul) and Move (choice), in the golden
// request's key order.

import type { Questions } from '../../types/models.js';
import { MOVES } from './render.js';

export const FOLLOW_QUESTIONS = {
    Hazard: { criteria: null, instructions: 'A hazard is next to me.', type: 'noul' },
    Move: { criteria: MOVES, instructions: 'Which way should I step?', type: 'choice' },
} as const satisfies Questions;
