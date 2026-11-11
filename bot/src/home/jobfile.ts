// The player's job kept across a restart (4.3; a typed port of the old bot's src/agent/laya/job_save.js). The
// player's jobs on the stack (not chores: those are decided again) are written to bots/<name>/laya-job.json as
// {savedAt, entries:[{spec, origin, by, progress, status, startedAt}]} on every stack change, and at most every
// THROTTLE_MS while a job steps (its progress). When none is left the file goes, as the old bot's did. After a
// restart a file saved less than MAX_AGE_MS ago is put back on the stack paused (the director resumes it, rule
// resume-paused); an older one, or one whose job can't be built, is lost, and andy says so. The file is read
// once and removed: a restored stack saves itself again at once. An old bot's file ({name, args, saved, at})
// reads as legacy: the new bot has no runners for its layaGather/…, so it is always lost; the old bot's loadJob
// reads ours as null (no name), so the bots can swap on one world.
import fs from 'fs';
import path from 'path';
import { CROPS, ORES, type JobFile, type JobSpec, type SavedJob } from '../types/index.js';

/** The spec's restore window (the old bot had 15 min). */
export const MAX_AGE_MS = 10 * 60_000;
/** A stepping job's progress is saved at most this often (a kill -9 loses at most this much of it). */
export const THROTTLE_MS = 2000;

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

/** isJobSpec: a well-formed spec of a known kind (the file may be old, hand-edited or from a newer bot). */
export function isJobSpec(v: unknown): v is JobSpec {
    if (!isObj(v)) return false;
    switch (v.kind) {
        case 'follow': case 'come': return str(v.player) && num(v.distance);
        case 'stay': return num(v.seconds);
        case 'mine': return (ORES as readonly unknown[]).includes(v.ore) && (num(v.count) || v.count === 'forever');
        case 'farm': return ((CROPS as readonly unknown[]).includes(v.crop) || v.crop === 'any')
            && (v.goal === 'forever' || (isObj(v.goal) && num(v.goal.count)));
        case 'craft': case 'gather': return str(v.item) && num(v.count);
        case 'hunt': return str(v.mob) && (v.item === null || str(v.item)) && num(v.count);
        case 'give': return str(v.player) && str(v.item) && num(v.count);
        case 'store': return str(v.item) && num(v.count);
        case 'eat': return str(v.item);
        case 'home': return true;
        default: return false;
    }
}

function savedJob(v: unknown): SavedJob | null {
    if (!isObj(v) || !isJobSpec(v.spec) || (v.origin !== 'player' && v.origin !== 'chore')) return null;
    if ((v.status !== 'running' && v.status !== 'paused') || !num(v.startedAt)) return null;
    if (v.by !== undefined && typeof v.by !== 'string') return null;
    return {
        spec: v.spec, origin: v.origin, ...(typeof v.by === 'string' ? { by: v.by } : {}),
        progress: v.progress ?? {}, status: v.status, startedAt: v.startedAt,
    };
}

/** What saveJobs keeps of a stack entry. */
export interface SavableJob { spec: JobSpec; origin: SavedJob['origin']; by?: string; progress: unknown; status: SavedJob['status']; startedAt: number }

/** jobFile: the file's contents for these stack entries (the player's only), or null when none is left. */
export function jobFile(entries: readonly SavableJob[], now: number): JobFile | null {
    const kept: SavedJob[] = entries.filter(e => e.origin === 'player').map(e => ({
        spec: e.spec, origin: e.origin, ...(e.by ? { by: e.by } : {}), progress: e.progress ?? {}, status: e.status, startedAt: e.startedAt,
    }));
    return kept.length ? { savedAt: now, entries: kept } : null;
}

/** saveJobs writes the player's jobs atomically (a temp file renamed over it), or removes the file. Never throws. */
export function saveJobs(file: string, entries: readonly SavableJob[], now: number = Date.now(), onError?: (e: unknown) => void): JobFile | null {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        const doc = jobFile(entries, now);
        if (!doc) { fs.rmSync(file, { force: true }); return null; }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(doc));
        fs.renameSync(tmp, file);
        return doc;
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
        onError?.(e);
        return null;
    }
}

/** An old bot's laya-job.json entry. */
export interface LegacyJob { name: string; args: unknown[]; at: number }

