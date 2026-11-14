// The craft model's decision for one step (the old craft.js runCraft loop body's choice): the model's step when it
// is sure and possible, else the recipe rules' step (ingredientFromChest, then plan). Pure: the client is passed in.
// The decision order is the old one:
//   no client         → the rules alone (why 'rules'): the model's place is a done/none/1 step with p 0
//   client, no answer → stop (no-answer)
//   p < min_confidence → low-confidence; else check(); refused → ingredientFromChest || plan;
//   no rule           → done when the goal is carried, else stop with the refusal.
import type { ModelDecider } from '../../types/models.js';
import { readCraft } from './answer.js';
import { craftQuestions } from './questions.js';
import { craftState, NONE, type CraftSituation } from './render.js';
import { check, ingredientFromChest, plan, type CheckWhy, type CraftStep } from './rules.js';

export * from './data.js';
export * from './render.js';
export * from './questions.js';
export * from './answer.js';
export * from './rules.js';
export * from './items.js';

/** Why the rules took over a step. */
export type CraftWhy = 'rules' | 'low-confidence' | 'malformed' | CheckWhy;

/** The step fields of a craft log line: the model's words (or the rules' placeholder), its p and ms. */
export interface CraftEntry extends CraftStep { p: number; ms: number; source?: 'rules' }

export type CraftDecision =
    /** The model was asked and didn't answer: the run stops. */
    | { kind: 'stop'; state: string; why: 'no-answer' }
    /** The step was refused and no rule helps: done when the goal is carried, else the run stops with why. */
    | { kind: 'end'; state: string; entry: CraftEntry; why: CraftWhy; done: boolean }
    /** The model said done with the goal carried. */
    | { kind: 'done'; state: string; entry: CraftEntry }
    /** Do step: the model's, or (with why and rule) the rules' in its place. */
    | { kind: 'act'; state: string; entry: CraftEntry; step: CraftStep; why?: CraftWhy; rule?: CraftStep };

export const CRAFT_MIN_CONFIDENCE = 0.3;

/** decideCraftStep decides the next step in s. client null: the task's rules alone (no model). */
export async function decideCraftStep(s: CraftSituation, client: ModelDecider | null, minConfidence = CRAFT_MIN_CONFIDENCE): Promise<CraftDecision> {
    const state = craftState(s);
    let entry: CraftEntry;
    let why: CraftWhy | null;
    if (!client) {
        entry = { action: 'done', item: NONE, count: 1, p: 0, ms: 0, source: 'rules' };
        why = 'rules';
    } else {
        const r = await client.decide('craft', state, craftQuestions(s)).catch(() => null);
        if (!r) return { kind: 'stop', state, why: 'no-answer' };
        const read = readCraft(r);
        if (read.ok) {
            const { action, item, count, p, ms } = read.asked;
            entry = { action, item, count, p, ms };
            why = p < minConfidence ? 'low-confidence' : check(s, { action, item, count });
        } else {
            entry = { action: 'done', item: NONE, count: 1, p: 0, ms: r.ms };
            why = 'malformed';
        }
    }
    const step: CraftStep = { action: entry.action, item: entry.item, count: entry.count };
    if (why) {
        // the recipe rules take over for this step (as the follow veto does): a craft missing an ingredient the
        // chest has takes it first
        const rule = ingredientFromChest(s, step, why) || plan(s);
        if (!rule) return { kind: 'end', state, entry, why, done: (s.have[s.goal] || 0) >= s.count };
        return { kind: 'act', state, entry, step: rule, why, rule };
    }
    if (step.action === 'done') return { kind: 'done', state, entry };
    return { kind: 'act', state, entry, step };
}
