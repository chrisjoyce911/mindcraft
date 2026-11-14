// Who is attacking whom: the fact the fight activities act on (user decision 2026-11-11). A port of
// the old bot's src/agent/laya/attacks.js (fix round 4). A mob that is attacking the bot or a player
// is fought; a mob that attacks nobody is left alone, however near it is (live play 3: a skeleton
// 12–14 blocks away in the shade, attacking nobody, stopped every job for a fight that could only get
// andy hurt).
//
// A mob is attacking when it hurt the bot or a player in the last ATTACK_MS (mineflayer's entityHurt
// with the damage's source entity, the shooter for an arrow; with no source, the nearest hostile
// within BLAME_RANGE of the victim), or it is a creeper with its fuse lit within FUSE_RANGE of the bot
// or a player. Pure: hurt.ts feeds it.
import type { Vec3Like } from '../types/index.js';
import { dist3, type SensorEntity } from './bot.js';

export const ATTACK_MS = 15_000;
export const BLAME_RANGE = 4;
export const FUSE_RANGE = 5;
/** director v1.3's Me line and v1.2's Player line: hits in the last 5 s. */
export const ME_MS = 5_000;

/** Who was hurt: the bot itself, or a player by name. */
export type Victim = 'self' | { player: string };
/** A mob's hit as remembered: when, which mob (the live entity). */
export interface Hit { at: number; mob: SensorEntity }
export interface SelfFact { attacked: boolean; by: string; entity: SensorEntity | null }

export class Attacks {
    private readonly byMob = new Map<number, { at: number; victim: Victim; kind: string }>();
    private self: Hit | null = null;
    private readonly players = new Map<string, Hit>();
    constructor(private readonly now: () => number = () => Date.now()) {}

    /** hurt records a mob's hit on the victim; mob null (not a mob's hit) is ignored. */
    hurt(victim: Victim, mob: SensorEntity | null | undefined): boolean {
        if (!mob || mob.id == null) return false;
        const at = this.now();
        this.byMob.set(mob.id, { at, victim, kind: mob.name ?? '' });
        if (victim === 'self') this.self = { at, mob };
        else this.players.set(victim.player, { at, mob });
        return true;
    }

    /** gone forgets a mob (it died or left). */
    gone(id: number): void { this.byMob.delete(id); }

    /** attacking: whether the mob hit anyone in the last ATTACK_MS. */
    attacking(mob: { id: number } | null | undefined, now: number = this.now()): boolean {
        const h = mob ? this.byMob.get(mob.id) : undefined;
        if (h && now - h.at <= ATTACK_MS) return true;
        if (h && mob) this.byMob.delete(mob.id);
        return false;
    }

    /** selfFact: a mob that hit the bot within `within` ms and is still valid, else not attacked. */
    selfFact(now: number = this.now(), within: number = ATTACK_MS): SelfFact {
        const s = this.selfHit(now, within);
        return s ? { attacked: true, by: s.mob.name ?? '', entity: s.mob } : { attacked: false, by: 'none', entity: null };
    }

    /** selfHit: the bot's last mob hit within `within` ms, the mob still valid, else null. */
    selfHit(now: number = this.now(), within: number = ATTACK_MS): Hit | null {
        const s = this.self;
        return s && now - s.at <= within && s.mob.isValid !== false ? s : null;
    }

    /** playerHit: the player's last mob hit within `within` ms (the Player line), else null. */
    playerHit(name: string, now: number = this.now(), within: number = ME_MS): Hit | null {
        const h = this.players.get(name);
        return h && now - h.at <= within ? h : null;
    }
}

/** fusing: a creeper whose fuse is lit (1.21 metadata: index 16 state 1, or index 18 ignited). */
export function fusing(e: SensorEntity | null | undefined): boolean {
    if (e?.name !== 'creeper') return false;
    const m = e.metadata ?? [];
    return m[16] === 1 || m[18] === true;
}

/** isAttacker: a mob the fight activities act on (attacking lately, or a creeper fusing near the bot or a player). */
export function isAttacker(attacks: Attacks, e: SensorEntity, me: Vec3Like | null, players: readonly Vec3Like[] = [], now?: number): boolean {
    if (attacks.attacking(e, now)) return true;
    if (fusing(e) && e.position && [me, ...players].some(p => p && dist3(e.position, p) <= FUSE_RANGE)) return true;
    return false;
}