export type LoadedJobs =
    /** entries: the well-formed ones; lost: how many were malformed or of an unknown kind. */
    | { kind: 'typed'; savedAt: number; fresh: boolean; entries: SavedJob[]; lost: number }
    | { kind: 'legacy'; entry: LegacyJob; fresh: boolean };

/** loadJobs reads and removes the saved jobs; null when there is no (readable) file. */
export function loadJobs(file: string, now: number = Date.now()): LoadedJobs | null {
    const r = readJobs(file, now);
    try { fs.rmSync(file, { force: true }); } catch { /* gone */ }
    return r;
}

/** readJobs reads the saved jobs and leaves the file (a restart waits for the world before it takes them). */
export function readJobs(file: string, now: number = Date.now()): LoadedJobs | null {
    let raw: string;
    try { raw = fs.readFileSync(file, 'utf8'); } catch { return null; }
    let doc: unknown;
    try { doc = JSON.parse(raw); } catch { return null; }
    if (!isObj(doc)) return null;
    if (str(doc.name) && Array.isArray(doc.args)) {
        const at = num(doc.at) ? doc.at : 0;
        return { kind: 'legacy', entry: { name: doc.name, args: doc.args, at }, fresh: now - at <= MAX_AGE_MS };
    }
    if (!num(doc.savedAt) || !Array.isArray(doc.entries)) return null;
    const entries: SavedJob[] = [];
    let lost = 0;
    for (const e of doc.entries) { const j = savedJob(e); if (j) entries.push(j); else lost++; }
    return { kind: 'typed', savedAt: doc.savedAt, fresh: now - doc.savedAt < MAX_AGE_MS, entries, lost };
}

const words = (x: unknown): string => String(x).replace(/_/g, ' ');
/** "4 coal", "coal" when the count says nothing (forever, −1, 0). */
const counted = (n: number | 'forever' | 'any', item: string): string =>
    (typeof n === 'number' && n > 0 ? `${n} ` : '') + words(item);

/** jobWords: what andy calls a job when he talks about it ("follow tester", "get 4 coal"). */
export function jobWords(s: JobSpec): string {
    switch (s.kind) {
        case 'follow': return `follow ${s.player}`;
        case 'come': return `come to ${s.player}`;
        case 'stay': return 'stay here';
        case 'give': return `give ${s.player} ${counted(s.count, s.item)}`;
        case 'store': return `put ${counted(s.count, s.item)} in the chest`;
        case 'home': return 'set my home chest';
        case 'mine': return `mine ${counted(s.count, s.ore)}`;
        case 'gather': return `get ${counted(s.count, s.item)}`;
        case 'craft': return `make ${counted(s.count, s.item)}`;
        case 'farm': return `farm ${counted(s.goal === 'forever' ? 'forever' : s.goal.count, s.crop)}`;
        case 'hunt': return `hunt for ${counted(s.count, s.item ?? s.mob)}`;
        case 'eat': return `eat ${words(s.item)}`;
    }
}

const LEGACY_VERB: Record<string, string> = { layaCraft: 'make', layaGather: 'get', layaMine: 'mine', layaFarm: 'farm', hunt: 'hunt for' };

/** legacyJobWords: the old bot's jobWords, the same words ("get 4 coal", "hunt for 3 beef", "farm any"). */
export function legacyJobWords(e: { name: string; args: readonly unknown[] }): string {
    const [item, n] = e.name === 'hunt' ? [e.args[1], e.args[2]] : [e.args[0], e.args[1]];
    const what = [n != null && n !== 'any' ? n : null, item == null ? null : words(item)].filter(x => x != null).join(' ');
    return `${LEGACY_VERB[e.name] ?? 'do'}${what ? ' ' + what : ''}`;
}

/** restoreMessage: what andy says after a restart about the saved job (the old bot's two lines). */
export function restoreMessage(jobWordsText: string, restored: boolean): string {
    return restored
        ? `I was restarted while I was going to ${jobWordsText}. I'll carry on with it.`
        : `I was restarted and lost my job (${jobWordsText}). Ask me again if you still want it.`;
}

/** What JobSaver needs of the stack (JobStack satisfies it). */
export interface SavableStack {
    readonly entries: readonly SavableJob[];
    onChange: ((s: never) => void) | null;
    onProgress: ((s: never) => void) | null;
}

