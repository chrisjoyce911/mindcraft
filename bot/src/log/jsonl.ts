// The decision logs (design §5.6): laya-director.jsonl, laya-eat.jsonl, laya-defend.jsonl, laya-command.jsonl, laya-follow.jsonl, laya-craft.jsonl, laya-mine.jsonl and laya-farm.jsonl,
// one JSON line per decision, in the old bot's format: the same fields in the same order with the same value
// formats (src/agent/laya/{director,eat,defend,command}.js; test/fixtures/laya-logs pins them, bot/test/logs.test.ts checks
// them byte for byte). The line builders are pure; JsonlLog appends `{time, ...line}` and never throws.
import fs from 'fs';
import path from 'path';
import type { LeaseEvent } from '../core/lease.js';
import type { Command } from '../types/commands.js';
import type { DefendAction, FallbackWhy, FollowFallback } from '../types/decisions.js';
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

/** A follow step as the job logs it: the state, what the model said (when it answered), the veto, the outcome. */
export interface FollowLogInput {
    state: string;
    asked?: { move: string; p: number; hazard: number; ms: number };
    veto?: string;
    outcome: 'stepped' | 'wait' | 'fallback';
    reason?: FollowFallback;
}

/** A craft step as the craft job logs it (models/craft CraftEntry fits entry; rule is the rules' step). */
export interface CraftLogInput {
    goal: string;
    state: string;
    entry?: { action: string; item: string; count: number; p: number; ms: number; source?: 'rules' };
    outcome: CraftOutcome;
    reason?: string;
    rule?: { action: string; item: string; count: number };
}
export type CraftOutcome = 'did' | 'failed' | 'fallback' | 'done' | 'stop';

export const LOG_TASKS = ['director', 'eat', 'defend', 'command', 'follow', 'craft', 'mine', 'farm'] as const;
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

/** The follow step line: the old follow.js logStep entry ({state, move, p, hazard, ms, veto, outcome, reason}). */
export interface FollowLine {
    state: string; move?: string; p?: number; hazard?: number; ms?: number; veto?: string;
    outcome: 'stepped' | 'wait' | 'fallback'; reason?: FollowFallback;
}

/**
 * The craft step line: the old craft.js logStep entry ({goal, state, action, item, count, p, ms, [source],
 * outcome, [reason], [rule]}). action…ms are the model's words (or the rules' done/none/1 with p 0 and source
 * rules), also on the did/failed line after a fallback; rule is the step the rules did instead.
 */
export interface CraftLine {
    goal: string; state: string; action?: string; item?: string; count?: number; p?: number; ms?: number; source?: 'rules';
    outcome: CraftOutcome; reason?: string; rule?: { action: string; item: string; count: number };
}

/** A cell in a mine line. */
export interface Pos { x: number; y: number; z: number }

/**
 * A mine step as the mine job logs it (the old mine.js `entry`): the rules' answer, where andy stood, the state;
 * the model's words when it answered; the veto; the Unload probability (when Unload could be chosen); then what was
 * done, by whom and why the rules took over (why null: the model's), the moves dropped for a drop under them, the
 * ore collected, the plan segment a detour abandoned.
 */
export interface MineStepEntry {
    rule: string; pos: Pos; state: string;
    model?: string; p?: number; hazard?: number | undefined; ms?: number;
    veto?: string;
    /** Present (maybe undefined) when Unload could be chosen. */
    unload?: number | undefined;
    unload_later?: 'collect-first';
    action?: string; source?: 'model' | 'rules';
    /** Present (null: the model's step) after the step is chosen; absent on an unload line. */
    why?: string | null;
    drops?: string[];
    ore?: Pos | null;
    abandoned?: string | undefined;
}
export type MineStepOutcome = 'done' | 'failed' | 'stopped' | 'heal' | 'unsafe-ground' | 'partial';

/** The mine job's lines (the old mine.js logStep entries), each in the old field order. */
export type MineLine =
    | (MineStepEntry & { outcome: MineStepOutcome })
    | { pos: Pos; plan: 'blocked'; outcome: 'unsafe-ground' }
    | { rule: 'heal'; action: 'heal'; source: 'rules'; why: 'heal'; pos: Pos; health: number; food: number; hostiles: number;
        ate: number; retreated: boolean; health_after?: number; outcome: 'done' | 'stopped' }
    | { start: Pos; heading: string; toward: Pos | null; outcome: 'planned' }
    | { reuse: Pos; outcome: 'gone' }
    | { reuse: Pos; skipped: number; outcome: 'reused' }
    | { walk: Pos; segment: string; pos: Pos; state: string; outcome: 'done' | 'failed' }
    | { restart: Pos; outcome: 'restarted' }
    | { restart: Pos; from: Pos; heading: string; reason: 'unsafe'; outcome: 'restarted' };

const pos = (p: Pos): Pos => ({ x: p.x, y: p.y, z: p.z });

/** mineStepLine: a step entry with its outcome, in the old field order (keys the old entry had set, even when undefined). */
export function mineStepLine(e: MineStepEntry, outcome: MineStepOutcome): MineLine {
    const out: Record<string, unknown> = { rule: e.rule, pos: pos(e.pos), state: e.state };
    const keys = ['model', 'p', 'hazard', 'ms', 'veto', 'unload', 'unload_later', 'action', 'source', 'why', 'drops', 'ore', 'abandoned'] as const;
    for (const k of keys) if (k in e) out[k] = k === 'ore' && e.ore ? pos(e.ore) : e[k];
    out.outcome = outcome;
    return out as MineLine;
}

