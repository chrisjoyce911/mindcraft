// The base centre for the place skill (5.5): the home chest's place, else the home table's, else the saved chores
// centre, else where andy stands. A stand-in for 5.6, which ports the old chooseCentre (bed, chest, table, the
// player's placed blocks, the saved centre) and replaces this one function.
import type { Vec3Like } from '../types/index.js';
import type { PlaceBook } from './places.js';
import { HOME_PLACE } from './chest.js';

export const CENTRE_PLACES = [HOME_PLACE, 'home_table', 'chores_centre'] as const;

export function baseCentre(places: PlaceBook, me: Vec3Like): Vec3Like {
    for (const name of CENTRE_PLACES) {
        const p = places.recall(name);
        if (p) return { x: Math.floor(p[0]), y: Math.floor(p[1]), z: Math.floor(p[2]) };
    }
    return { x: Math.floor(me.x), y: Math.floor(me.y), z: Math.floor(me.z) };
}
