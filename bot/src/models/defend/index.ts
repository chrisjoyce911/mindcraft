// The defend model's decision: the defend model's answer when it is confident and passes the safety
// rules (possibly swapped for fleeing a close creeper), else laya-go's defend rules (no modes). Pure:
// the client is passed in. With no active mob nothing is asked: the rules answer calm.

import type { Decision, DefendAction, DefendRule, DefendVeto } from '../../types/decisions.js';
import type { ModelDecider } from '../../types/models.js';
import { read, type DefendAsked } from './answer.js';
import { defendQuestions, targetWord } from './questions.js';
import { defendState, type DefendSituation, type WeaponName } from './render.js';
import { danger, decide } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './rules.js';
export * from './answer.js';
export * from './situation.js';

/** answer: the action; target: the mob index (-1 none) and targetWord its option; weapon null: none. */
export interface DefendDecision extends Decision<DefendAction, DefendRule> {
    target: number;
    targetWord: string;
    weapon: WeaponName | null;
    /** The model's Danger probability when asked, else the rules' (1 or 0). */
    danger: number;
    veto?: DefendVeto;
    override?: 'creeper';
    asked?: DefendAsked;
}

/** decideDefend decides what to do about the mobs. client null: the task is off, the rules decide. */
export async function decideDefend(s: DefendSituation, client: ModelDecider | null): Promise<DefendDecision> {
    const state = defendState(s);
    const rule = decide(s);
    const rules: DefendDecision = {
        answer: rule.action, source: 'rules', rule: rule.rule, state,
        target: rule.target, targetWord: targetWord(s, rule.target), weapon: rule.weapon, danger: danger(s) ? 1 : 0,
    };
    if (!client || !danger(s)) return rules;
    const result = await client.decide('defend', state, defendQuestions(s)).catch(() => null);
    const a = read(result, s);
    if (a.ok) {
        return {
            ...rules, answer: a.answer.action, source: 'model', p: a.asked.p, danger: a.asked.danger, asked: a.asked,
            target: a.answer.target, targetWord: targetWord(s, a.answer.target), weapon: a.answer.weapon,
            ...(a.override ? { override: a.override } : {}),
        };
    }
    return {
        ...rules, why: a.why,
        ...(a.veto ? { veto: a.veto } : {}),
        ...(a.asked ? { asked: a.asked, model: a.asked.action, p: a.asked.p } : {}),
    };
}
