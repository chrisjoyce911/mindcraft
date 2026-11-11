// The eat model's decision: the eat model's answer when it is confident, consistent and safe, else
// laya-go's eat rules (no auto-eat: design "no modes"). Pure: the client is passed in.

import type { Decision, EatRule, EatVeto } from '../../types/decisions.js';
import type { ModelDecider } from '../../types/models.js';
import { read, type EatAsked } from './answer.js';
import { eatQuestions } from './questions.js';
import { eatState, NONE, type EatSituation, type FoodName } from './render.js';
import { decide } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './rules.js';
export * from './answer.js';

/** answer: the food to eat, or none. */
export interface EatDecision extends Decision<FoodName | typeof NONE, EatRule> {
    eat: boolean;
    food: FoodName | null;
    veto?: EatVeto;
    /** What the model said, when it was asked and answered. */
    asked?: EatAsked;
}

/** decideEat decides whether and what to eat. client null: the task is off, the rules decide. */
export async function decideEat(s: EatSituation, client: ModelDecider | null): Promise<EatDecision> {
    const state = eatState(s);
    const rule = decide(s);
    const rules: EatDecision = { answer: rule.food ?? NONE, eat: rule.eat, food: rule.food, source: 'rules', rule: rule.rule, state };
    if (!client) return rules;
    const result = await client.decide('eat', state, eatQuestions(s)).catch(() => null);
    const a = read(result, s);
    if (a.ok) return { ...rules, answer: a.food ?? NONE, eat: a.eat, food: a.food, source: 'model', p: a.asked.p, asked: a.asked };
    return {
        ...rules, why: a.why,
        ...(a.veto ? { veto: a.veto } : {}),
        ...(a.asked ? { asked: a.asked, model: a.asked.food, p: a.asked.p } : {}),
    };
}
