// Danger: fire, drowning, lava near, falling (director.js dangerOf, read as the old agent's
// _directorSituation did).
import type { Danger } from '../types/index.js';
import type { SensorBlock, SensorBot } from './bot.js';

export interface Feel { onFire?: boolean; inFire?: boolean; oxygen?: number | null; headInWater?: boolean; lavaNear?: boolean; falling?: boolean }

/** dangerOf: the Danger word from what the bot feels. */
export function dangerOf(f: Feel): Danger {
    if (f.onFire || f.inFire) return 'fire';
    if (f.headInWater && f.oxygen != null && f.oxygen < 10) return 'drowning';
    if (f.lavaNear) return 'fluid';
    if (f.falling) return 'fall';
    return 'none';
}

/** The blocks around the feet checked for lava. */
export const LAVA_OFFSETS: readonly (readonly [number, number, number])[] = [
    [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0], [0, 1, 0], [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1], [0, 2, 0],
];
/** Falling: off the ground and dropping faster than this (blocks per tick). */
export const FALL_SPEED = -0.6;

/** feel reads what the bot feels at its feet. */
export function feel(bot: SensorBot): Feel {
    const p = bot.entity.position;
    const fx = Math.floor(p.x), fy = Math.floor(p.y), fz = Math.floor(p.z);
    const at = (dx: number, dy: number, dz: number): SensorBlock | null => bot.blockAt(fx + dx, fy + dy, fz + dz);
    const here = at(0, 0, 0), head = at(0, 1, 0);
    const flags = bot.entity.metadata?.[0];
    return {
        onFire: !!((typeof flags === 'number' ? flags : 0) & 1),
        inFire: /fire$/.test(here?.name ?? ''),
        oxygen: bot.oxygenLevel,
        headInWater: head?.name === 'water',
        lavaNear: LAVA_OFFSETS.some(([x, y, z]) => at(x, y, z)?.name === 'lava'),
        falling: !bot.entity.onGround && (bot.entity.velocity?.y ?? 0) < FALL_SPEED && !(here?.name ?? '').includes('water'),
    };
}
