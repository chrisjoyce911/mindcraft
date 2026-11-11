// The craft questions (laya-go craft prompt v2): Action, Count and Item, in the golden request's key order.
import type { Questions } from '../../types/models.js';
import { closure, byteSort, listedOthers, NONE, type CraftSituation } from './render.js';

export const ACTIONS = ['craft', 'smelt', 'gather', 'take', 'place', 'store', 'done'] as const;
export type CraftAction = (typeof ACTIONS)[number];
export const isCraftAction = (a: string): a is CraftAction => (ACTIONS as readonly string[]).includes(a);
export const COUNT_OPTIONS = ['1', '2', '3', '4', '6', '8', '12', '16', '24', '32', '48', '64'] as const;

/** itemOptions are the Item question's options: the goal's and the chest's closure, the listed Other items, then none. */
export function itemOptions(s: Pick<CraftSituation, 'goal' | 'have'>): string[] {
    const set = byteSort([...new Set<string>([...closure(s.goal), ...closure('chest')])]);
    return [...set, ...listedOthers(s), NONE];
}

export function craftQuestions(s: Pick<CraftSituation, 'goal' | 'have'>) {
    return {
        Action: { criteria: ACTIONS.slice(), instructions: 'What should I do next?', type: 'choice' },
        Count: { criteria: COUNT_OPTIONS.slice(), instructions: 'How many?', type: 'choice' },
        Item: { criteria: itemOptions(s), instructions: 'Which item?', type: 'choice' },
    } as const satisfies Questions;
}

/** countOption is the smallest option of at least n (64 caps it). */
export function countOption(n: number): string {
    return COUNT_OPTIONS.find(o => Number(o) >= n) ?? '64';
}
