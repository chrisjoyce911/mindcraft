// The command model's decision (laya-go games/command): a player's chat message → state → the model's five
// answers → a typed CommandPlan. Pure: the client is passed in; never throws (a client error is no answer).

import type { ModelDecider } from '../../types/models.js';
import { read, type CommandSaid } from './answer.js';
import { plan, type CommandContext, type CommandPlan } from './plan.js';
import { commandQuestions } from './questions.js';
import { commandState } from './render.js';

export * from './vocab.js';
export * from './render.js';
export * from './questions.js';
export * from './resolve.js';
export * from './answer.js';
export * from './plan.js';

export interface CommandDecision {
    plan: CommandPlan;
    /** The state asked about. */
    state: string;
    /** What the model said (also when it isn't acted on), when it answered. */
    said?: CommandSaid;
}

/**
 * decideCommand decides one player message. null when there is nothing to ask (a name empty or with a space:
 * the old handleCommand's "not handled").
 */
export async function decideCommand(me: string, ctx: CommandContext, client: ModelDecider): Promise<CommandDecision | null> {
    const state = commandState(me, ctx.speaker, ctx.message);
    if (!state) return null;
    const result = await client.decide('command', state, commandQuestions(ctx.prompt)).catch(() => null);
    const a = read(result, ctx.prompt);
    if (a.ok) return { plan: plan(a.asked, ctx), state, said: a.asked };
    if (a.why === 'malformed') return { plan: { kind: 'canned', why: 'malformed' }, state, said: a.said };
    return { plan: plan(null, ctx), state };
}