export const mineLines = {
    blocked: (p: Pos): MineLine => ({ pos: pos(p), plan: 'blocked', outcome: 'unsafe-ground' }),
    heal: (h: { pos: Pos; health: number; food: number; hostiles: number; ate: number; retreated: boolean; healthAfter?: number }, outcome: 'done' | 'stopped'): MineLine => ({
        rule: 'heal', action: 'heal', source: 'rules', why: 'heal', pos: pos(h.pos), health: h.health, food: h.food, hostiles: h.hostiles,
        ate: h.ate, retreated: h.retreated, ...(h.healthAfter !== undefined ? { health_after: h.healthAfter } : {}), outcome,
    }),
    start: (start: Pos, heading: string, toward: Pos | null): MineLine => ({ start: pos(start), heading, toward: toward ? pos(toward) : null, outcome: 'planned' }),
    gone: (reuse: Pos): MineLine => ({ reuse: pos(reuse), outcome: 'gone' }),
    reused: (reuse: Pos, skipped: number): MineLine => ({ reuse: pos(reuse), skipped, outcome: 'reused' }),
    walk: (walk: Pos, segment: string, at: Pos, state: string, ok: boolean): MineLine => ({ walk: pos(walk), segment, pos: pos(at), state, outcome: ok ? 'done' : 'failed' }),
    restart: (at: Pos): MineLine => ({ restart: pos(at), outcome: 'restarted' }),
    unsafeRestart: (entrance: Pos, from: Pos, heading: string): MineLine => ({ restart: pos(entrance), from: pos(from), heading, reason: 'unsafe', outcome: 'restarted' }),
};

/**
 * A farm step as the farm job logs it (the old farm.js `entry`): the state; the Unload probability (v2: present, maybe
 * undefined); what the model said (model_action when it wasn't sure, v1); the banned answer; the answer (action,
 * target, item: the answer's item, before a crop's seed is swapped in) and who chose it; the harvest.
 */
export interface FarmStepEntry {
    state: string;
    unload?: number | undefined;
    model_action?: string; p?: number; ms?: number;
    banned?: string;
    action?: string; target?: string; item?: string; source?: string;
    harvested?: number;
}
export type FarmOutcome = 'done' | 'failed' | 'veto' | 'wait' | 'low-confidence' | 'no-answer' | 'no-water' | 'went-to-water' | 'water-unreachable';

/** The farm job's lines (the old farm.js logStep entries), each in the old field order. */
export type FarmLine =
    | (FarmStepEntry & { outcome: FarmOutcome; veto?: string; water?: Pos })
    | { outcome: 'crafted' | 'craft-failed'; item: string; count: number };

/** farmStepLine: a step entry with its outcome (and a veto or the water walked to), in the old field order. */
export function farmStepLine(e: FarmStepEntry, outcome: FarmOutcome, extra: { veto?: string; water?: Pos } = {}): FarmLine {
    const out: Record<string, unknown> = { state: e.state };
    const keys = ['unload', 'model_action', 'p', 'ms', 'banned', 'action', 'target', 'item', 'source', 'harvested'] as const;
    for (const k of keys) if (k in e) out[k] = e[k];
    out.outcome = outcome;
    if (extra.veto !== undefined) out.veto = extra.veto;
    if (extra.water) out.water = pos(extra.water);
    return out as FarmLine;
}

export const farmCraftLine = (ok: boolean, item: string, count: number): FarmLine => ({ outcome: ok ? 'crafted' : 'craft-failed', item, count });

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

/** followLine: the line for one follow step (the job writes it only when log_steps). */
export function followLine(i: FollowLogInput): FollowLine {
    const a = i.asked;
    return {
        state: i.state,
        ...(a ? { move: a.move, p: a.p, hazard: a.hazard, ms: a.ms } : {}),
        ...(i.veto ? { veto: i.veto } : {}),
        outcome: i.outcome,
        ...(i.reason ? { reason: i.reason } : {}),
    };
}

/** craftLine: the line for one craft step (the job writes it only when log_steps). */
export function craftLine(i: CraftLogInput): CraftLine {
    const e = i.entry;
    return {
        goal: i.goal, state: i.state,
        ...(e ? { action: e.action, item: e.item, count: e.count, p: e.p, ms: e.ms, ...(e.source ? { source: e.source } : {}) } : {}),
        outcome: i.outcome,
        ...(i.reason ? { reason: i.reason } : {}),
        ...(i.rule ? { rule: { action: i.rule.action, item: i.rule.item, count: i.rule.count } } : {}),
    };
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

    write(task: LogTask, line: DirectorLine | EatLine | DefendLine | CommandLine | FollowLine | CraftLine | MineLine | FarmLine | StopOverrunLine | null): void {
        if (!line) return;
        try {
            if (!this.made) { fs.mkdirSync(this.dir, { recursive: true }); this.made = true; }
            fs.appendFileSync(this.file(task), stamp(line, this.now()) + '\n');
        } catch { /* logging never stops the bot */ }
    }
}
