// The skill models' shared words (skills-spec v1 §2–4): what the sensors measure and the models render. Here so the
// sensors (below the models) and the models use the same types; models/skill, hunt, gather and place re-export them.
import type { PlaceItem } from './jobs.js';

/** Directions: N is −z, E is +x (Minecraft). */
export const DIRS = ['N', 'E', 'S', 'W'] as const;
export type Dir = (typeof DIRS)[number];
/** The search squares (columns on a side, around the run's start). */
export const SEARCHES = [49, 97, 193] as const;
export type Search = (typeof SEARCHES)[number];
/** Counts are capped at 9 in every state line, distances at 99, have at 999. */
export const MAX_COUNT = 9;
export const MAX_DIST = 99;
export const MAX_HAVE = 999;
/** Free inventory slots: 0–36. */
export const MAX_FREE = 36;
/** Drops are seen within 16. */
export const DROPS_RANGE = 16;

/** What is seen of a kind: how many, the nearest one's distance and direction (count 0: dist −1, dir null). */
export interface Seen { count: number; dist: number; dir: Dir | null }
export const UNSEEN: Readonly<Seen> = Object.freeze({ count: 0, dist: -1, dir: null });

/** The food animals, in the hunt Animals line's order (and the rules' tie order). */
export const HUNT_KINDS = ['cow', 'pig', 'sheep', 'chicken', 'rabbit'] as const;
export type HuntKind = (typeof HUNT_KINDS)[number];

/** The place grid's characters (skills-spec §4). */
export const CELLS = '.:,;#~f=CTFBts@';
export type Cell = '.' | ':' | ',' | ';' | '#' | '~' | 'f' | '=' | 'C' | 'T' | 'F' | 'B' | 't' | 's' | '@';

/** gridSize: the place grid's size and step for an item (torches: the 7×7 lit sample grid at step 3). */
export function gridSize(item: PlaceItem): { n: number; step: number } {
    return item === 'torch' ? { n: 7, step: 3 } : { n: 9, step: 1 };
}
