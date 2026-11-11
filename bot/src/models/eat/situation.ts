// Facts → the eat situation (eat_state.js situation; modes.js fed danger as "a hostile within 8").
import type { Facts } from '../../types/index.js';
import { carried, type EatSituation } from './render.js';

/** A hostile this near is the eat model's Danger (the old mode's getNearestEntityWhere(isHostile, 8)). */
export const EAT_DANGER_REACH = 8;

export function eatSituation(f: Facts): EatSituation {
    return {
        health: Math.max(1, Math.floor(f.health)),
        food: f.food,
        saturation: f.saturation,
        danger: f.mobs.some(m => m.dist <= EAT_DANGER_REACH),
        carry: carried(f.items),
    };
}
