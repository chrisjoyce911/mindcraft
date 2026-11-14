// Hostile mobs around the bot: isHostile (src/utils/mcdata.js), mobKind (director v1.2), and the scan
// the Hostiles/Nearest lines and the defend situation read.
import type { MobFact, MobKind } from '../types/index.js';
import { isAttacker, type Attacks } from './attacks.js';
import { dist3, type SensorBot, type SensorEntity } from './bot.js';

/** The mob kinds the director's Nearest, Me and Player lines name; anything else is `other`. */
export const NEAREST_KINDS = ['zombie', 'skeleton', 'creeper', 'spider'] as const;
/** The Hostiles count's and Nearest's reach. */
export const HOSTILE_RANGE = 16;
/** How far the scan looks: the defend mode read hostiles within MOB_RANGE (16) + 2. */
export const MOB_SCAN = 18;

/** mobKind is a mob's name as the state's Nearest/By kinds name it (strays and bogged are skeletons, v1.2), else other. */
export function mobKind(name: string | null | undefined): MobKind {
    if (name === 'stray' || name === 'bogged') return 'skeleton';
    return (NEAREST_KINDS as readonly string[]).includes(name ?? '') ? (name as MobKind) : 'other';
}

/** isHostile: a mob or hostile entity, not an iron or snow golem (mcdata.js isHostile). */
export function isHostile(e: SensorEntity | null | undefined): boolean {
    if (!e || !e.name) return false;
    return (e.type === 'mob' || e.type === 'hostile') && e.name !== 'iron_golem' && e.name !== 'snow_golem';
}

/** otherPlayers: the positions of the players the bot can see (not itself). */
export function otherPlayers(bot: SensorBot): SensorEntity[] {
    const out: SensorEntity[] = [];
    for (const p of Object.values(bot.players)) if (p.entity && p.entity !== bot.entity && p.entity.position) out.push(p.entity);
    return out;
}

/** scanMobs: hostiles within MOB_SCAN of the bot, nearest first, each marked attacker or not. */
export function scanMobs(bot: SensorBot, attacks: Attacks, now: number): MobFact[] {
    const me = bot.entity.position;
    const players = otherPlayers(bot).map(p => p.position);
    const out: MobFact[] = [];
    for (const e of Object.values(bot.entities)) {
        if (e === bot.entity || !e.position || !isHostile(e)) continue;
        const d = dist3(e.position, me);
        if (d > MOB_SCAN) continue;
        const name = e.name ?? '';
        const m: MobFact = { id: e.id, name, kind: mobKind(name), pos: { x: e.position.x, y: e.position.y, z: e.position.z }, dist: d,
            attacker: isAttacker(attacks, e, me, players, now) };
        if (e.health !== undefined) m.health = e.health;
        out.push(m);
    }
    return out.sort((a, b) => a.dist - b.dist || a.id - b.id);
}

/** hostileFacts: the Hostiles count and the Nearest (dist rounded up) within HOSTILE_RANGE. */
export function hostileFacts(mobs: readonly MobFact[]): { hostiles: number; nearest: { kind: MobKind; dist: number } | null } {
    const near = mobs.filter(m => m.dist <= HOSTILE_RANGE);
    let nearest: { kind: MobKind; dist: number } | null = null;
    for (const m of near) {
        const d = Math.ceil(m.dist);
        if (!nearest || d < nearest.dist) nearest = { kind: m.kind, dist: d };
    }
    return { hostiles: near.length, nearest };
}
