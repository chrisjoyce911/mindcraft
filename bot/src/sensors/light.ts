// Light and time: the light at the feet (block light, or sky light by day), night, and a roof
// overhead (the old agent's _directorSituation).
import type { SensorBot } from './bot.js';

export const NIGHT_FROM = 13000;
export const NIGHT_TO = 23000;
/** How far up a roof is looked for. */
export const ROOF_SCAN = 64;

/** isNight: the director's night, timeOfDay in [13000, 23000). */
export const isNight = (time: number): boolean => time >= NIGHT_FROM && time < NIGHT_TO;

export function lightFacts(bot: SensorBot): { light: number; night: boolean; under: boolean; time: number } {
    const p = bot.entity.position;
    const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
    const here = bot.blockAt(fx, fy, fz);
    const time = bot.time?.timeOfDay ?? 6000;
    const night = isNight(time);
    let under = false;
    for (let dy = 2; dy <= ROOF_SCAN && !under; dy++) under = bot.blockAt(fx, fy + dy, fz)?.boundingBox === 'block';
    return { light: Math.max(here?.light ?? 0, night ? 0 : (here?.skyLight ?? 0)), night, under, time };
}
