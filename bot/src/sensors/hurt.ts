// The entityHurt wiring (the old agent's _choreSensors): a player (the bot or a named one within
// PLAYER_HURT_REACH) hurt by a mob is recorded in Attacks. The mob is the damage's source when it is
// hostile; with no source, the nearest hostile within BLAME_RANGE of the victim (searched within
// BLAME_SEARCH of the bot); no mob (a fall, a player's hit) is ignored. entityGone forgets the mob.
import { BLAME_RANGE, type Attacks } from './attacks.js';
import { dist3, type SensorBot, type SensorEntity } from './bot.js';
import { isHostile } from './mobs.js';

export const PLAYER_HURT_REACH = 24;
export const BLAME_SEARCH = 32;

/** blame: the nearest hostile within BLAME_RANGE of the victim (and BLAME_SEARCH of the bot). */
export function blame(bot: SensorBot, victim: SensorEntity): SensorEntity | null {
    const me = bot.entity.position;
    let best: SensorEntity | null = null, bestD = Infinity;
    for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || !e.position || !isHostile(e)) continue;
        const d = dist3(e.position, me);
        if (d > BLAME_SEARCH || dist3(e.position, victim.position) > BLAME_RANGE) continue;
        if (d < bestD) { best = e; bestD = d; }
    }
    return best;
}

/** onHurt handles one entityHurt; returns whether a mob's hit was recorded. */
export function onHurt(bot: SensorBot, attacks: Attacks, entity: SensorEntity | undefined, source?: SensorEntity): boolean {
    const self = entity === bot.entity;
    if (!entity || entity.type !== 'player' || (!self && !entity.username)) return false;
    if (!self && dist3(entity.position, bot.entity.position) > PLAYER_HURT_REACH) return false;
    let mob: SensorEntity | null = source && isHostile(source) ? source : null;
    if (!mob && !source) mob = blame(bot, entity);
    if (!mob) return false;
    return attacks.hurt(self ? 'self' : { player: entity.username ?? '' }, mob);
}

/** wireHurt subscribes Attacks to the bot's entityHurt and entityGone; returns the detach. */
export function wireHurt(bot: SensorBot, attacks: Attacks): () => void {
    const offHurt = bot.onHurt((e, s) => { onHurt(bot, attacks, e, s); });
    const offGone = bot.onGone(e => { if (e?.id != null) attacks.gone(e.id); });
    return () => { offHurt(); offGone(); };
}
