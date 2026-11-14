// The chores v2 model (skills-spec v1 §1; laya-go games/chores/v2): state, questions, typed answer, rules v2,
// Harmful and the goals, and decideChores, the shared skill decision (models/skill decideSkill): the model's answer
// when the task is on and its served prompt is v2, well formed, sure and not harmful; else rules v2, with why.
import type { ModelDecider } from '../../types/models.js';
import { decideSkill, type SkillDecision, type SkillModel } from '../skill/index.js';
import { readChores, type ChoresAnswer } from './answer.js';
import { choresQuestions } from './questions.js';
import { choresState, type ChoresSituation } from './render.js';
import { choresHarmful, choresRules, type ChoresRule } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './answer.js';
export * from './rules.js';
export * from './goals.js';

export const CHORES_MODEL: SkillModel<ChoresSituation, ChoresAnswer, ChoresRule> = {
    task: 'chores', state: choresState, questions: choresQuestions, rules: choresRules, read: readChores, harmful: choresHarmful,
};

export type ChoresDecision = SkillDecision<ChoresAnswer, ChoresRule>;

/** The chores task's default min_confidence (settings.js: 0.5). */
export const CHORES_MIN_CONFIDENCE = 0.5;

/** decideChores: the next run (client null: the task is off or not served at v2; rules v2 alone). */
export const decideChores = (s: ChoresSituation, client: ModelDecider | null, minConfidence = CHORES_MIN_CONFIDENCE): Promise<ChoresDecision> =>
    decideSkill(CHORES_MODEL, s, client, minConfidence);
