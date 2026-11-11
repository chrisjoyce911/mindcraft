// The director model's decision point (the old bot's nextActivity): the director model when one is
// given and its answer is confident and actable, else the rules. Pure: the client is passed in.

import type { Activity, Decision, DirectorPrompt, DirectorRule } from '../../types/decisions.js';
import type { ModelDecider } from '../../types/models.js';
import { read } from './answer.js';
import { QUESTIONS } from './questions.js';
import { directorState, type DirectorSituation } from './render.js';
import { decide, decideV12, V12_RULES, type RuleDecision } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './rules.js';
export * from './answer.js';

export interface DirectorDecision extends Decision<Activity, DirectorRule> {
    /** The rules' own answer (differs from `answer` when the model decided otherwise). */
    ruleActivity: Activity;
}

/** The director model to ask: the client and the prompt version the model expects (promptOf). */
export interface DirectorModel { client: ModelDecider; prompt: DirectorPrompt }

/**
 * blind reports whether a model on an older prompt can't see what decided the rules' answer: a v1.2
 * rule for a v1 model, or any situation where the v1.3 rules answer otherwise than v1.2's for a v1 or
 * v1.2 model. The rules' answer stands then, and the model isn't asked.
 */
export function blind(s: DirectorSituation, rule: RuleDecision, prompt: DirectorPrompt): boolean {
    if (prompt === 'v1' && V12_RULES.has(rule.rule)) return true;
    if (prompt === 'v1.3') return false;
    const old = decideV12(s);
    return old.activity !== rule.activity || old.rule !== rule.rule;
}

/** decideDirector decides what andy does next. model null: the task is off, the rules decide. */
export async function decideDirector(s: DirectorSituation, model: DirectorModel | null): Promise<DirectorDecision> {
    const prompt = model?.prompt ?? 'v1.3';
    const state = directorState(s, prompt);
    const rule = decide(s);
    const rules: DirectorDecision = { answer: rule.activity, source: 'rules', rule: rule.rule, state, ruleActivity: rule.activity };
    if (!model || blind(s, rule, prompt)) return rules;
    const result = await model.client.decide('director', state, QUESTIONS).catch(() => null);
    const a = read(result, s);
    if (a.ok) return { ...rules, answer: a.activity, source: 'model', p: a.p };
    return { ...rules, why: a.why, ...(a.model !== undefined ? { model: a.model, p: a.p } : {}) };
}
