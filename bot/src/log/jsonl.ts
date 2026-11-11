// The decision logs (design §5.6): laya-director.jsonl, laya-eat.jsonl, laya-defend.jsonl and laya-command.jsonl,
// one JSON line per decision, in the old bot's format: the same fields in the same order with the same value
// formats (src/agent/laya/{director,eat,defend,command}.js; test/fixtures/laya-logs pins them, bot/test/logs.test.ts checks
// them byte for byte). The line builders are pure; JsonlLog appends `{time, ...line}` and never throws.
import fs from 'fs';
import path from 'path';
import type { LeaseEvent } from '../core/lease.js';
import type { Command } from '../types/commands.js';
import type { DefendAction, FallbackWhy } from '../types/decisions.js';
import { legacyLine } from './legacyLine.js';

// What the builders read (log imports only types and core: a director entry, an EatDecision and a
// DefendDecision fit these as they are).
/** A director decision as the loop logs it (DirectorLogEntry). */
export interface DirectorLogInput {
    event: string; state: string; answer: string; rule: string; source: 'model' | 'rules';
    p?: number; why?: string; model?: string; acted?: string;
}
/** An eat decision (EatDecision): asked holds the model's words when it answered. */
export interface EatLogInput {
    state: string; source: 'model' | 'rules'; why?: FallbackWhy; veto?: string;
    asked?: { eatP: number; food: string; p: number; ms: number };
}
/** A defend decision (DefendDecision): answer is the action taken; asked holds the model's words. */
export interface DefendLogInput {
    state: string; source: 'model' | 'rules'; answer: DefendAction; why?: FallbackWhy; veto?: string; override?: string;
    asked?: { action: string; target: string; weapon: string; p: number; danger: number; ms: number };
}

/** A command decision (CommandDecision): the plan, and what the model said when it answered. */
export interface CommandLogInput {
    state: string;
    plan: { kind: 'run'; commands: readonly Command[] } | { kind: 'reply' } | { kind: 'canned'; why: string } | { kind: 'ignore' };
    said?: { addressed: number; command: string; p: number; item: string; tier: string; count: string; ms: number };
}

export const LOG_TASKS = ['director', 'eat', 'defend', 'command'] as const;
export type LogTask = (typeof LOG_TASKS)[number];

/** The director's line: the old Director.tick logDecision entry (no `acted`: that's the console's). */
export interface DirectorLine {
    event: string; state: string; answer: string; rule: string; source: 'model' | 'rules';
    p?: number; why?: string; model?: string;
}

/** What became of an eat decision the eat model answered. eat-later: not acted on yet (no line: re-asked). */
export type EatOutcome = 'ate' | 'eat-failed' | 'no-eat' | 'eat-later';

/** The model's words in an eat line: Eat probability, Food top word, Food top probability, request ms. */
interface EatAskedFields { eat: number; food: string; p: number; ms: number }
export type EatLine =
    | { state: string; outcome: 'fallback'; reason: FallbackWhy }
    | ({ state: string } & EatAskedFields & { veto?: string; outcome: 'fallback'; reason: FallbackWhy })
    | ({ state: string } & EatAskedFields & { outcome: Exclude<EatOutcome, 'eat-later'> });

/** The model's words in a defend line: Action/Target/Weapon top words, Action top probability, Danger, ms. */
interface DefendAskedFields { action: string; target: string; weapon: string; p: number; danger: number; ms: number }
export type DefendLine =
    | { state: string; outcome: 'fallback'; reason: FallbackWhy }
    | ({ state: string } & DefendAskedFields & { veto?: string; outcome: 'fallback'; reason: FallbackWhy })
    | ({ state: string } & DefendAskedFields & { override?: string; outcome: DefendAction });

/**
 * The command line: the old handleCommand entry. kind keeps the old words: a canned reply is `llm` with the
 * reason (the old bot handed those to the LLM, or with no_llm said the canned line); lines are the old command
 * lines (legacyLine) of a run.
 */
