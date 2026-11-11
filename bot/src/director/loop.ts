// The Director: one decision loop (design §5.1) and the only place that takes or releases the body lease
// (§4, §5.2). Events (hurt, death, spawn, chat, job-end, activity-end) are queued and decided at once, plus
// a 1 s tick; they never move the body. Each decision reads one Facts snapshot, asks the director model (or
// its rules) and, in parallel, the eat model when it is due, then arbitrates: player > safety > job > chore.
import type { Activity, Facts, JobEnd, JobOrigin, JobSpec, SafetyActivity } from '../types/index.js';
import { isSafety, type ActivityRunnerName } from '../types/index.js';
import type { ModelDecider } from '../types/models.js';
import type { BodyLease, Held } from '../core/lease.js';
import { decideDirector, directorSituation, type DirectorDecision, type DirectorModel } from '../models/director/index.js';
import { decideEat, eatSituation, type EatDecision } from '../models/eat/index.js';
import type { Act } from '../actuators/bot.js';
import { JobStack, type JobEntry } from './stack.js';
import type { RunnerFactory } from './jobs.js';
import {
    DEFAULT_TIMING, runDefend, runEat, runEscape, runFlee, runHeal, runnerFor,
    type ActivityCtx, type ActivityEnd, type ActivityLog, type Timing,
} from './activities.js';

export type DirectorEvent = 'tick' | 'hurt' | 'death' | 'spawn' | 'chat' | 'job-end' | 'stop' | `${ActivityRunnerName}-done` | 'resume-done';

/** One director decision as the log keeps it (the old logDecision's fields). */
export interface DirectorLogEntry {
    event: DirectorEvent; state: string; answer: Activity; rule: string; source: 'model' | 'rules';
    p?: number; why?: string; model?: string;
    /** What the director did with the answer when it differs from the answer (e.g. eat-model, quiet, unload-not-yet). */
    acted?: string;
}

/** Where decisions go: the director's here, eat/defend through the activities' log. */
export interface DecisionSink extends ActivityLog {
    director(e: DirectorLogEntry): void;
    /** Lines that are not decisions (stop-overrun, warnings). */
    note(text: string): void;
}

export interface Models {
    director(): DirectorModel | null;
    eat(): ModelDecider | null;
    defend(): ModelDecider | null;
}

export interface DirectorDeps {
    lease: BodyLease;
    /** Facts now (fresh skips the tick cache), or null when not in game. */
    facts(fresh?: boolean): Facts | null;
    /** The actuator context, or null when not in game. */
    act(): Act | null;
    models: Models;
    say(text: string): void;
    sink: DecisionSink;
    timing?: Partial<Timing>;
    /** Builds a job's runner (phase 4); none yet: jobs can't run. */
    runners?: RunnerFactory;
    /** Nothing to do (chores arrive in 5.6). */
    onIdle?: () => void;
    now?: () => number;
    tickMs?: number;
}

interface Current { id: number; name: ActivityRunnerName | 'job'; held: Held<unknown>; job?: JobEntry }

/**
 * The eat model refused (e.g. only rotten flesh while not starving, which the director counts as food):
 * the director's eat answer acts as continue until food drops below the level it refused at, or this long.
 */
export const EAT_REFUSED_HOLD_MS = 30000;

/** An activity that ended by itself isn't restarted for the same answer within this. */
export const RESTART_HOLD_MS = 1000;

const EAT_EARLY_STOP: ReadonlySet<string> = new Set(['defend', 'flee', 'escape', 'eat', 'heal']);

export class Director {
    readonly stack: JobStack;
    readonly timing: Timing;
    private readonly now: () => number;
    private current: Current | null = null;
    private seq = 0;
    /** bumps on stop/death: a decision begun before it is not acted on */
    private generation = 0;
    private busy = false;
    private pending: DirectorEvent | null = null;
    private timer: NodeJS.Timeout | null = null;
    private lastAnswer: Activity | null = null;
    private nextEatAt = 0;
    private quietUntil = 0;
    private askedFoodAt = 0;
    private ended: { name: ActivityRunnerName; at: number } | null = null;
    private eatRefused: { food: number; until: number } | null = null;
    /** the last decision (tests, status) */
    last: DirectorDecision | null = null;
    lastEat: EatDecision | null = null;

    constructor(private readonly deps: DirectorDeps) {
        this.now = deps.now ?? Date.now;
        this.stack = new JobStack(this.now);
        this.timing = { ...DEFAULT_TIMING, ...(deps.timing ?? {}) };
    }

    /** holder: the running activity or job's lease name, or null. */
    get holder(): string | null { return this.current ? this.current.held.name : null; }

