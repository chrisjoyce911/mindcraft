// Facts → the eat situation (eat_state.js situation; modes.js fed danger as "a hostile nearer than 8, or lava
// within 2").
import type { Facts } from '../../types/index.js';
import { carried, type EatSituation } from './render.js';

/** A hostile nearer than this (strict, as getNearestEntityWhere(isHostile, 8)'s `distanceTo < 8`) is Danger. */
export const EAT_DANGER_REACH = 8;

export function eatSituation(f: Facts): EatSituation {
    return {
        health: Math.max(1, Math.floor(f.health)),
        food: f.food,
        saturation: f.saturation,
        danger: f.mobs.some(m => m.dist < EAT_DANGER_REACH) || f.lavaWithin2,
        carry: carried(f.items),
    };
}
