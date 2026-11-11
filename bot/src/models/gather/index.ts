// The gather skill model (skills-spec v1 §3; laya-go games/gather v1): state, question, typed answer, rules v1 and
// Harmful, and decideGatherStep, the shared skill decision (models/skill decideSkill).
import type { ModelDecider } from '../../types/models.js';
import { decideSkill, SKILL_MIN_CONFIDENCE, type SkillDecision, type SkillModel } from '../skill/index.js';
import { readGather, type GatherStep } from './answer.js';
import { gatherQuestions } from './questions.js';
import { gatherState, type GatherSituation } from './render.js';
import { gatherHarmful, gatherRules, type GatherRule } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './answer.js';
export * from './rules.js';

export const GATHER_MODEL: SkillModel<GatherSituation, GatherStep, GatherRule> = {
    task: 'gather', state: gatherState, questions: gatherQuestions, rules: gatherRules, read: readGather, harmful: gatherHarmful,
};

export type GatherDecision = SkillDecision<GatherStep, GatherRule>;

export const decideGatherStep = (s: GatherSituation, client: ModelDecider | null, minConfidence = SKILL_MIN_CONFIDENCE): Promise<GatherDecision> =>
    decideSkill(GATHER_MODEL, s, client, minConfidence);
