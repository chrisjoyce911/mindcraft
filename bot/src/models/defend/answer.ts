// The defend answer: Action, Target, Weapon (choices) and Danger (noul) → a typed answer, or why the
// rules decide instead. The checks and their order are the old bot's defend.js step(): Action and Target
// confident, then laya-go's safety-critical rules (safety), which may also swap in a safer answer.

import { DEFEND_ACTIONS, type DefendAction, type DefendVeto, type FallbackWhy } from '../../types/decisions.js';
import type { DecideResult } from '../../types/models.js';
import { targetIndex, weaponOptions } from './questions.js';
import { dist, dps, isWeapon, kindInfo, NONE, type DefendMob, type DefendSituation, type WeaponName } from './render.js';
import { active, CREEPER_CLOSE, REACH, STRONG_DPS } from './rules.js';

/** A defend answer in the bot's types: the action, the mob index (-1 none) and the weapon (null none). */
export interface DefendAnswer { action: DefendAction; target: number; weapon: WeaponName | null }

export type SafetyVerdict =
    | { ok: true; answer: DefendAnswer; override?: 'creeper' }
    | { ok: false; veto: DefendVeto };

/**
 * safety checks an answer against laya-go's safety-critical defend rules: allowed (possibly swapped for
 * a safer answer: fleeing from a close creeper instead of fighting it), or vetoed with the reason.
 */
export function safety(s: DefendSituation, a: DefendAnswer): SafetyVerdict {
    const weapon = a.weapon !== null && s.weapons.includes(a.weapon) ? a.weapon : null;
    const answer: DefendAnswer = { ...a, weapon };
    const meleeThreat = s.mobs.some(m => active(s, m) && !kindInfo(m.kind).ranged && dist(m) <= REACH);
    switch (a.action) {
        case 'ignore':
            return meleeThreat ? { ok: false, veto: 'ignore-threat' } : { ok: true, answer };
        case 'eat':
            return s.apples < 1 ? { ok: false, veto: 'no-apple' } : { ok: true, answer };
        default:
            break;
    }
    const m = s.mobs[a.target];
    if (a.target < 0 || !m) return { ok: false, veto: 'no-target' };
    if (weapon === 'bow' && s.arrows < 1) return { ok: false, veto: 'no-arrows' };
    if ((a.action === 'fight' || a.action === 'shield') && m.kind === 'creeper' && dist(m) <= CREEPER_CLOSE && weapon !== 'bow') {
        const alone = s.mobs.filter((x: DefendMob) => active(s, x)).length === 1;
        const best = Math.max(4, ...s.weapons.filter(w => w !== 'bow').map(dps));
        if (!(alone && s.health >= 14 && s.armor >= 15 && best >= STRONG_DPS)) {
            return { ok: true, answer: { ...answer, action: 'flee', weapon: null }, override: 'creeper' };
        }
    }
    return { ok: true, answer };
}

/** What the model said, for the log line (the old defend log's action, target, weapon, p, danger and ms). */
export interface DefendAsked { action: string; target: string; weapon: string; p: number; danger: number; ms: number; model: string }

export type DefendRead =
    | { ok: true; answer: DefendAnswer; override?: 'creeper'; asked: DefendAsked }
    | { ok: false; why: FallbackWhy; veto?: DefendVeto; asked?: DefendAsked };

const isAction = (a: string): a is DefendAction => (DEFEND_ACTIONS as readonly string[]).includes(a);

/** read checks a defend reply against the situation it was asked about. */
export function read(result: DecideResult | null, s: DefendSituation): DefendRead {
    const A = result?.answers;
    const act = A?.Action, tgt = A?.Target, wpn = A?.Weapon, dng = A?.Danger;
    if (!result || !act || !tgt || !wpn || !dng || dng.type !== 'noul') return { ok: false, why: 'no-answer' };
    const asked: DefendAsked = { action: act.top, target: tgt.top, weapon: wpn.top, p: act.topProbability, danger: dng.probability, ms: result.ms, model: result.model };
    const t = targetIndex(s, tgt.top);
    if (!isAction(act.top) || t === null || !(weaponOptions(s) as string[]).includes(wpn.top)) return { ok: false, why: 'malformed', asked };
    if (!act.confident || !tgt.confident) return { ok: false, why: 'low-confidence', asked };
    const verdict = safety(s, { action: act.top, target: t, weapon: wpn.top !== NONE && isWeapon(wpn.top) ? wpn.top : null });
    if (!verdict.ok) return { ok: false, why: 'veto', veto: verdict.veto, asked };
    return { ok: true, answer: verdict.answer, ...(verdict.override ? { override: verdict.override } : {}), asked };
}
