// The home chest (home_chest.js homeState): ok when a chest is at the saved place, gone when the
// block there is loaded and isn't one, unknown when not loaded or not saved. Sensors only report:
// forgetting a gone home and saying so is the director's (3.4).
import type { Places, Vec3Like } from '../types/index.js';
import type { SensorBlock } from './bot.js';

export const CHESTS = ['chest', 'trapped_chest', 'barrel'] as const;
export const HOME_PLACE = 'home_chest';
export type HomeState = 'ok' | 'gone' | 'unknown';

export const isChest = (b: SensorBlock | null | undefined): boolean => !!b && (CHESTS as readonly string[]).includes(b.name);

export function homeState(place: readonly [number, number, number] | null | undefined, blockAt: (x: number, y: number, z: number) => SensorBlock | null): HomeState {
    if (!place) return 'unknown';
    const b = blockAt(Math.floor(place[0]), Math.floor(place[1]), Math.floor(place[2]));
    if (!b) return 'unknown';
    return isChest(b) ? 'ok' : 'gone';
}

/** homeFacts: the home chest's distance (ceil; null when none or gone) and whether it is gone. */
export function homeFacts(places: Places, pos: Vec3Like, blockAt: (x: number, y: number, z: number) => SensorBlock | null): { home: { dist: number } | null; homeGone: boolean } {
    const h = places[HOME_PLACE];
    if (!h) return { home: null, homeGone: false };
    let st: HomeState = 'unknown';
    try { st = homeState(h, blockAt); } catch { /* not loaded */ }
    if (st === 'gone') return { home: null, homeGone: true };
    return { home: { dist: Math.ceil(Math.hypot(h[0] - pos.x, h[1] - pos.y, h[2] - pos.z)) }, homeGone: false };
}
