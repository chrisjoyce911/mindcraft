// The chores v2 answer (design §11.3): the Skill and Target words → a typed run. A pair outside v2.go Pairs is
// malformed (null): the rules decide in its place.
import type { Words } from '../skill/index.js';
import {
    CHORE_ASKS, CHORE_CRAFTS, CHORE_GATHERS, CHORE_MINES, CHORE_PLACES, isChorePair,
    type ChoreAsk, type ChoreCraft, type ChoreMine, type ChoreSkill, type ChoreTarget,
} from '../../types/chores.js';
import type { GatherGoal, PlaceItem } from '../../types/jobs.js';

export type ChoresAnswer =
    | { skill: 'hunt'; target: 'food' }
    | { skill: 'farm'; target: 'start' | 'tend' }
    | { skill: 'gather'; target: GatherGoal }
    | { skill: 'mine'; target: ChoreMine }
    | { skill: 'craft'; target: ChoreCraft }
    | { skill: 'place'; target: PlaceItem }
    | { skill: 'cook'; target: 'none' }
    | { skill: 'store'; target: 'unload' | 'kit' }
    | { skill: 'sleep'; target: 'none' }
    | { skill: 'ask'; target: ChoreAsk }
    | { skill: 'rest'; target: 'none' };

const among = <T extends string>(list: readonly T[], t: string): t is T => (list as readonly string[]).includes(t);

/** readChores: the words as a typed answer, or null when the pair isn't one of Pairs. */
export function readChores(w: Words): ChoresAnswer | null {
    const k = w.Skill ?? '', t = w.Target ?? '';
    if (!isChorePair(k, t)) return null;
    switch (k as ChoreSkill) {
        case 'hunt': return { skill: 'hunt', target: 'food' };
        case 'farm': return { skill: 'farm', target: t as 'start' | 'tend' };
        case 'gather': return among(CHORE_GATHERS, t) ? { skill: 'gather', target: t } : null;
        case 'mine': return among(CHORE_MINES, t) ? { skill: 'mine', target: t } : null;
        case 'craft': return among(CHORE_CRAFTS, t) ? { skill: 'craft', target: t } : null;
        case 'place': return among(CHORE_PLACES, t) ? { skill: 'place', target: t } : null;
        case 'cook': return { skill: 'cook', target: 'none' };
        case 'store': return { skill: 'store', target: t as 'unload' | 'kit' };
        case 'sleep': return { skill: 'sleep', target: 'none' };
        case 'ask': return among(CHORE_ASKS, t) ? { skill: 'ask', target: t } : null;
        case 'rest': return { skill: 'rest', target: 'none' };
    }
}

/** choresWords: an answer's Skill and Target words. */
export const choresWords = (a: ChoresAnswer): { Skill: ChoreSkill; Target: ChoreTarget } => ({ Skill: a.skill, Target: a.target });