    start(): void {
        if (this.timer) return;
        this.timer = setInterval(() => { void this.decide('tick'); }, this.deps.tickMs ?? 1000);
        this.timer.unref?.();
    }

    async dispose(): Promise<void> {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        this.generation++;
        this.current = null;
        await this.deps.lease.release();
    }

    /** event: queue a decision (never moves the body itself). */
    event(e: DirectorEvent): void {
        if (e === 'death') { void this.clear('death'); return; }
        void this.decide(e);
    }

    /** stop: a player's stop clears the stack and frees the body (≤ the lease's 2 s overrun). */
    stop(): Promise<void> { return this.clear('stop'); }

    private async clear(why: 'stop' | 'death'): Promise<void> {
        this.generation++;
        this.stack.clear();
        this.current = null;
        this.quietUntil = 0;
        this.ended = null;
        this.eatRefused = null;
        await this.deps.lease.release();
        if (why === 'death') this.deps.sink.note('death: stack cleared');
    }

    /** startJob: a player's (or a chore's) job replaces the top job and runs (player > job: no decision needed). */
    async startJob<P>(spec: JobSpec, origin: JobOrigin, progress: P, by?: string): Promise<JobEntry<P> | null> {
        const entry = this.stack.start(spec, origin, progress, by);
        this.generation++;
        if (!(await this.runJob(entry as JobEntry))) return null;
        return entry;
    }

    /**
     * decide: one decision now. A decision in flight is never awaited by another: a tick is skipped, an event
     * is decided right after it.
     */
    async decide(event: DirectorEvent): Promise<DirectorDecision | null> {
        if (this.busy) { if (event !== 'tick') this.pending = event; return null; }
        this.busy = true;
        try {
            return await this.decideOnce(event);
        } finally {
            this.busy = false;
            const next = this.pending;
            this.pending = null;
            if (next) void this.decide(next);
        }
    }

    private async decideOnce(event: DirectorEvent): Promise<DirectorDecision | null> {
        const facts = this.deps.facts(event !== 'tick');
        if (!facts) return null;
        const gen = this.generation;
        const s = directorSituation(facts, this.stack.running(), this.stack.pausedKind(), this.stack.last);
        const now = this.now();
        const eatDue = facts.food < 20 && facts.foodItems > 0 && now >= this.nextEatAt
            && !(this.current && EAT_EARLY_STOP.has(this.current.name));
        if (eatDue) this.nextEatAt = now + this.timing.checkMs;
        // one shared deadline (§6): both questions go out together
        const [d, e] = await Promise.all([
            decideDirector(s, this.deps.models.director()),
            eatDue ? decideEat(eatSituation(facts), this.deps.models.eat()) : Promise.resolve(null),
        ]);
        this.last = d;
        if (e) this.lastEat = e;
        if (gen !== this.generation) return d; // a stop or death meanwhile: don't act on it
        const acted = await this.arbitrate(d.answer, e, facts, event);
        const quiet = event === 'tick' && d.answer === 'idle' && this.lastAnswer === 'idle' && !acted;
        this.lastAnswer = d.answer;
        if (!quiet) {
            this.deps.sink.director({
                event, state: d.state, answer: d.answer, rule: d.rule, source: d.source,
                ...(d.p !== undefined ? { p: d.p } : {}),
                ...(d.why ? { why: d.why, ...(d.model !== undefined ? { model: d.model } : {}) } : {}),
                ...(acted ? { acted } : {}),
            });
        }
        if (e && !(e.eat && acted === 'eat-model')) this.deps.sink.eat(e, e.eat ? 'eat-later' : 'no-eat');
        return d;
    }

    /**
     * arbitrate: act on the director's answer (and the eat model's). Returns what was done when it isn't the
     * answer's plain meaning (for the log), else undefined.
     */
    private async arbitrate(answer: Activity, eat: EatDecision | null, facts: Facts, event: DirectorEvent = 'tick'): Promise<string | undefined> {
        const cur = this.current;
        if (isSafety(answer)) {
            if (answer === 'defend' && cur?.name !== 'defend' && this.now() < this.quietUntil) return 'quiet';
            const refused = this.eatRefused;
            if (answer === 'eat' && !cur && refused && facts.food >= refused.food && this.now() < refused.until) return 'eat-refused';
            const name = runnerFor(answer, facts);
            if (cur?.name === name) return undefined;   // the same answer keeps its runner
            // an activity that just ended by itself isn't restarted at once for the same answer (no hot loop
            // when the answer and the activity's own end check disagree for a moment); the next tick may. A hit
            // is news: it isn't held.
            if (!cur && event !== 'hurt' && this.ended?.name === name && this.now() - this.ended.at < RESTART_HOLD_MS) return 'hold';
            await this.runActivity(name);
            return name === answer ? undefined : name;
        }
        // The eat model alongside the director (the old laya_eating mode's behaviour with one body owner): when
        // the director has nothing urgent (continue/idle/resume/unload) and the eat model (or its rules) says eat,
        // run a short eat activity. Not while another activity holds the body.
        if (eat?.eat && eat.food && (!cur || cur.name === 'job')) {
            await this.runActivity('eat', eat);
            return 'eat-model';
        }
        if (cur && cur.name !== 'job') return undefined;  // a running activity ends by itself (or a safety answer preempts it)
        switch (answer) {
            case 'resume': {
                const job = this.stack.job();
                if (job?.status === 'paused' && !cur) return (await this.runJob(job)) ? undefined : 'no-runner';
                return undefined;
            }
            case 'unload': return 'unload-not-yet'; // home/chest actuators: 4.2/5.x; acts as continue
            case 'idle': if (!cur && this.stack.depth === 0) this.deps.onIdle?.(); return undefined;
            default: return undefined;
        }
    }

