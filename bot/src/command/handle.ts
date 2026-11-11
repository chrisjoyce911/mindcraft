// Player chat → the command model → typed Commands (bot-commands spec). The old bot's handleCommand without the
// LLM: what the model can't place gets the canned reply. The legacy `!name(args)` lines are parsed before this, at
// the harness boundary (main.ts, harness/legacy.ts).

import type { Command } from '../types/commands.js';
import type { Carried } from '../types/facts.js';
import type { ModelDecider } from '../types/models.js';
import { decideCommand, mergeCarry, type CommandOptions, type CommandPrompt } from '../models/command/index.js';
import { commandLine, type CommandLine } from '../log/jsonl.js';

export const CANNED = "Sorry, I only understand simple commands, like: follow me, come here, stop, mine 8 iron, " +
    "get 16 logs, craft a stone pickaxe, farm wheat, give me your coal, store everything, this is your chest.";

export interface CommandDeps {
    /** andy's name. */
    me: string;
    /** The command model, or null when the task is off (every message gets the canned reply). */
    model: { client: ModelDecider; prompt: CommandPrompt } | null;
    /** decision_models.tasks.command thresholds and defaults. */
    opts?: Partial<CommandOptions>;
    /** Inventory stacks in slot order (Facts.items), [] when not in game. */
    carry: () => readonly Carried[];
    /** The nearest hostile's name within 16, or null. */
    nearestHostile: () => string | null;
    say: (text: string) => void;
    /** Runs one Command; doneSay: what to say when its job ends done (home's "That's my chest now."). */
    run: (cmd: Command, doneSay?: string) => Promise<void> | void;
    /** Writes a laya-command.jsonl line (log_decisions decides whether it is kept). */
    log: (line: CommandLine) => void;
    /** The console. */
    note?: (text: string) => void;
}

/** handleChat decides one player message with the command model and carries the plan out. Never throws. */
export async function handleChat(from: string, message: string, deps: CommandDeps): Promise<void> {
    if (!deps.model) { deps.say(CANNED); return; }
    const d = await decideCommand(deps.me, {
        speaker: from, message, carry: mergeCarry(deps.carry()), nearestHostile: deps.nearestHostile(),
        prompt: deps.model.prompt, ...(deps.opts ? { opts: deps.opts } : {}),
    }, deps.model.client).catch(() => null);
    if (!d) { deps.say(CANNED); return; }
    deps.log(commandLine(d));
    const p = d.plan;
    deps.note?.(`[laya] command: ${p.kind}${p.kind === 'canned' ? ` (${p.why})` : ''}${d.said ? ` ← ${d.said.command} ${d.said.item} ${d.said.tier} ${d.said.count} p=${d.said.p.toFixed(2)} addressed=${d.said.addressed.toFixed(2)} ${d.said.ms} ms` : ''}`);
    switch (p.kind) {
        case 'ignore': return;
        case 'reply': deps.say(p.text); return;
        case 'canned': deps.say(CANNED); return;
        case 'run':
            if (p.say) deps.say(p.say);
            for (const cmd of p.commands) {
                try { await deps.run(cmd, p.doneSay); } catch (e) { deps.note?.(`[laya] command: run failed: ${String(e)}`); }
            }
            return;
    }
}
