// The defend questions (prompt v1): Action, Danger, Target ("<kind> <n>", then none) and Weapon (the
// carried weapons, then none), in the golden request's key order.

import { DEFEND_ACTIONS } from '../../types/decisions.js';
import type { Questions } from '../../types/models.js';
import { NONE, type DefendSituation, type WeaponName } from './render.js';

export const ACTIONS = DEFEND_ACTIONS;

/** targetOptions are the Target options: "<kind> <n>" (n from 1), then none. */
export const targetOptions = (s: DefendSituation): string[] => [...s.mobs.map((m, i) => `${m.kind} ${i + 1}`), NONE];
/** weaponOptions are the Weapon options: the carried weapons, then none. */
export const weaponOptions = (s: DefendSituation): (WeaponName | typeof NONE)[] => [...s.weapons, NONE];

/** targetIndex is a Target option's mob index, -1 for none, or null when it isn't an option. */
export function targetIndex(s: DefendSituation, option: string): number | null {
    const i = targetOptions(s).indexOf(option);
    if (i < 0) return null;
    return i === s.mobs.length ? -1 : i;
}

/** targetWord is a mob index as its Target option (-1: none). */
export const targetWord = (s: DefendSituation, i: number): string => (i < 0 ? NONE : targetOptions(s)[i] ?? NONE);

export function defendQuestions(s: DefendSituation) {
    return {
        Action: { criteria: ACTIONS, instructions: 'What should I do about the mobs?', type: 'choice' },
        Danger: { criteria: null, instructions: 'I am in danger.', type: 'noul' },
        Target: { criteria: targetOptions(s), instructions: 'Which mob is it about?', type: 'choice' },
        Weapon: { criteria: weaponOptions(s), instructions: 'Which weapon should I hold?', type: 'choice' },
    } as const satisfies Questions;
}
