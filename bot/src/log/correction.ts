// The correction path (tasks.md 5.7, design §11.2, skills-spec v1 "Correction = cases + short retrain"): turn one
// laya-<task>.jsonl line into a correction case. The training controller's POST /job (laya-go internal/trainctl
// JobRequest: model, conf, priority, from, note, epochs, lr, extra) carries no case data, so a case holds two parts:
//   1. the case itself: the line's exact state, what the log says was answered (and by whom), the outcome, and the
//      person's right answer. laya-go adds it to the game's generator as rule cases (a manual laya-go step);
//   2. `job`: exactly the /job body for a short retrain from the model in place (priority next, from "").
// This tool never touches the network: submit `job` only after laya-go has the case, e.g.
//   jq .job case.json | curl -s -X POST localhost:8095/job -H 'X-Trainctl: 1' -d @-
//
// CLI: node bot/dist/src/log/correction.js --task craft --right Action=craft,Item=stick,Count=4
//        [--log <path>] [--line N | --time <ISO> | --match <text>] [--model craft] [--note "..."] [--out case.json]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * A task with a decision log: the new bot's eight plus the old bot's chores (laya-chores.jsonl). Its own list, not
 * jsonl.ts's LOG_TASKS, so the tool stands on its own while a task's log is still being added there.
 */
export const CORRECTION_TASKS = ['director', 'eat', 'defend', 'command', 'follow', 'craft', 'mine', 'farm', 'chores'] as const;
export type CorrectionTask = (typeof CORRECTION_TASKS)[number];
export const isCorrectionTask = (s: string): s is CorrectionTask => (CORRECTION_TASKS as readonly string[]).includes(s);

/** Each task's question names (bot/src/models/<task>/questions.ts; chores: v1.1's Chore, v2's Skill and Target). */
export const QUESTION_NAMES: Readonly<Record<CorrectionTask, readonly string[]>> = {
    director: ['Activity'],
    eat: ['Eat', 'Food'],
    defend: ['Action', 'Target', 'Weapon', 'Danger'],
    command: ['Addressed', 'Command', 'Item', 'Tier', 'Count'],
    follow: ['Move', 'Hazard'],
    craft: ['Action', 'Item', 'Count'],
    mine: ['Action', 'Hazard', 'Unload'],
    farm: ['Action', 'Target', 'Item', 'Unload'],
    chores: ['Chore', 'Skill', 'Target'],
};

/** Who gave the answers in `answered`: the model, the rules (the line's step came from them), or nobody. */
export type AnsweredBy = 'model' | 'rules' | 'none';
/** A question's answer: a criteria word, or a noul probability as logged. */
export type AnswerValue = string | number;
export type Answers = Record<string, AnswerValue>;

/** The training controller's POST /job body (laya-go trainctl JobRequest; only the fields a correction sets). */
export interface JobRequest {
    model: string;
    /** "" = the model's own training config. */
    conf: string;
    priority: 'next' | 'normal';
    /** "" = continue from the model in place. */
    from: string;
    note: string;
}

export interface CorrectionCase {
    kind: 'laya-correction';
    version: 1;
    model: string;
    task: CorrectionTask;
    time: string;
    /** `<log path>:<line number>` (1-based). */
    source: string;
    /** The line's state, unchanged. */
    state: string;
    answered: Answers;
    by: AnsweredBy;
    p?: number;
    outcome?: string;
    reason?: string;
    right: Answers;
    note?: string;
    job: JobRequest;
}

export class CorrectionError extends Error {
    override name = 'CorrectionError';
}

type Line = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const word = (v: unknown): AnswerValue | undefined => str(v) ?? num(v);

/** Copy the given log fields into answers under their question names, leaving out the missing ones. */
function pick(line: Line, map: Readonly<Record<string, string>>): Answers {
    const out: Answers = {};
    for (const [q, field] of Object.entries(map)) {
        const v = word(line[field]);
        if (v !== undefined) out[q] = v;
    }
    return out;
}

const byOf = (a: Answers, source?: string): AnsweredBy =>
    Object.keys(a).length === 0 ? 'none' : source === 'rules' ? 'rules' : 'model';