    private ctx(act: Act): ActivityCtx {
        const self = this;
        return {
            act,
            facts: fresh => { const f = this.deps.facts(fresh); if (!f) throw new Error('not in game'); return f; },
            eatModel: this.deps.models.eat(),
            defendModel: this.deps.models.defend(),
            say: t => this.deps.say(t),
            log: this.deps.sink,
            timing: this.timing,
            now: this.now,
            get askedFoodAt() { return self.askedFoodAt; },
            set askedFoodAt(t: number) { self.askedFoodAt = t; },
        };
    }

    /** runActivity: take the body for a safety activity; a running job is paused under it. */
    private async runActivity(name: ActivityRunnerName, preset?: EatDecision): Promise<void> {
        const act = this.deps.act();
        if (!act) return;
        const cur = this.current;
        if (cur?.name === 'job' && cur.job) this.stack.paused(cur.job);
        else { const top = this.stack.job(); if (top) this.stack.paused(top); }
        const ctx = this.ctx(act);
        const run = (signal: AbortSignal): Promise<ActivityEnd> => {
            switch (name) {
                case 'defend': return runDefend(ctx, signal);
                case 'flee': return runFlee(ctx, signal);
                case 'escape': return runEscape(ctx, signal);
                case 'heal': return runHeal(ctx, signal);
                case 'eat': return runEat(ctx, signal, preset);
            }
        };
        const id = ++this.seq;
        const gen = this.generation;
        const held = await this.deps.lease.take(`director:${name}`, run);
        this.current = { id, name, held };
        void held.result.then(r => {
            if (this.current?.id === id) this.current = null;
            const end = r.how === 'settled' ? r.value as ActivityEnd : r.how;
            if (end !== 'stopped') this.ended = { name, at: this.now() };
            if (name === 'eat') {
                const f = this.deps.facts(false);
                this.eatRefused = end === 'no-eat' && f ? { food: f.food, until: this.now() + EAT_REFUSED_HOLD_MS } : null;
            }
            this.deps.sink.note(`${name} ended: ${end}`);
            if (r.how === 'threw') this.deps.sink.note(`${name} threw: ${String(r.error)}`);
            if (name === 'defend' && (end === 'calm' || end === 'ignore' || end === 'gone')) this.quietUntil = this.now() + this.timing.quietMs;
            if (end !== 'stopped' && gen === this.generation) void this.decide(`${name}-done`);
        });
    }

    /** runJob: give the body to a job's runner (start or resume); false when its kind has no runner yet. */
    private async runJob(job: JobEntry): Promise<boolean> {
        const runner = this.deps.runners?.(job) ?? null;
        if (!runner) return false;
        this.stack.resumed(job);
        const id = ++this.seq;
        const gen = this.generation;
        const run = async (signal: AbortSignal): Promise<JobEnd | null> => {
            while (!signal.aborted) {
                const f = this.deps.facts(false);
                if (!f) return null;
                const r = await runner.step(f, signal);
                if (r.how === 'end') return r.end;
            }
            return null;
        };
        const held = await this.deps.lease.take(`job:${job.spec.kind}`, run);
        this.current = { id, name: 'job', held, job };
        void held.result.then(r => {
            if (this.current?.id === id) this.current = null;
            if (gen !== this.generation) return;
            if (r.how === 'settled' && r.value) { this.stack.ended(job, r.value); void this.decide('job-end'); }
            else if (r.how === 'threw' && !(job.status === 'paused')) {
                this.stack.ended(job, { how: 'failed', reason: String(r.error) });
                void this.decide('job-end');
            }
        });
        return true;
    }
}
