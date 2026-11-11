// The defend rules: a port of laya-go games/defend/rules (Decide, Active, Danger, BestMelee, MeleeDPS,
// CanShoot, target, Harmful), the fallback in place of the old self_defense/cowardice modes.
// test/fixtures/laya-defend-v1/decisions.jsonl checks it on 1000 situations.
//
// A mob is active when it is a threat now: within its kind's notice range, and, for spiders, only at
// night. The rules, in order:
//
//  1. Calm: no active mob. Ignore.
//  2. Creeper: an active creeper within CREEPER_CLOSE. Flee, unless it is the only active mob and the
//     bot is strong (Health ≥ 14, Armor ≥ 15, best melee DPS ≥ iron sword's): then fight it. A creeper
//     within 8 is shot with a bow when the bot has arrows, otherwise backed away from.
//  3. Low: Health ≤ LOW_HEALTH. With a golden apple, eat it once no melee mob is within REACH; until
//     then back off. Without one, flee.
//  4. Outnumbered: three or more active melee mobs and Health + Armor/2 below 16 (12 with the player
//     near). Flee.
//  5. Fight the most dangerous active mob (priority, among those within REACH first, nearest then
//     weakest). Ranged mobs farther than SHOOT_RANGE are shot, or closed on (behind a shield if any).
//     A melee mob 4 to 8 away is kited with a bow when the best melee weapon is wooden-sword grade or
//     worse. Otherwise fight with the best melee weapon.

import type { DefendAction, DefendRule } from '../../types/decisions.js';
import { dist, dps, kindInfo, WEAPONS, type DefendMob, type DefendSituation, type WeaponName } from './render.js';

export { DEFEND_RULES as RULES } from '../../types/decisions.js';

export const REACH = 3;
export const CREEPER_CLOSE = 4;
export const SHOOT_RANGE = 6;
export const KITE_MAX = 8;
export const STRONG_DPS = 9.6; // iron sword
export const WEAK_DPS = 6.4; // wooden sword
export const LOW_HEALTH = 6;

/** The rules' answer: an action, the mob it is about (index into mobs, -1 none) and the weapon (null none). */
export interface DefendRuleDecision { action: DefendAction; target: number; weapon: WeaponName | null; rule: DefendRule }

/** active reports whether a mob is a threat now (laya-go Situation.Active). */
export function active(s: Pick<DefendSituation, 'night'>, m: DefendMob): boolean {
    const k = kindInfo(m.kind);
    if (k.dayCalm && !s.night) return false;
    return dist(m) <= k.notice;
}

/** danger reports whether any mob is active (the Danger question's answer). */
export const danger = (s: DefendSituation): boolean => s.mobs.some(m => active(s, m));

/** bestMelee is the carried melee weapon with the most DPS (the earlier on a tie), or null. */
export function bestMelee(s: DefendSituation): WeaponName | null {
    let best: WeaponName | null = null, most = 0;
    for (const w of s.weapons) {
        if (WEAPONS[w].ranged) continue;
        const d = dps(w);
        if (d > most) { best = w; most = d; }
    }
    return best;
}

/** meleeDPS is the best melee weapon's DPS; a fist does 1×4. */
export const meleeDPS = (s: DefendSituation): number => { const w = bestMelee(s); return w ? dps(w) : 4; };

/** canShoot reports whether the bot has a bow and arrows. */
export const canShoot = (s: DefendSituation): boolean => s.weapons.includes('bow') && s.arrows > 0;

/** nearest is the nearest active mob matching keep (the earlier on a tie), or -1. */
function nearest(s: DefendSituation, keep: (m: DefendMob) => boolean): number {
    let best = -1;
    s.mobs.forEach((m, i) => {
        if (!active(s, m) || !keep(m)) return;
        if (best < 0 || dist(m) < dist(s.mobs[best] as DefendMob)) best = i;
    });
    return best;
}