/** What the line says was answered, and by whom (per task: see QUESTION_NAMES and the log builders in log/jsonl.ts). */
export function answeredOf(task: CorrectionTask, line: Line): { answered: Answers; by: AnsweredBy } {
    const source = str(line.source);
    switch (task) {
        case 'director': {
            // a fallback line (why) keeps the model's word in `model`; `answer` is then the rules' word
            const said = str(line.model);
            if (said !== undefined) return model({ Activity: said });
            const answered = pick(line, { Activity: 'answer' });
            return { answered, by: byOf(answered, source) };
        }
        case 'chores': {
            const answered = pick(line, { Chore: 'answer' });
            return { answered, by: byOf(answered, source) };
        }
        case 'eat': return model(pick(line, { Eat: 'eat', Food: 'food' }));
        case 'defend': return model(pick(line, { Action: 'action', Target: 'target', Weapon: 'weapon', Danger: 'danger' }));
        case 'command':
            return model(pick(line, { Addressed: 'addressed', Command: 'command', Item: 'item', Tier: 'tier', Count: 'count' }));
        case 'follow': return model(pick(line, { Move: 'move', Hazard: 'hazard' }));
        case 'craft': {
            const answered = pick(line, { Action: 'action', Item: 'item', Count: 'count' });
            if (typeof answered.Count === 'number') answered.Count = String(answered.Count);
            return { answered, by: byOf(answered, source) };
        }
        case 'mine': {
            // `model` is the model's step; `action` is the step taken (maybe the rules').
            if (str(line.rule) === undefined) throw new CorrectionError('not a mine step line (no rule): nothing was decided');
            return model(pick(line, { Action: 'model', Hazard: 'hazard', Unload: 'unload' }));
        }
        case 'farm': {
            // The model's words come first, whatever the source: banned (its answer "action target" the job had
            // banned; action… are then the rules' or a dry pond) or model_action (a v1 unsure answer).
            const unload = pick(line, { Unload: 'unload' });
            const banned = str(line.banned);
            if (banned !== undefined) {
                const [action, ...target] = banned.split(' ');
                const a: Answers = { ...unload };
                if (action) a.Action = action;
                if (target.length) a.Target = target.join(' ');
                return model(a);
            }
            if (str(line.model_action) !== undefined) return model({ ...pick(line, { Action: 'model_action' }), ...unload });
            if (source === undefined || source === 'low-confidence') return model(unload);
            // A dry line after a sure model wait carries no model words: the pond step taken, by rules, is all it says.
            const answered = { ...pick(line, { Action: 'action', Target: 'target', Item: 'item' }), ...unload };
            return { answered, by: Object.keys(answered).length === 0 ? 'none' : source === 'model' ? 'model' : 'rules' };
        }
    }
}
const model = (answered: Answers): { answered: Answers; by: AnsweredBy } => ({ answered, by: byOf(answered) });

/** parseRight: "Action=craft,Item=stick,Count=4" → answers (split on ",", then on the first "=" only). */
export function parseRight(text: string): Answers {
    const out: Answers = {};
    for (const part of text.split(',')) {
        if (!part.trim()) continue;
        const eq = part.indexOf('=');
        if (eq <= 0) throw new CorrectionError(`right answer "${part}" is not Question=answer`);
        const q = part.slice(0, eq).trim(), v = part.slice(eq + 1).trim();
        if (!v) throw new CorrectionError(`right answer for ${q} is empty`);
        out[q] = v;
    }
    return out;
}

export interface CaseOptions {
    model?: string;
    note?: string;
    /** Where the line came from (`<path>:<n>`). */
    source?: string;
}

const same = (a: AnswerValue | undefined, b: AnswerValue): boolean => a !== undefined && String(a) === String(b);

