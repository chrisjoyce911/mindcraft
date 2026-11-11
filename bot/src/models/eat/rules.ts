// The eat rules: a port of laya-go games/eat/rules.Decide (the eat game's answer key), the fallback in
// place of mineflayer-auto-eat. test/fixtures/laya-eat-v1/decisions.jsonl checks it on 1000 situations.
//
//  1. No food carried: don't eat.
//  2. Emergency: health ≤ CRITICAL with an enchanted golden apple, or health ≤ EMERGENCY with a golden
//     apple: eat it, even beside danger or full.
//  3. Danger near: don't eat (eating takes 1.6 s and slows the bot).
//  4. Food level 20: don't eat.
//  5. Need: starving (food ≤ STARVING), regenerating (health < 20 and food < REGEN), or topping up
//     (saturation 0 and a normal food fits the missing hunger without waste). No need: don't eat.
//  6. Which normal food: the most points that fit the missing hunger; if none fits, the fewest points.
//     Ties go to higher saturation, then name.
//  7. No normal food: when starving, the least bad food (BAD_ORDER); otherwise don't eat.
//
// Rare food is eaten only by rule 2.

import type { EatRule } from '../../types/decisions.js';
import { BAD_ORDER, foodInfo, isFood, type EatSituation, type FoodName } from './render.js';

export { EAT_RULES as RULES } from '../../types/decisions.js';

export const MAX_FOOD = 20;
export const EMERGENCY = 6;
export const CRITICAL = 4;
export const STARVING = 6;
export const REGEN = 18;

export interface EatRuleDecision { eat: boolean; food: FoodName | null; rule: EatRule }

const carries = (s: EatSituation, name: FoodName): boolean => s.carry.some(st => st.food === name && st.count > 0);
const no = (rule: EatRule): EatRuleDecision => ({ eat: false, food: null, rule });

/** better reports whether a beats b: more points (most) or fewer (not most), then higher saturation, then the earlier name. */
function better(a: FoodName, b: FoodName, most: boolean): boolean {
    const fa = foodInfo(a), fb = foodInfo(b);
    if (fa.points !== fb.points) return (fa.points > fb.points) === most;
    if (fa.saturation !== fb.saturation) return fa.saturation > fb.saturation;
    return a < b;
}

/** decide applies the rules to a situation. */
export function decide(s: EatSituation): EatRuleDecision {
    const held = s.carry.filter(st => isFood(st.food) && st.count > 0).map(st => st.food);
    if (held.length === 0) return no('no-food');
    if (s.health <= CRITICAL && carries(s, 'enchanted_golden_apple')) return { eat: true, food: 'enchanted_golden_apple', rule: 'emergency' };
    if (s.health <= EMERGENCY && carries(s, 'golden_apple')) return { eat: true, food: 'golden_apple', rule: 'emergency' };
    if (s.danger) return no('danger');
    if (s.food >= MAX_FOOD) return no('full');
    const missing = MAX_FOOD - s.food;
    const normal = held.filter(f => foodInfo(f).tag === 'normal');
    const starving = s.food <= STARVING;
    const regen = s.health < MAX_FOOD && s.food < REGEN;
    let fit: FoodName | null = null;
    for (const f of normal) if (foodInfo(f).points <= missing && (fit === null || better(f, fit, true))) fit = f;
    const topUp = s.saturation === 0 && fit !== null;
    if (!starving && !regen && !topUp) return no('no-need');
    if (fit !== null) return { eat: true, food: fit, rule: 'fits' };
    const [first, ...rest] = normal;
    if (first !== undefined) {
        let least = first;
        for (const f of rest) if (better(f, least, false)) least = f;
        return { eat: true, food: least, rule: 'least-waste' };
    }
    if (starving) for (const name of BAD_ORDER) if (carries(s, name)) return { eat: true, food: name, rule: 'bad' };
    return no('no-good-food');
}