/**
 * target picks the mob to fight: among active mobs within REACH if any, otherwise all active mobs;
 * highest priority, then nearest, then weakest, then first.
 */
export function target(s: DefendSituation): number {
    const close = nearest(s, m => dist(m) <= REACH) >= 0;
    let best = -1;
    s.mobs.forEach((m, i) => {
        if (!active(s, m) || (close && dist(m) > REACH)) return;
        if (best < 0) { best = i; return; }
        const b = s.mobs[best] as DefendMob;
        const pk = kindInfo(m.kind).priority, pb = kindInfo(b.kind).priority;
        if (pk !== pb) { if (pk > pb) best = i; } else if (dist(m) !== dist(b)) { if (dist(m) < dist(b)) best = i; } else if (m.health < b.health) best = i;
    });
    return best;
}

const d = (action: DefendAction, target: number, weapon: WeaponName | null, rule: DefendRule): DefendRuleDecision => ({ action, target, weapon, rule });

/** decide applies the rules. */
export function decide(s: DefendSituation): DefendRuleDecision {
    if (!danger(s)) return d('ignore', -1, null, 'calm');
    const melee = (m: DefendMob): boolean => !kindInfo(m.kind).ranged;
    const activeCount = s.mobs.filter(m => active(s, m)).length;
    const c = nearest(s, m => m.kind === 'creeper');
    if (c >= 0) {
        if (dist(s.mobs[c] as DefendMob) <= CREEPER_CLOSE) {
            if (activeCount === 1 && s.health >= 14 && s.armor >= 15 && meleeDPS(s) >= STRONG_DPS) return d('fight', c, bestMelee(s), 'creeper-strong');
            return d('flee', c, null, 'creeper-near');
        }
        if (s.health > LOW_HEALTH) {
            if (canShoot(s)) return d('fight', c, 'bow', 'creeper-shoot');
            return d('backoff', c, null, 'creeper-away');
        }
    }
    if (s.health <= LOW_HEALTH) {
        const near = nearest(s, m => melee(m) && dist(m) <= REACH);
        if (s.apples > 0) return near < 0 ? d('eat', -1, null, 'low-eat') : d('backoff', near, null, 'low-backoff');
        return d('flee', nearest(s, () => true), null, 'low-flee');
    }
    const meleeCount = s.mobs.filter(m => active(s, m) && melee(m)).length;
    const limit = s.playerNear ? 12 : 16;
    if (meleeCount >= 3 && s.health + s.armor / 2 < limit) return d('flee', nearest(s, () => true), null, 'outnumbered');
    const t = target(s);
    const m = s.mobs[t] as DefendMob;
    if (kindInfo(m.kind).ranged && dist(m) > SHOOT_RANGE) {
        if (canShoot(s)) return d('fight', t, 'bow', 'shoot');
        if (s.shield) return d('shield', t, bestMelee(s), 'close-in');
        return d('fight', t, bestMelee(s), 'close-in');
    }
    if (!kindInfo(m.kind).ranged && dist(m) > REACH + 1 && dist(m) <= KITE_MAX && canShoot(s) && meleeDPS(s) <= WEAK_DPS) return d('backoff', t, 'bow', 'kite');
    return d('fight', t, bestMelee(s), 'melee');
}

/**
 * harmful reports whether choosing got instead of the rules' want puts the bot in danger: fighting or
 * shielding when it should flee or back off, ignoring a threat, or meleeing a creeper the rules don't fight.
 */
export function harmful(s: DefendSituation, want: DefendRuleDecision, got: DefendAction, targetI: number): boolean {
    if (got === 'ignore' && want.action !== 'ignore') return true;
    if ((got === 'fight' || got === 'shield') && (want.action === 'flee' || want.action === 'backoff' || want.action === 'eat')) return true;
    const m = s.mobs[targetI];
    return got === 'fight' && targetI >= 0 && !!m && m.kind === 'creeper' && dist(m) <= CREEPER_CLOSE && want.rule !== 'creeper-strong';
}
