// The JobStack (a typed port of the old bot's director.js JobStack). It holds jobs only: the running
// safety activity is the director's `current`, and the job under it is marked paused (Last interrupted).
// A player's new job replaces the top job; stop and death clear it. onChange and onProgress let 4.3 persist it
// (home/jobfile.ts), and restore puts a saved stack back after a restart.
import type { JobEnd, JobOrigin, JobSpec, JobState, SavedJob } from '../types/index.js';
import { itemWord, JOB_KINDS, type DirectorJobKind, type JobView, type Last } from '../models/director/index.js';

/** A job on the stack; left() is how many are left (from the runner's progress), null when it can't say. */
export interface JobEntry<P = unknown> extends JobState<P> {
    left?: () => number | null;
    /** What andy says when the job ends done, instead of the runner's line (a plan's doneSay: home's "That's my chest now."). */
    doneSay?: string;
    /** A chore's run name (<skill>_<target>): its lease is action:chore:<label> (5.6). */
    label?: string;
}

let nextId = 1;

/**
 * The Job line's word for the kinds the director's prompt has no word of its own for (its words are fixed): hunt and
 * the hunt skill show as attack, the gather skill and cobble as gather, a place, cook as craft, unload and kit as
 * store, sleep and rest as stay.
 */
const CHORE_JOB_WORD: Partial<Record<JobSpec['kind'], DirectorJobKind>> = {
    hunt: 'attack', huntFood: 'attack', gatherSkill: 'gather', cobble: 'gather', place: 'craft', cook: 'craft',
    unload: 'store', kit: 'store', sleep: 'stay', rest: 'stay',
};

/**
 * jobKind: the Job line's kind for a spec (hunt and the hunt skill show as attack, the gather skill as gather, a
 * place as craft: the director's words are fixed by its prompt; eat isn't a job kind there).
 */
export function jobKind(spec: JobSpec): DirectorJobKind | null {
    const k = CHORE_JOB_WORD[spec.kind] ?? spec.kind;
    return (JOB_KINDS as readonly string[]).includes(k) ? (k as DirectorJobKind) : null;
}

/** jobItem: the spec's item (a follow/come job's player, as the old args[0]), or null. */
function jobItem(spec: JobSpec): string | null {
    switch (spec.kind) {
        case 'follow': case 'come': case 'give': return spec.kind === 'give' ? spec.item : spec.player;
        case 'mine': return spec.ore;
        case 'farm': return spec.crop;
        case 'craft': case 'gather': case 'store': case 'eat': return spec.item;
        case 'hunt': return spec.mob;
        case 'huntFood': return 'food';
        case 'gatherSkill': return spec.target;
        case 'place': return spec.item;
        case 'cobble': return 'cobblestone';
        case 'cook': return 'food';
        default: return null;
    }
}

function jobCount(spec: JobSpec): number | 'any' {
    switch (spec.kind) {
        case 'mine': return spec.count === 'forever' ? 'any' : spec.count;
        case 'farm': return spec.goal === 'forever' || !('count' in spec.goal) ? 'any' : spec.goal.count;
        case 'cobble': return spec.count;
        case 'craft': case 'gather': case 'hunt': case 'give': case 'store': return spec.count;
        case 'huntFood': case 'gatherSkill': return spec.goal;
        case 'place': return 1;
        default: return 'any';
    }
}

/** jobView: a job as the director's Job line shows it, or null when its kind has no Job line word. */
export function jobView(j: JobEntry): JobView | null {
    const kind = jobKind(j.spec);
    if (!kind) return null;
    const rem = j.left?.() ?? null;
    return { kind, item: itemWord(kind, jobItem(j.spec)), left: rem !== null ? Math.max(0, rem) : jobCount(j.spec) };
}

export class JobStack {
    private items: JobEntry[] = [];
    /** How the last job ended (the state's Last). */
    last: Last = 'none';
    /** Called after any change (4.3 saves the player's job). */
    onChange: ((s: JobStack) => void) | null = null;
    /** Called after a job stepped: its progress may have changed with no stack change (4.3 saves it, throttled). */
    onProgress: ((s: JobStack) => void) | null = null;

    constructor(private readonly now: () => number = Date.now) {}

    private changed(): void { try { this.onChange?.(this); } catch { /* never stops the bot */ } }

    get depth(): number { return this.items.length; }
    get entries(): readonly JobEntry[] { return this.items; }
    has(j: JobEntry): boolean { return this.items.includes(j); }
    /** job: the top job, or null. */
    job(): JobEntry | null { return this.items[this.items.length - 1] ?? null; }

    /** start puts a new job on top, replacing the top job (a player's new command); returns it. */
    start<P>(spec: JobSpec, origin: JobOrigin, progress: P, by?: string): JobEntry<P> {
        this.items.pop();
        const job: JobEntry<P> = { id: `j${nextId++}`, spec, origin, progress, status: 'running', startedAt: this.now(), ...(by ? { by } : {}) };
        this.items.push(job as JobEntry);
        this.last = 'none';
        this.changed();
        return job;
    }

    /** paused: the job was interrupted (a safety activity took the body); it waits to be resumed. */
    paused(job: JobEntry): void {
        if (!this.has(job) || job.status === 'paused') return;
        job.status = 'paused';
        job.pausedAt = this.now();
        this.last = 'interrupted';
        this.changed();
    }

    resumed(job: JobEntry): void {
        if (!this.has(job) || job.status === 'running') return;
        job.status = 'running';
        delete job.pausedAt;
        this.changed();
    }

    /** ended: a job ended by itself; Last says how. */
    ended(job: JobEntry, end: JobEnd): void {
        const i = this.items.indexOf(job);
        if (i < 0) return;
        this.items.splice(i, 1);
        this.last = end.how === 'cancelled' ? 'interrupted' : end.how;
        this.changed();
    }

    /** drop: take a job off that never ran (its kind has no runner); Last is left as it was. */
    drop(job: JobEntry): void {
        const i = this.items.indexOf(job);
        if (i < 0) return;
        this.items.splice(i, 1);
        this.changed();
    }

    /**
     * restore: a saved stack after a restart (bottom first). Every job comes back paused, with new ids and its
     * spec, by, startedAt and progress; Last is interrupted, so the director resumes it (rule resume-paused).
     */
    restore(saved: readonly SavedJob[]): JobEntry[] {
        const t = this.now();
        this.items = saved.map(s => ({
            id: `j${nextId++}`, spec: s.spec, origin: s.origin, ...(s.by ? { by: s.by } : {}),
            progress: s.progress ?? {}, status: 'paused' as const, startedAt: s.startedAt, pausedAt: t,
        }));
        if (this.items.length) this.last = 'interrupted';
        this.changed();
        return [...this.items];
    }

    /** progressed: the running job stepped (its progress may have changed). */
    progressed(): void { try { this.onProgress?.(this); } catch { /* never stops the bot */ } }

    /** clear: stop or death. */
    clear(): void { this.items = []; this.last = 'none'; this.changed(); }

    /** running: the top job when it runs, as the Job line shows it. */
    running(): JobView | null {
        const j = this.job();
        return j && j.status === 'running' ? jobView(j) : null;
    }

    /** pausedKind: the paused top job's kind. */
    pausedKind(): DirectorJobKind | null {
        const j = this.job();
        return j && j.status === 'paused' ? jobKind(j.spec) : null;
    }
}
