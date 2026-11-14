// The Player fact (chores_actions.js playerFact): the nearest player within PLAYER_REACH a mob hit in
// the last 5 s, else the nearest within PLAYER_REACH.
import type { Attack, Facts } from '../types/index.js';
import { ME_MS, type Attacks } from './attacks.js';
import { dist3, type SensorBot } from './bot.js';
import { mobKind } from './mobs.js';

export const PLAYER_REACH = 24;

export function playerFact(bot: SensorBot, attacks: Attacks, now: number): Facts['player'] {
    const me = bot.entity.position;
    let hit: NonNullable<Facts['player']> | null = null, nearest: NonNullable<Facts['player']> | null = null;
    for (const p of Object.values(bot.players)) {
        const e = p.entity;
        if (!e || e === bot.entity || !e.position) continue;
        const d = dist3(e.position, me);
        if (d > PLAYER_REACH) continue;
        const h = attacks.playerHit(p.username, now, ME_MS);
        if (h && (!hit || d < hit.dist)) {
            const a: Attack = { by: mobKind(h.mob.name), entityId: h.mob.id, at: h.at, dist: Math.ceil(dist3(h.mob.position, me)) };
            hit = { name: p.username, attacked: a, dist: d };
        }
        if (!nearest || d < nearest.dist) nearest = { name: p.username, attacked: null, dist: d };
    }
    return hit ?? nearest;
}

/** meFact: the mob that hurt the bot in the last 5 s, still alive (director v1.3's Me line). */
export function meFact(bot: SensorBot, attacks: Attacks, now: number): Attack | null {
    const h = attacks.selfHit(now, ME_MS);
    if (!h) return null;
    const d = h.mob.position ? Math.ceil(dist3(h.mob.position, bot.entity.position)) : 0;
    return { by: mobKind(h.mob.name), entityId: h.mob.id, at: h.at, dist: d };
}

/** nearestPlayerDist: the distance to the nearest other player entity, or null. */
export function nearestPlayerDist(bot: SensorBot): number | null {
    let best: number | null = null;
    for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || e.type !== 'player' || !e.position) continue;
        const d = dist3(e.position, bot.entity.position);
        if (best === null || d < best) best = d;
    }
    return best;
}
