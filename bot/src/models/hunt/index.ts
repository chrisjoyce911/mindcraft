// The hunt skill model (skills-spec v1 §2; laya-go games/hunt v1): state, questions, typed answer, rules v1 and
// Harmful, and decideHuntStep, the shared skill decision (models/skill decideSkill).
import type { ModelDecider } from '../../types/models.js';
import { decideSkill, SKILL_MIN_CONFIDENCE, type SkillDecision, type SkillModel } from '../skill/index.js';
import { readHunt, type HuntStep } from './answer.js';
import { huntQuestions } from './questions.js';
import { huntState, type HuntSituation } from './render.js';
import { huntHarmful, huntRules, type HuntRule } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './answer.js';
export * from './rules.js';

export const HUNT_MODEL: SkillModel<HuntSituation, HuntStep, HuntRule> = {
    task: 'hunt', state: huntState, questions: huntQuestions, rules: huntRules, read: readHunt, harmful: huntHarmful,
};

export type HuntDecision = SkillDecision<HuntStep, HuntRule>;

/** decideHuntStep: the next hunt step (client null: the task is off, rules v1 alone). */
export const decideHuntStep = (s: HuntSituation, client: ModelDecider | null, minConfidence = SKILL_MIN_CONFIDENCE): Promise<HuntDecision> =>
    decideSkill(HUNT_MODEL, s, client, minConfidence);