export interface CommandLine {
    state: string; kind: 'run' | 'reply' | 'llm' | 'ignore'; reason?: string; lines?: string[]; ms?: number;
    addressed?: number; command?: string; p?: number; item?: string; tier?: string; count?: string;
}

/** The lease's stop-overrun line (design §4) shares the director's file. */
export type StopOverrunLine = LeaseEvent;

export function directorLine(e: DirectorLogInput): DirectorLine {
    return {
        event: e.event, state: e.state, answer: e.answer, rule: e.rule, source: e.source,
        ...(e.p !== undefined ? { p: e.p } : {}),
        ...(e.why ? { why: e.why, ...(e.model !== undefined ? { model: e.model } : {}) } : {}),
    };
}

/**
 * eatLine: the line for an eat decision, or null when the model wasn't asked (the rules alone decided: no
 * line, as the old bot's auto-eat wrote none) or the decision isn't settled yet (eat-later).
 */
export function eatLine(d: EatLogInput, outcome: EatOutcome): EatLine | null {
    if (d.source === 'rules' && !d.why) return null;
    const asked = d.asked ? { eat: d.asked.eatP, food: d.asked.food, p: d.asked.p, ms: d.asked.ms } : null;
    if (d.why) {
        if (!asked) return { state: d.state, outcome: 'fallback', reason: d.why };
        return { state: d.state, ...asked, ...(d.veto ? { veto: d.veto } : {}), outcome: 'fallback', reason: d.why };
    }
    if (!asked || outcome === 'eat-later') return null;
    return { state: d.state, ...asked, outcome };
}

/**
 * defendLine: the line for a defend decision (written before it is carried out, as the old step), or null
 * when the model wasn't asked. With a creeper override `action` stays the model's word and `outcome` is
 * the action taken.
 */
export function defendLine(d: DefendLogInput): DefendLine | null {
    if (d.source === 'rules' && !d.why) return null;
    const a = d.asked;
    const asked = a ? { action: a.action, target: a.target, weapon: a.weapon, p: a.p, danger: a.danger, ms: a.ms } : null;
    if (d.why) {
        if (!asked) return { state: d.state, outcome: 'fallback', reason: d.why };
        return { state: d.state, ...asked, ...(d.veto ? { veto: d.veto } : {}), outcome: 'fallback', reason: d.why };
    }
    if (!asked) return null;
    return { state: d.state, ...asked, ...(d.override ? { override: d.override } : {}), outcome: d.answer };
}

/** commandLine: the line for a command decision (every decision the model was asked about is written). */
export function commandLine(d: CommandLogInput): CommandLine {
    const p = d.plan;
    const line: CommandLine = { state: d.state, kind: p.kind === 'canned' ? 'llm' : p.kind };
    if (p.kind === 'canned') line.reason = p.why;
    if (p.kind === 'run') line.lines = p.commands.map(legacyLine).filter((l): l is string => l !== null);
    const a = d.said;
    if (a) {
        Object.assign(line, { ms: a.ms, addressed: +a.addressed.toFixed(3), command: a.command, p: +a.p.toFixed(3),
            item: a.item, tier: a.tier, count: a.count });
    }
    return line;
}

/** stamp: the line as written, `time` first (the old `{ time, ...entry }`). */
export function stamp(line: object, time: Date = new Date()): string {
    return JSON.stringify({ time: time.toISOString(), ...line });
}

/** JsonlLog appends lines to <dir>/laya-<task>.jsonl. Logging never stops the bot. */
export class JsonlLog {
    private made = false;
    constructor(private readonly dir: string, private readonly now: () => Date = () => new Date()) {}

    file(task: LogTask): string { return path.join(this.dir, `laya-${task}.jsonl`); }

    write(task: LogTask, line: DirectorLine | EatLine | DefendLine | CommandLine | StopOverrunLine | null): void {
        if (!line) return;
        try {
            if (!this.made) { fs.mkdirSync(this.dir, { recursive: true }); this.made = true; }
            fs.appendFileSync(this.file(task), stamp(line, this.now()) + '\n');
        } catch { /* logging never stops the bot */ }
    }
}