/**
 * JobSaver keeps one stack's player jobs in the file: every stack change at once, a stepping job's progress at
 * most every throttleMs (trailing, so the last progress is written). detach() stops it (a disposed director's
 * stack must never rewrite or remove the file); flush() writes a pending progress save now.
 */
export class JobSaver {
    private stack: SavableStack | null = null;
    private timer: NodeJS.Timeout | null = null;
    private lastAt = -Infinity;

    constructor(private readonly file: string, private readonly opts: { now?: () => number; throttleMs?: number; onError?: (e: unknown) => void } = {}) {}

    private get now(): number { return (this.opts.now ?? Date.now)(); }

    attach(stack: SavableStack): void {
        this.detach();
        this.stack = stack;
        stack.onChange = () => this.save();
        stack.onProgress = () => this.progressed();
    }

    detach(): void {
        this.cancel();
        if (this.stack) { this.stack.onChange = null; this.stack.onProgress = null; }
        this.stack = null;
    }

    /** save: write the stack now. */
    save(): void {
        this.cancel();
        if (!this.stack) return;
        this.lastAt = this.now;
        saveJobs(this.file, this.stack.entries, this.lastAt, this.opts.onError);
    }

    /** progressed: a job stepped; save now if the last save was throttleMs ago, else once that is up. */
    progressed(): void {
        if (!this.stack || this.timer) return;
        const wait = this.lastAt + (this.opts.throttleMs ?? THROTTLE_MS) - this.now;
        if (wait <= 0) { this.save(); return; }
        this.timer = setTimeout(() => { this.timer = null; this.save(); }, wait);
        this.timer.unref?.();
    }

    flush(): void { if (this.timer) this.save(); }

    private cancel(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

/** What to do with the saved jobs after a restart: which go back on the stack, what andy says, the console lines. */
export interface RestorePlan { restore: SavedJob[]; say: string[]; notes: string[] }

/**
 * planRestore: a fresh file's jobs that can run (canRun: the kind has a runner) are restored; the rest are lost
 * and andy says which. A give that already tossed its items is dropped quietly: the items have left andy (the
 * pickup wait didn't survive the restart), so it must never toss again, and there is nothing to ask again for.
 */
export function planRestore(loaded: LoadedJobs | null, canRun: (j: SavedJob) => boolean, now: number = Date.now()): RestorePlan {
    const plan: RestorePlan = { restore: [], say: [], notes: [] };
    if (!loaded) return plan;
    if (loaded.kind === 'legacy') {
        plan.notes.push(`restart: job ${loaded.entry.name} lost (an old bot's job)`);
        plan.say.push(restoreMessage(legacyJobWords(loaded.entry), false));
        return plan;
    }
    for (const j of loaded.entries) {
        const p = j.progress as { tossed?: unknown } | null;
        if (j.spec.kind === 'give' && p && typeof p === 'object' && p.tossed) {
            plan.notes.push(`restart: job give dropped (already tossed)`);
        } else if (loaded.fresh && canRun(j)) {
            plan.restore.push(j);
            plan.notes.push(`restart: job ${j.spec.kind} restored`);
        } else {
            plan.notes.push(`restart: job ${j.spec.kind} lost (${loaded.fresh ? 'no runner' : `saved ${Math.round((now - loaded.savedAt) / 1000)} s ago`})`);
            plan.say.push(restoreMessage(jobWords(j.spec), false));
        }
    }
    if (loaded.lost) {
        plan.notes.push(`restart: ${loaded.lost} saved job(s) unreadable, lost`);
        if (!loaded.entries.length) plan.say.push(restoreMessage('a job I could not read', false));
    }
    const top = plan.restore[plan.restore.length - 1];
    if (top) plan.say.unshift(restoreMessage(jobWords(top.spec), true));
    return plan;
}

/** waitsFor: the players a restored job needs in sight before it resumes (its player, else who asked). */
export function waitsFor(loaded: LoadedJobs | null): string[] {
    if (loaded?.kind !== 'typed') return [];
    const who = loaded.entries.map(j => ('player' in j.spec ? j.spec.player : j.by)).filter((n): n is string => !!n);
    return [...new Set(who)];
}

/** After a spawn, a restore waits at least this for the world around andy to load, */
export const RESTORE_MIN_MS = 1000;
/** and at most this for the job's players to come into sight. */
export const RESTORE_MAX_MS = 5000;
