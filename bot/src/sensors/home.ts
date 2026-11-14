// The home chest (home_chest.js homeState): ok when a chest is at the saved place, gone when the
// block there is loaded and isn't one, unknown when not loaded or not saved. Sensors only report:
// forgetting a gone home and saying so is the director's (3.4).
import type { Places, Vec3Like } from '../types/index.js';
import { HOME_PLACE, homeState, type HomeState } from '../home/chest.js';
import type { SensorBlock } from './bot.js';

export { CHESTS, HOME_PLACE, homeState, isChest, type HomeState } from '../home/chest.js';

/** homeFacts: the home chest's distance (ceil; null when none or gone) and whether it is gone. */
export function homeFacts(places: Places, pos: Vec3Like, blockAt: (x: number, y: number, z: number) => SensorBlock | null): { home: { dist: number } | null; homeGone: boolean } {
    const h = places[HOME_PLACE];
    if (!h) return { home: null, homeGone: false };
    let st: HomeState = 'unknown';
    try { st = homeState(h, blockAt); } catch { /* not loaded */ }
    if (st === 'gone') return { home: null, homeGone: true };
    return { home: { dist: Math.ceil(Math.hypot(h[0] - pos.x, h[1] - pos.y, h[2] - pos.z)) }, homeGone: false };
}
