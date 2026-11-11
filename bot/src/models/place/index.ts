// The place skill model (skills-spec v1 §4; laya-go games/place v1): state, question (options from the grid), typed
// answer, rules v1 and Harmful, and decidePlaceStep, the shared skill decision (models/skill decideSkill).
import type { ModelDecider } from '../../types/models.js';
import { decideSkill, SKILL_MIN_CONFIDENCE, type SkillDecision, type SkillModel } from '../skill/index.js';
import { readPlace, type PlaceStep } from './answer.js';
import { placeQuestions } from './questions.js';
import { placeState, type PlaceSituation } from './render.js';
import { placeHarmful, placeRules, type PlaceRule } from './rules.js';

export * from './render.js';
export * from './questions.js';
export * from './answer.js';
export * from './rules.js';

export const PLACE_MODEL: SkillModel<PlaceSituation, PlaceStep, PlaceRule> = {
    task: 'place', state: placeState, questions: placeQuestions, rules: placeRules, read: readPlace, harmful: placeHarmful,
};

export type PlaceDecision = SkillDecision<PlaceStep, PlaceRule>;

export const decidePlaceStep = (s: PlaceSituation, client: ModelDecider | null, minConfidence = SKILL_MIN_CONFIDENCE): Promise<PlaceDecision> =>
    decideSkill(PLACE_MODEL, s, client, minConfidence);
