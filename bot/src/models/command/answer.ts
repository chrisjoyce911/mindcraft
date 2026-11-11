// The command answer: the five answers in the words the plan reads, or why there is none to act on.

import type { DecideResult } from '../../types/models.js';
import { COUNTS, TIERS, commandWords, itemWords, type CommandPrompt, type CommandWord, type CountWord, type ItemKey, type Tier } from './vocab.js';

/** What the model said, as it said it (the old log entry's addressed, command, p, item, tier, count, ms). */
export interface CommandSaid { addressed: number; command: string; p: number; item: string; tier: string; count: string; ms: number; model: string }
/** The same, every word one of the prompt's options. */
export interface CommandAsked extends CommandSaid { command: CommandWord; item: ItemKey; tier: Tier; count: CountWord }

export type CommandRead =
    | { ok: true; asked: CommandAsked }
    | { ok: false; why: 'no-answer' }
    | { ok: false; why: 'malformed'; said: CommandSaid };

const inList = <T extends string>(list: readonly T[], v: string): v is T => (list as readonly string[]).includes(v);

/** read checks a command reply: every answer there, every word one of prompt v's options. */
export function read(result: DecideResult | null, v: CommandPrompt): CommandRead {
    const a = result?.answers;
    const addressed = a?.Addressed, command = a?.Command, item = a?.Item, tier = a?.Tier, count = a?.Count;
    if (!result || !addressed || !command || !item || !tier || !count || addressed.type !== 'noul') return { ok: false, why: 'no-answer' };
    const said: CommandSaid = {
        addressed: addressed.probability, command: command.top, p: command.topProbability,
        item: item.top, tier: tier.top, count: count.top, ms: result.ms, model: result.model,
    };
    if (!Number.isFinite(said.addressed) || !Number.isFinite(said.p)) return { ok: false, why: 'malformed', said };
    const c = said.command, i = said.item, t = said.tier, n = said.count;
    if (!inList(commandWords(v), c) || !inList(itemWords(v), i) || !inList(TIERS, t) || !inList(COUNTS, n)) return { ok: false, why: 'malformed', said };
    return { ok: true, asked: { ...said, command: c, item: i, tier: t, count: n } };
}
