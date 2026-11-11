// Hunt rules v1 and Harmful (laya-go games/hunt Decide, Harmful), the first that applies:
//   1. done: have ≥ goal.
//   2. collect: drops within 8.
//   3. attack / approach: the nearest huntable kind (count ≥ 3, or any when have < 8: the last two may go only when
//      hungry; ties in kind order): attack within 3, else approach.
//   4. search: widen while Search < 193.
//   5. give-up.
import type { Words } from '../skill/index.js';
import { HUNT_KINDS, type HuntKind, type HuntSituation } from './render.js';

export const HUNT_RULES = ['done', 'collect', 'attack', 'approach', 'search', 'give-up'] as const;
export type HuntRule = (typeof HUNT_RULES)[number];

export const HUNGRY = 8;
export const REACH = 3;
export const PICKUP = 8;

const huntable = (s: HuntSituation, k: HuntKind) => {
    const a = s.animals[k];
    return a.count >= 3 || (a.count >= 1 && s.have < HUNGRY);
};

/** prey: the nearest huntable kind, or null (ties: the first in kind order). */
export function prey(s: HuntSituation): HuntKind | null {
    let best: HuntKind | null = null;
    for (const k of HUNT_KINDS) {
        if (huntable(s, k) && (best === null || s.animals[k].dist < s.animals[best].dist)) best = k;
    }
    return best;
}

export function huntRules(s: HuntSituation): { words: Words; rule: HuntRule } {
    const w = (Action: string, Target: string, rule: HuntRule) => ({ words: { Action, Target }, rule });
    if (s.have >= s.goal) return w('done', 'none', 'done');
    if (s.drops.count > 0 && s.drops.dist <= PICKUP) return w('collect', 'drops', 'collect');
    const p = prey(s);
    if (p !== null) return s.animals[p].dist <= REACH ? w('attack', p, 'attack') : w('approach', p, 'approach');
    if (s.search < 193) return w('search', 'none', 'search');
    return w('give_up', 'none', 'give-up');
}

/** huntHarmful: killing one of the last two of a kind when not hungry, or stopping short of the goal with prey or drops in reach. */
export function huntHarmful(s: HuntSituation, got: Words): boolean {
    const a = got.Action;
    if (a === 'attack' || a === 'approach') {
        const t = got.Target ?? '';
        if ((HUNT_KINDS as readonly string[]).includes(t) && s.animals[t as HuntKind].count <= 2 && s.have >= HUNGRY) return true;
    }
    const stop = a === 'done' || a === 'give_up';
    return stop && s.have < s.goal && (prey(s) !== null || (s.drops.count > 0 && s.drops.dist <= PICKUP));
}
