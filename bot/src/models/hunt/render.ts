// The hunt state (laya-go games/hunt State, prompt v1; skills-spec v1 §2), byte for byte:
//
//   Hunt.
//   Goal food 32 have 12
//   Animals cow 3 9 E pig 1 22 N sheep 0 none none chicken 2 30 S rabbit 0 none none
//   Drops 2 3 W
//   Search 49
//
// Values outside the spec are refused (an Error), as Go refuses them: the sensor clamps, not the renderer.
import { MAX_DIST, MAX_HAVE, isSearch, seenText, type Search, type Seen } from '../skill/index.js';

export const VERSION = 'v1';
import { HUNT_KINDS, type HuntKind } from '../../types/skills.js';
export { HUNT_KINDS, type HuntKind };
export const isHuntKind = (s: string): s is HuntKind => (HUNT_KINDS as readonly string[]).includes(s);

/** Everything the hunt model sees. */
export interface HuntSituation {
    /** Food to have (carried + home chest). */
    goal: number;
    have: number;
    /** Adults of each kind within the search. */
    animals: Readonly<Record<HuntKind, Seen>>;
    /** Food drops on the ground within 16. */
    drops: Seen;
    search: Search;
}

export function huntState(s: HuntSituation): string {
    if (!Number.isInteger(s.goal) || s.goal < 1 || s.goal > MAX_HAVE || !Number.isInteger(s.have) || s.have < 0 || s.have > MAX_HAVE || !isSearch(s.search)) {
        throw new Error(`bad hunt state: goal ${s.goal} have ${s.have} search ${s.search}`);
    }
    const animals = HUNT_KINDS.map(k => `${k} ${seenText(s.animals[k], MAX_DIST, 'hunt')}`).join(' ');
    return ['Hunt.', `Goal food ${s.goal} have ${s.have}`, `Animals ${animals}`, `Drops ${seenText(s.drops, MAX_DIST, 'hunt')}`, `Search ${s.search}`].join('\n');
}
