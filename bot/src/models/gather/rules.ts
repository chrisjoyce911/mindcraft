// Gather rules v1 and Harmful (laya-go games/gather Decide, Harmful), the first that applies:
//   1. done: have ≥ goal.
//   2. full: no free slot → give_up.
//   3. collect: the goal's drops within 8 (saplings: the source is drops).
//   4. work the source: logs and seeds always; wool with shears, or with no shears when 3 or more sheep (kill,
//      leaving two). Within 4: cut (logs, seeds), shear or kill (wool); further: approach.
//   5. search: widen while Search < 193; else give-up.
import type { Words } from '../skill/index.js';
import type { GatherSituation } from './render.js';

export const GATHER_RULES = ['done', 'full', 'collect', 'cut', 'shear', 'kill', 'approach', 'search', 'give-up'] as const;
export type GatherRule = (typeof GATHER_RULES)[number];

export const REACH = 4;
export const PICKUP = 8;

/** workable: the source can be worked at all. */
export function workable(s: GatherSituation): boolean {
    if (s.source.count === 0 || s.goal === 'saplings') return false;
    return s.goal !== 'wool' || s.shears || s.source.count >= 3;
}

export function gatherRules(s: GatherSituation): { words: Words; rule: GatherRule } {
    const w = (Action: string, rule: GatherRule) => ({ words: { Action }, rule });
    const pickup = s.goal === 'saplings' ? s.source : s.drops;
    if (s.have >= s.want) return w('done', 'done');
    if (s.free === 0) return w('give_up', 'full');
    if (pickup.count > 0 && pickup.dist <= PICKUP) return w('collect', 'collect');
    if (workable(s) && s.source.dist <= REACH) {
        if (s.goal !== 'wool') return w('cut', 'cut');
        if (s.shears) return w('shear', 'shear');
        return w('kill', 'kill');
    }
    if (workable(s) || (s.goal === 'saplings' && s.source.count > 0)) return w('approach', 'approach');
    if (s.search < 193) return w('search', 'search');
    return w('give_up', 'give-up');
}

/** gatherHarmful: killing a sheep with shears carried or two or fewer left; stopping short with something workable. */
export function gatherHarmful(s: GatherSituation, got: Words): boolean {
    switch (got.Action) {
        case 'kill': return s.goal !== 'wool' || s.shears || s.source.count <= 2;
        case 'done': case 'give_up':
            return s.have < s.want && s.free > 0 && (workable(s) || (s.source.count > 0 && s.goal === 'saplings')
                || (s.drops.count > 0 && s.drops.dist <= PICKUP));
        default: return false;
    }
}
