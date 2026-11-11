// The gather state (laya-go games/gather State, prompt v1; skills-spec v1 §3), byte for byte:
//
//   Gather.
//   Goal logs 16 have 4
//   Source tree 3 7 E
//   Drops 3 2 N
//   Shears no Free 20
//   Search 49
//
// Values outside the spec are refused (an Error): the sensor clamps.
import { MAX_DIST, MAX_HAVE, isSearch, seenText, type Search, type Seen } from '../skill/index.js';

export const VERSION = 'v1';
import { GATHER_GOALS, type GatherGoal } from '../../types/jobs.js';
export { GATHER_GOALS, type GatherGoal };
export const isGatherGoal = (s: string): s is GatherGoal => (GATHER_GOALS as readonly string[]).includes(s);
/** Each goal's source word. */
export const SOURCES: Readonly<Record<GatherGoal, string>> = { logs: 'tree', seeds: 'grass', wool: 'sheep', saplings: 'sapling' };
import { DROPS_RANGE, MAX_FREE } from '../../types/skills.js';
export { DROPS_RANGE, MAX_FREE };

export interface GatherSituation {
    goal: GatherGoal;
    /** How many to have (carried + home chest; logs count as wood). */
    want: number;
    have: number;
    /** The goal's source within the search. */
    source: Seen;
    /** The goal's items on the ground within 16. */
    drops: Seen;
    shears: boolean;
    /** Empty main inventory slots. */
    free: number;
    search: Search;
}

export function gatherState(s: GatherSituation): string {
    if (!isGatherGoal(s.goal) || !Number.isInteger(s.want) || s.want < 1 || s.want > MAX_HAVE || !Number.isInteger(s.have) || s.have < 0
        || s.have > MAX_HAVE || !Number.isInteger(s.free) || s.free < 0 || s.free > MAX_FREE || !isSearch(s.search)) {
        throw new Error(`bad gather state: ${JSON.stringify(s)}`);
    }
    const src = seenText(s.source, MAX_DIST, 'gather');
    const drops = seenText(s.drops, DROPS_RANGE, 'gather');
    return [
        'Gather.',
        `Goal ${s.goal} ${s.want} have ${s.have}`,
        `Source ${s.source.count > 0 ? SOURCES[s.goal] : 'none'} ${src}`,
        `Drops ${drops}`,
        `Shears ${s.shears ? 'yes' : 'no'} Free ${s.free}`,
        `Search ${s.search}`,
    ].join('\n');
}
