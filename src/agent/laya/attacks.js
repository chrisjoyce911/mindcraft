// Who is attacking whom: the fact the fight modes act on (user decision
// 2026-11-11). A mob that is attacking andy or a player is fought; a mob
// that attacks nobody is left alone, however near it is (live play 3: a
// skeleton 12–14 blocks away in the shade, attacking nobody, stopped every
// job for a fight that could only get andy hurt).
//
// A mob is attacking when it hurt andy or a player in the last ATTACK_MS
// (mineflayer's entityHurt with the damage's source entity, the shooter for
// an arrow; with no source, the nearest hostile within BLAME_RANGE of the
// victim), or it is a creeper with its fuse lit within FUSE_RANGE of andy
// or a player. Pure: the agent feeds it.

export const ATTACK_MS = 15_000;
export const BLAME_RANGE = 4;
export const FUSE_RANGE = 5;
export const ME_MS = 5_000; // director v1.3's Me line

export class Attacks {
    constructor(now = () => Date.now()) {
        this.now = now;
        this.byMob = new Map(); // mob entity id → {at, victim, kind}
        this.self = null; // andy's last hit by a mob {at, by, kind, id}
    }

    // hurt records a hit: victim 'self' (andy) or a player's name; mob: the
    // attacking entity ({id, name}) or null (not a mob's hit: ignored).
    hurt(victim, mob) {
        if (!mob || mob.id == null) return false;
        const at = this.now();
        this.byMob.set(mob.id, { at, victim, kind: mob.name });
        if (victim === 'self') this.self = { at, id: mob.id, kind: mob.name, entity: mob };
        return true;
    }

    // gone forgets a mob (it died or left).
    gone(id) { this.byMob.delete(id); }

    // attacking: whether the mob (entity) attacked anyone lately.
    attacking(mob, now = this.now()) {
        const h = mob && this.byMob.get(mob.id);
        if (h && now - h.at <= ATTACK_MS) return true;
        if (h) this.byMob.delete(mob.id);
        return false;
    }

    // selfFact: the "andy attacked" fact: {attacked, by, entity} for a mob
    // that hit andy in the last ATTACK_MS, else {attacked: false}.
    // within: how recent (director v1.3's Me line: 5 s).
    selfFact(now = this.now(), within = ATTACK_MS) {
        const s = this.self;
        if (s && now - s.at <= within && s.entity?.isValid !== false) return { attacked: true, by: s.kind, entity: s.entity };
        return { attacked: false, by: 'none', entity: null };
    }
}

// fusing: a creeper whose fuse is lit (1.21 metadata: index 16 state 1, or
// index 18 ignited).
export function fusing(e) {
    if (e?.name !== 'creeper') return false;
    const m = e.metadata || [];
    return m[16] === 1 || m[18] === true;
}

// isAttacker: a mob the fight modes act on (attacking lately, or a creeper
// fusing near andy or one of players' positions).
export function isAttacker(attacks, e, me, players = [], now) {
    if (attacks.attacking(e, now)) return true;
    if (fusing(e) && e.position && [me, ...players].some(p => p && e.position.distanceTo(p) <= FUSE_RANGE)) return true;
    return false;
}
