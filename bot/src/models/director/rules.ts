// The director's rules: shared spec v1.3 (decide) and v1.2 (decideV12), laya-go games/director/rules,
// with its rule names in its order. A port of the old bot's director.js; the 1000-situation sets in
// test/fixtures/laya-director-v12|v13 check them.

import type { Activity, DirectorRule } from '../../types/decisions.js';
import { mobKind, PLAYER_REACH, RANGED_REACH, type DirectorSituation } from './render.js';

export { DIRECTOR_RULES as RULES } from '../../types/decisions.js';

export interface RuleDecision { activity: Activity; rule: DirectorRule }

/** V12_RULES decide on facts a prompt v1 model can't see. */
export const V12_RULES: ReadonlySet<DirectorRule> = new Set<DirectorRule>(['flee-ranged', 'defend-player']);

const r = (activity: Activity, rule: DirectorRule): RuleDecision => ({ activity, rule });
const within = (s: DirectorSituation, d: number): boolean => s.hostiles > 0 && !!s.nearest && Math.min(s.nearest.dist, 16) <= d;
const fluid = (s: DirectorSituation): boolean => s.danger === 'fluid' || s.danger === 'fire' || s.danger === 'drowning';

/** decide is the spec's rules (v1.3), in order. */
export function decide(s: DirectorSituation): RuleDecision {
    const me = !!s.me?.attacked;
    const nearest = s.nearest;
    if (fluid(s)) return r('flee', 'flee-danger');
    if (within(s, 4) && (s.health <= 6 || (s.armed === 'none' && s.health <= 10))) return r('flee', 'flee-hostile');
    if (within(s, 3) && nearest?.kind === 'creeper') return r('flee', 'flee-creeper');
    if ((within(s, 8) || me) && s.health <= 6) return r('flee', 'flee-low'); // v1.1; v1.3 an attack too
    // v1.2: a skeleton in range, low and nothing to eat: healing in its sight kills
    if (within(s, RANGED_REACH) && mobKind(nearest?.kind) === 'skeleton' && s.health <= 6 && !(s.foodItems > 0)) return r('flee', 'flee-ranged');
    // v1.3: only a mob attacking the bot is defended (one attacking nobody is ignored)
    if (me) return r('defend', 'defend');
    // v1.2: a player near is attacked, unless the bot is hungry with food to eat
    if (s.player?.attacked && s.player.dist <= PLAYER_REACH && !(s.food <= 6 && s.foodItems > 0)) return r('defend', 'defend-player');
    if (s.health <= 8) return r('heal', 'heal'); // v1.3: hostiles near are fled or ignored
    return calm(s);
}

/**
 * decideV12 is shared spec v1.2's rules (the Me line unread): a hostile within 8 is defended. A served
 * model on an older prompt is held to the v1.3 rules where they answer otherwise.
 */
export function decideV12(s: DirectorSituation): RuleDecision {
    const nearest = s.nearest;
    if (fluid(s)) return r('flee', 'flee-danger');
    if (within(s, 4) && (s.health <= 6 || (s.armed === 'none' && s.health <= 10))) return r('flee', 'flee-hostile');
    if (within(s, 3) && nearest?.kind === 'creeper') return r('flee', 'flee-creeper');
    if (within(s, 8) && s.health <= 6) return r('flee', 'flee-low');
    if (within(s, RANGED_REACH) && mobKind(nearest?.kind) === 'skeleton' && s.health <= 6 && !(s.foodItems > 0)) return r('flee', 'flee-ranged');
    if (within(s, 8)) return r('defend', 'defend');
    if (s.player?.attacked && s.player.dist <= PLAYER_REACH && !(s.food <= 6 && s.foodItems > 0)) return r('defend', 'defend-player');
    if (s.health <= 8 && !within(s, 8)) return r('heal', 'heal');
    return calm(s);
}

/** calm is the rules after the threat rules (eat-hungry on), shared by v1.2 and v1.3. */
export function calm(s: DirectorSituation): RuleDecision {
    const job = !!s.job, paused = !!s.paused, home = s.home != null;
    if (s.food <= 6 && s.foodItems > 0) return r('eat', 'eat-hungry');
    if (job || paused) { // v1.1: never unload while idle
        if (s.free <= 2 && home) return r('unload', 'unload-full');
        if (s.free <= 6 && home && (s.home as number) <= 24) return r('unload', 'unload-near');
        if (s.valuables >= 4 && (s.health <= 8 || s.hostiles >= 2 || s.food <= 6) && home) return r('unload', 'unload-valuables');
    }
    const stuck = s.last === 'failed' || s.last === 'blocked';
    if (!job && paused) return r('resume', 'resume-paused');
    if (job && !stuck) return r('continue', 'continue');
    if (job && paused) return r('resume', 'resume-failed');
    if (job) return r('idle', 'idle-failed'); // a failed job, nothing paused
    // rule 10, nothing to do: eat when not full
    if (s.food < 18 && s.health < 20 && s.foodItems > 0) return r('eat', 'eat-idle');
    return r('idle', 'idle');
}
