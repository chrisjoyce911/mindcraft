// The shared shape of the single-skill models (laya-go games/internal/skill; skills-spec v1 §2–4): a situation is
// put to Laya as a state text and one or more choice questions; rules v1 give the right option of each question and
// the rule that decided; Harmful says which answers must never be acted on. Pure: the client is passed in.
//
// decideSkill is the one decision path of hunt, gather and place (design §11.5): the model's answer when the task
// is on, the answer is well formed, sure (top p ≥ min_confidence on every question) and not harmful; otherwise the
// rules v1 answer in its place, with why. rules v1 are the spec's fallback, so no answer is never a stop.
import type { DecideResult, ModelDecider } from '../../types/models.js';

import { DIRS, MAX_COUNT, SEARCHES, UNSEEN, type Dir, type Search, type Seen } from '../../types/skills.js';
export { DIRS, SEARCHES, MAX_COUNT, MAX_DIST, MAX_HAVE, UNSEEN, type Dir, type Search, type Seen } from '../../types/skills.js';

export const isSearch = (n: number): n is Search => (SEARCHES as readonly number[]).includes(n);
/** The next wider search, or null at 193. */
export const widerSearch = (s: Search): Search | null => s === 49 ? 97 : s === 97 ? 193 : null;

/** seenText: "3 9 E", or "0 none none"; throws on values outside the spec (laya-go seen()). */
export function seenText(a: Seen, maxDist: number, game: string): string {
    if (a.count === 0 && a.dist === -1 && a.dir === null) return '0 none none';
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > MAX_COUNT || !Number.isInteger(a.dist) || a.dist < 0 || a.dist > maxDist
        || a.dir === null || !(DIRS as readonly string[]).includes(a.dir)) {
        throw new Error(`bad ${game} state: seen ${JSON.stringify(a)}`);
    }
    return `${a.count} ${a.dist} ${a.dir}`;
}

/** A choice question as laya-go skill.Choice builds it. */
export type ChoiceQuestion = { criteria: string[]; instructions: string; type: 'choice' };
export const choice = (instructions: string, options: readonly string[]): ChoiceQuestion =>
    ({ criteria: [...options], instructions, type: 'choice' });

/** The answer words, by question. */
export type Words = Readonly<Record<string, string>>;

/** One skill model: its state and questions, rules v1, the typed reading of words, and Harmful. */
export interface SkillModel<S, A, R extends string> {
    task: 'hunt' | 'gather' | 'place';
    state(s: S): string;
    questions(s: S): Record<string, ChoiceQuestion>;
    /** Rules v1: the right words and the rule that decided. */
    rules(s: S): { words: Words; rule: R };
    /** The words as a typed step, or null when they don't fit together (malformed). */
    read(words: Words): A | null;
    /** laya-go Harmful on the words. */
    harmful(s: S, words: Words): boolean;
}

/** Why the rules' answer was acted on: no model (task off), no answer, unsure, malformed, or harmful (veto). */
export const SKILL_WHYS = ['rules', 'no-answer', 'low-confidence', 'malformed', 'veto'] as const;
export type SkillWhy = (typeof SKILL_WHYS)[number];

/** What the model said: its words, the lowest top probability over the questions, the request time. */
export interface SkillAsked { words: Words; p: number; ms: number }

export interface SkillDecision<A, R extends string> {
    state: string;
    /** The step acted on (the model's, or the rules' in its place). */
    step: A;
    /** Its words. */
    words: Words;
    source: 'model' | 'rules';
    /** The rules' rule for this situation (what they would answer, whoever decided). */
    rule: R;
    why?: SkillWhy;
    asked?: SkillAsked;
}

/** readWords: each question's top choice when it is one of the options, else null (malformed). */
export function readWords(r: DecideResult, qs: Readonly<Record<string, ChoiceQuestion>>): { words: Words; p: number } | null {
    const words: Record<string, string> = {};
    let p = 1;
    for (const [name, q] of Object.entries(qs)) {
        const a = r.answers[name];
        if (!a || a.type !== 'choice' || !q.criteria.includes(a.top)) return null;
        words[name] = a.top;
        p = Math.min(p, a.topProbability);
    }
    return { words, p };
}

/** decideSkill: the step for s (client null: the task is off, the rules alone). */
export async function decideSkill<S, A, R extends string>(m: SkillModel<S, A, R>, s: S, client: ModelDecider | null, minConfidence: number): Promise<SkillDecision<A, R>> {
    const state = m.state(s);
    const qs = m.questions(s);
    const r = m.rules(s);
    const ruleStep = m.read(r.words);
    if (!ruleStep) throw new Error(`${m.task} rules gave unreadable words ${JSON.stringify(r.words)}`);
    const byRules = (why: SkillWhy, asked?: SkillAsked): SkillDecision<A, R> =>
        ({ state, step: ruleStep, words: r.words, source: 'rules', rule: r.rule, why, ...(asked ? { asked } : {}) });
    if (!client) return byRules('rules');
    const res = await client.decide(m.task, state, qs).catch(() => null);
    if (!res) return byRules('no-answer');
    const read = readWords(res, qs);
    if (!read) return byRules('malformed', { words: {}, p: 0, ms: res.ms });
    const asked: SkillAsked = { words: read.words, p: read.p, ms: res.ms };
    const step = m.read(read.words);
    if (!step) return byRules('malformed', asked);
    if (read.p < minConfidence) return byRules('low-confidence', asked);
    if (m.harmful(s, read.words)) return byRules('veto', asked);
    return { state, step, words: read.words, source: 'model', rule: r.rule, asked };
}

/** The skill models' default min_confidence (as craft). */
export const SKILL_MIN_CONFIDENCE = 0.3;