/** correctionCase: the case for one log line and the person's right answer. Throws CorrectionError when it can't. */
export function correctionCase(task: CorrectionTask, lineText: string, right: Answers, opts: CaseOptions = {}): CorrectionCase {
    let parsed: unknown;
    try { parsed = JSON.parse(lineText); } catch { throw new CorrectionError('the line is not JSON'); }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new CorrectionError('the line is not a JSON object');
    const line = parsed as Line;
    const state = str(line.state);
    if (state === undefined) throw new CorrectionError('the line has no state: not a decision line');
    const names = Object.keys(right);
    if (names.length === 0) throw new CorrectionError('no right answer given');
    const known = QUESTION_NAMES[task];
    for (const q of names) {
        if (!known.includes(q)) throw new CorrectionError(`${task} has no question ${q} (questions: ${known.join(', ')})`);
    }
    const { answered, by } = answeredOf(task, line);
    if (names.every(q => same(answered[q], right[q]!))) throw new CorrectionError('the right answer is what was answered: nothing to correct');

    const time = str(line.time) ?? '';
    const modelName = opts.model ?? task;
    const was = Object.keys(answered).length ? Object.values(answered).join(' ') : 'no answer';
    const job: JobRequest = {
        model: modelName, conf: '', priority: 'next', from: '',
        note: `correction ${task} ${time}: ${was} → ${names.map(q => right[q]).join(' ')}`,
    };
    const p = num(line.p), outcome = str(line.outcome), reason = str(line.reason);
    return {
        kind: 'laya-correction', version: 1, model: modelName, task, time, source: opts.source ?? '',
        state, answered, by,
        ...(p !== undefined ? { p } : {}),
        ...(outcome !== undefined ? { outcome } : {}),
        ...(reason !== undefined ? { reason } : {}),
        right,
        ...(opts.note ? { note: opts.note } : {}),
        job,
    };
}

/** How to choose the line: a 1-based line number, an exact time, the last line containing text, or the last with a state. */
export type LineSelector = { line: number } | { time: string } | { match: string } | Record<string, never>;

/** pickLine: the chosen line and its 1-based number. */
export function pickLine(lines: readonly string[], sel: LineSelector): { n: number; text: string } {
    if ('line' in sel) {
        const text = lines[sel.line - 1];
        if (!Number.isInteger(sel.line) || sel.line < 1 || text === undefined || !text.trim()) {
            throw new CorrectionError(`no line ${sel.line} (the log has ${lines.length})`);
        }
        return { n: sel.line, text };
    }
    const last = (ok: (t: string) => boolean, what: string): { n: number; text: string } => {
        for (let i = lines.length - 1; i >= 0; i--) {
            const t = lines[i]!;
            if (t.trim() && ok(t)) return { n: i + 1, text: t };
        }
        throw new CorrectionError(`no line ${what}`);
    };
    const field = (t: string, k: string): unknown => { try { return (JSON.parse(t) as Line)[k]; } catch { return undefined; } };
    if ('time' in sel) return last(t => field(t, 'time') === sel.time, `with time ${sel.time}`);
    if ('match' in sel) return last(t => t.includes(sel.match), `containing "${sel.match}"`);
    return last(t => typeof field(t, 'state') === 'string', 'with a state');
}

// ---- CLI ----

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const USAGE = 'usage: correction --task <task> --right Q=answer[,Q=answer] [--log path] [--line N | --time ISO | --match text] [--model name] [--note text] [--out file]';

export function runCli(argv: readonly string[]): string {
    const args: Record<string, string> = {};
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]!;
        if (!a.startsWith('--')) throw new CorrectionError(`unexpected argument ${a}\n${USAGE}`);
        const v = argv[i + 1];
        if (v === undefined) throw new CorrectionError(`${a} needs a value\n${USAGE}`);
        args[a.slice(2)] = v;
        i++;
    }
    const task = args.task;
    if (!task || !isCorrectionTask(task)) throw new CorrectionError(`--task must be one of ${CORRECTION_TASKS.join(', ')}\n${USAGE}`);
    if (!args.right) throw new CorrectionError(`--right is required\n${USAGE}`);
    const log = args.log ?? path.join(REPO, 'bots/andy/logs', `laya-${task}.jsonl`);
    let text: string;
    try { text = fs.readFileSync(log, 'utf8'); } catch { throw new CorrectionError(`can't read ${log}`); }
    const lines = text.split('\n');
    const sel: LineSelector = args.line !== undefined ? { line: Number(args.line) }
        : args.time !== undefined ? { time: args.time }
        : args.match !== undefined ? { match: args.match } : {};
    const { n, text: lineText } = pickLine(lines, sel);
    const opts: CaseOptions = { source: `${path.relative(REPO, path.resolve(log))}:${n}` };
    if (args.model) opts.model = args.model;
    if (args.note) opts.note = args.note;
    const out = JSON.stringify(correctionCase(task, lineText, parseRight(args.right), opts), null, 2) + '\n';
    if (args.out) { fs.writeFileSync(args.out, out); return ''; }
    return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        process.stdout.write(runCli(process.argv.slice(2)));
    } catch (e) {
        process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
        process.exit(1);
    }
}
