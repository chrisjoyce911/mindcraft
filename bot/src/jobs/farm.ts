// The farm job (the old bot's src/agent/laya/farm.js farmWithLaya): farm until count more of a crop's produce is
// harvested, or until stopped, one loop iteration per job step, so the director's lease, pause and interrupt work
// between steps. Each step: read the 9×9 cells around andy, what he carries and the animals near (models/farm), ask
// the farm model for Action, Target and Item (and with prompt v2 Unload; the state adds the crop and the pack line),
// decide (models/farm decideFarmStep: the model's answer when it is sure, else the rules' (v2) or a wait (v1); the
// ban, the crop's seed, the pond or find_water when dry, the item it needs, the veto) and carry it out.
//
// Before the first step it gets a hoe and seeds (the starter kit); whenever an answer needs an item andy doesn't
// carry it gets that (a hoe, seeds, a water bucket from a carried bucket or iron and water near, bone meal) and reads
// again. It never waits forever: with no water to farm with it makes a pond from a water bucket, else walks to water
// within water_radius once, or says so and stops; after wait_limit waits in a row with nothing growing it stops. It
// never repeats a failed step forever: a vetoed or failed action is banned on its cell for ban_steps steps (the rules
// answer instead), and after max_bad in a row it stops; a done step asked again on the very same state did nothing,
// so it counts as failed (5.3 live: a plant 'done' 2,170 times on a cell it misread). With prompt v2 and a home
// chest known (or a chest a sign with andy's name marks) it empties its pack there when Unload says so (or the pack
// is full) and something would go in, and walks back.
//
// Progress ({harvested}) is the produce harvested so far over every run of the job (any gain of the crop's produce,
// also drops picked up a step later): a job resumed after a pause or a restart farms until count in all. Before a
// deposit the progress is checkpointed to disk.
import type { JobStepper, StepResult, Vec3Like } from '../types/index.js';
import {
    NO_WATER, PRODUCE, decideFarmStep, depositList, farmKeep, farmValuables, growing, has, hasWater, pack, produceOf,
    questions, questionsV2, readFarmAnswer, starterKit, state, stateV2, wantUnload,
    type FarmAction, type FarmCrop, type FarmSituation, type FarmView, type Inv,
} from '../models/farm/index.js';
import { homeDistance } from '../sensors/pack.js';
import type { Stack } from '../home/chest.js';
import { farmCraftLine, farmStepLine, type FarmLine, type FarmOutcome, type FarmStepEntry } from '../log/jsonl.js';
import { FARM_DEFAULTS, type FarmSettings, type JobDeps, type JobOf } from './deps.js';
import { jobFailedMessage } from './message.js';
import { farmWorld } from './farmWorld.js';
import { homeFinder } from './mineWorld.js';

/** What the farm job needs of the world (farmWorld builds it from the actuators; tests pass fakes). */
export interface FarmWorld {
    /** The situation around andy now (the 9×9 view, what he carries, the animals near). */
    read(): FarmView;
    /** Carry an answer out on the situation read last; true when it worked. */
    act(action: FarmAction, target: string, item: string, s: FarmView, signal: AbortSignal): Promise<boolean>;
    /** Get n of an item a farm step needs (hoe, seeds, water_bucket, bone_meal); true when it is in the pack. */
    craft(item: string, n: number, signal: AbortSignal): Promise<boolean>;
    /** andy's items by name. */
    inventory(): Inv;
    /** andy's cell (floored), or null. */
    position(): Vec3Like | null;
    /** Walk to p; true when there. */
    goTo(p: Vec3Like, signal: AbortSignal): Promise<boolean>;
    /** The nearest water source within radius, or null. */
    findWater(radius: number): Promise<Vec3Like | null>;
    freeSlots(): number;
    hostiles(): number;
    health(): number;
    food(): number;
    /** The home chest (adopting a signed chest when none is saved), or null. */
    home(): Vec3Like | null;
    goHome(home: Vec3Like, signal: AbortSignal): Promise<boolean>;
    /** Put items into the home chest (and the chests touching it); true when all went in. */
    deposit(items: readonly Stack[], signal: AbortSignal): Promise<boolean>;
    isFood(name: string): boolean;
    /** Wait ms; false when aborted. */
    sleep(ms: number, signal: AbortSignal): Promise<boolean>;
}

/** The job's progress (kept in laya-job.json). */
export interface FarmProgress {
    /** The produce harvested so far over every run of the job. */
    harvested?: number;
}

export interface FarmCounters {
    asked: number; done: Record<string, number>; vetoes: Record<string, number>; crafted: Record<string, number>;
    misses: number; failed: number; rules: number; harvested: number; unloads: number; water_trips: number; reason: string;
}
export const newFarmCounters = (): FarmCounters =>
    ({ asked: 0, done: {}, vetoes: {}, crafted: {}, misses: 0, failed: 0, rules: 0, harvested: 0, unloads: 0, water_trips: 0, reason: '' });

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] || 0) + 1; };

/** farmSummary: the console's summary line (the old summary()). */
export function farmSummary(c: FarmCounters): string {
    const list = (o: Record<string, number>) => Object.entries(o).map(([k, n]) => `${k} ${n}`).join(', ') || 'none';
    const extra = c.rules || c.unloads || c.water_trips ? `; rule steps ${c.rules}, unloads ${c.unloads}, water trips ${c.water_trips}` : '';
    return `Laya farm: asked ${c.asked}; did ${list(c.done)}; vetoes ${list(c.vetoes)}; crafted ${list(c.crafted)}; no answer ${c.misses}, failed ${c.failed}; harvested ${c.harvested}${extra}${c.reason ? `; stopped: ${c.reason}` : ''}`;
}

export interface FarmRunContext {
    crop: FarmCrop;
    /** The produce to harvest in all (forever: until stopped). */
    count: number | 'forever';
    progress: FarmProgress;
    settings(): FarmSettings;
    world(): FarmWorld | null;
    /** Writes a laya-farm.jsonl line (when log_steps). */
    log(line: FarmLine): void;
    /** The console. */
    note(text: string): void;
    /** Says something in game. */
    chat(text: string): void;
    /** Writes the job's progress to disk now (before a deposit). */
    checkpoint(): void;
    /**
     * Timed farming (the old !layaFarm(minutes); the chores' tend and start, 5.6): the run ends done at this time
     * (ms), and max_steps bounds it.
     */
    until?: number;
    now?: () => number;
}

export type FarmEndReason = 'count reached' | 'time up' | 'no hoe' | 'no answer' | 'no water' | 'nothing to do' | 'stuck' | 'max steps' | 'not in game';
/** How a run ended: ok (the count is harvested) or not, why, and what andy says. */
export interface FarmEnd { ok: boolean; reason: FarmEndReason; say?: string; counters: FarmCounters }
export type FarmStep = { how: 'more' } | { how: 'end'; end: FarmEnd };

const MORE: FarmStep = { how: 'more' };
/** What andy says when a farm job starts with the farm task off (the old farmWithLayaModel's line). */
export const FARM_OFF = 'The Laya farm task is off (settings.decision_models.tasks.farm).';
const FULL_NO_HOME = "My pack is full and I don't know a home chest (remember one as home_chest).";
const FULL_OF_KEPT = "My pack is full of things I keep, so I can't pick up the harvest.";

/** FarmRun is one run of a farm job (from a start or a resume until it ends or is paused): the old farmWithLaya's state. */
export class FarmRun {
    readonly counters = newFarmCounters();
    private readonly opts: FarmSettings;
    private readonly v2: boolean;
    private readonly maxSteps: number;
    private started = false;
    private ended: FarmEnd | null = null;
    private steps = 0;
    private misses = 0;
    private waits = 0;
    private bad = 0;
    private noUnloadUntil = 0;
    private warnedFull = false;
    private warnedKept = false;
    private wentForWater = false;
    private origin: Vec3Like | null = null;
    /** The last done act and the state it was chosen on (a repeat on the same state did nothing). */
    private lastDone: { key: string; state: string } | null = null;
    /** The produce carried when last counted (null: not yet): any gain since counts as harvested. */
    private lastProduce: number | null = null;
    /** 'action target' → the step its ban ends. */
    private readonly banned = new Map<string, number>();

    constructor(private readonly c: FarmRunContext) {
        this.opts = { ...FARM_DEFAULTS, ...c.settings() };
        this.v2 = this.opts.prompt === 'v2' || this.opts.prompt === 'v2.1'; // v2.1: v2's prompt, v2.1's rules
        // timed farming is bounded by max_steps; a count or "until stopped" goes on
        this.maxSteps = c.until !== undefined ? this.opts.max_steps : this.opts.max_steps_open;
        this.counters.harvested = c.progress.harvested ?? 0;
    }

    private logStep(line: FarmLine): void { if (this.opts.log_steps) { try { this.c.log(line); } catch { /* never stops farming */ } } }
    private line(e: FarmStepEntry, outcome: FarmOutcome, extra: { veto?: string; water?: Vec3Like } = {}): void { this.logStep(farmStepLine(e, outcome, extra)); }
    private say(text: string): void { this.c.note(text); this.c.chat(text); }
    private isBanned = (a: FarmAction, t: string): boolean => (this.banned.get(`${a} ${t}`) ?? 0) > this.steps;
    /** badStep bans the action on its cell; true when it's time to stop. */
    private badStep(a: FarmAction, t: string): boolean {
        this.banned.set(`${a} ${t}`, this.steps + this.opts.ban_steps);
        return ++this.bad >= this.opts.max_bad;
    }
    private produce(w: FarmWorld): number { return produceOf(w.inventory(), PRODUCE[this.c.crop]); }
    /**
     * credit counts the produce gained since it was last counted as harvested (the drops of a harvest are often picked
     * up a step later, walking past them: 5.3 live); a loss (planted carrots, fed wheat, a deposit) only moves the mark.
     */
    private credit(w: FarmWorld): number {
        const now = this.produce(w);
        const got = this.lastProduce === null ? 0 : Math.max(0, now - this.lastProduce);
        this.lastProduce = now;
        if (got) {
            this.counters.harvested += got;
            this.c.progress.harvested = this.counters.harvested;
        }
        return got;
    }
    private reached(): boolean { return this.c.count !== 'forever' && this.counters.harvested >= this.c.count; }
    private done(): FarmStep {
        return this.finish(true, 'count reached', `Harvested ${this.counters.harvested} ${this.c.crop === 'any' ? 'crops' : this.c.crop}.`);
    }
    private keep(w: FarmWorld) { return farmKeep(n => w.isFood(n), this.opts.keep_seeds); }

    private finish(ok: boolean, reason: FarmEndReason, say?: string): FarmStep {
        this.counters.reason = reason;
        this.c.note(farmSummary(this.counters));
        this.ended = { ok, reason, ...(say ? { say } : {}), counters: this.counters };
        return { how: 'end', end: this.ended };
    }

    /** close: this run stops (paused, replaced, stopped) without ending. */
    close(): void {
        if (this.ended || !this.started) return;
        this.c.note(farmSummary(this.counters) + ' (paused)');
    }

    /** getItem gets an item a step needs and logs it (crafted / craft-failed). */
    private async getItem(w: FarmWorld, item: string, count: number, signal: AbortSignal): Promise<boolean> {
        bump(this.counters.crafted, item);
        // the craft job may take produce from the home chest: that isn't harvested (count what came before, then move the mark)
        this.credit(w);
        const ok = await w.craft(item, count, signal).catch(() => false);
        this.lastProduce = this.produce(w);
        if (!signal.aborted) this.logStep(farmCraftLine(ok, item, count));
        return ok;
    }

    /** findWater walks to water within water_radius (once while dry); 'ok', 'none' (say so and stop) or 'aborted'. */
    private async findWater(w: FarmWorld, entry: FarmStepEntry, signal: AbortSignal): Promise<'ok' | 'none' | 'aborted'> {
        const at = await w.findWater(this.opts.water_radius).catch(() => null);
        // already walked to water once and still dry: don't wander about
        if (!at || this.wentForWater) {
            this.line(entry, 'no-water');
            return 'none';
        }
        this.counters.water_trips++;
        this.wentForWater = true;
        const ok = await w.goTo(at, signal).catch(() => false);
        if (signal.aborted) return 'aborted';
        this.line(entry, ok ? 'went-to-water' : 'water-unreachable', { water: at });
        if (!ok) return 'none';
        this.origin = w.position() ?? at;
        this.waits = 0;
        return 'ok';
    }

    /** goUnload empties the pack into the home chest (keeping tools, buckets, food and keep_seeds seeds) and walks back. */
    private async goUnload(w: FarmWorld, home: Vec3Like, signal: AbortSignal): Promise<boolean> {
        this.counters.unloads++;
        if (!await w.goHome(home, signal).catch(() => false)) return false;
        const items = depositList(w.inventory(), this.keep(w));
        this.credit(w);
        this.c.checkpoint();
        const ok = items.length ? await w.deposit(items, signal).catch(() => false) : true;
        this.lastProduce = this.produce(w); // what went into the chest isn't a loss to count
        if (signal.aborted) return false;
        this.c.note(ok ? 'Emptied my pack into the home chest.' : "Couldn't empty my pack into the home chest.");
        if (this.origin) await w.goTo(this.origin, signal).catch(() => false);
        return ok;
    }

    /** setup: the starter kit (a hoe and something to plant: the crop's seed when one is asked for). */
    private async setup(w: FarmWorld, signal: AbortSignal): Promise<FarmStep | null> {
        const s = w.read();
        for (const need of starterKit(this.c.crop)) {
            if ((need.any ?? [need.item]).some(i => has(s, i))) continue;
            const ok = await this.getItem(w, need.item, need.count, signal);
            if (signal.aborted) return MORE;
            if (!ok) {
                const msg = `I couldn't get a ${need.item} to farm with.`;
                // without a hoe there's nothing to till or plant: stop rather than wait
                if (need.item === 'hoe') return this.finish(false, 'no hoe', msg);
                this.say(msg);
            }
        }
        this.origin = w.position();
        this.lastProduce = this.produce(w); // what andy carries at the start isn't harvested
        return null;
    }

    /** step: one iteration of the old loop (the first runs the setup first). */
    async step(signal: AbortSignal): Promise<FarmStep> {
        if (this.ended) return { how: 'end', end: this.ended };
        const w = this.c.world();
        if (!w) return { how: 'end', end: { ok: false, reason: 'not in game', counters: this.counters } };
        if (!this.started) {
            this.started = true;
            const r = await this.setup(w, signal);
            if (r) return r;
        }
        if (this.c.until !== undefined && (this.c.now ?? Date.now)() >= this.c.until) {
            return this.finish(true, 'time up', `Farmed until the time was up; harvested ${this.counters.harvested}.`);
        }
        if (this.steps >= this.maxSteps) return this.finish(false, 'max steps');
        this.steps++;
        return this.body(w, signal);
    }

    private async body(w: FarmWorld, signal: AbortSignal): Promise<FarmStep> {
        const o = this.opts, crop = this.c.crop;
        // drops picked up since the last step
        this.credit(w);
        if (this.reached()) return this.done();
        let s: FarmSituation = w.read();
        let st: string;
        if (this.v2) {
            const inv = w.inventory();
            s = { ...s, crop, pack: pack({
                free: w.freeSlots(), home: homeDistance(w.position(), w.home()), health: w.health(), food: w.food(),
                hostiles: w.hostiles(), valuables: farmValuables(inv, this.keep(w)),
            }) };
            st = stateV2(s as FarmSituation & { crop: FarmCrop; pack: NonNullable<FarmSituation['pack']> });
        } else st = state(s);
        const qs = this.v2 ? questionsV2(s) : questions(s);
        if (hasWater(s.grid)) this.wentForWater = false; // farming by water again: another trip is fine later
        this.counters.asked++;
        const reply = o.model ? await o.model.decide('farm', st, qs).catch(() => null) : null;
        if (signal.aborted) return MORE;
        const asked = readFarmAnswer(reply);
        if (!asked && !this.v2) {
            this.counters.misses++;
            this.line({ state: st }, 'no-answer');
            if (++this.misses >= o.max_misses) return this.finish(false, 'no answer', 'The farm model is not answering; stopping.');
            await w.sleep(o.step_ms, signal);
            return MORE;
        }
        if (!asked) this.counters.misses++;
        else this.misses = 0;
        const entry: FarmStepEntry = { state: st };

        // Unload (v2): the model when sure, else the rule; always with a full pack; never without a home chest
        if (this.v2) {
            const home = w.home();
            entry.unload = asked?.unload?.probability;
            if (s.pack!.free === 0 && !home && !this.warnedFull) {
                this.warnedFull = true;
                this.say(FULL_NO_HOME);
            }
            // nothing would go in (tools, food and the kept seeds fill the pack): no unload (5.3 live: the rule's
            // "nearly full, home near" otherwise sends andy to the chest every step)
            const toDeposit = home ? depositList(w.inventory(), this.keep(w)).length > 0 : false;
            // a full pack of things kept (tools, food, keep_seeds): no drop can be picked up; say so once
            if (home && s.pack!.free === 0 && !toDeposit && !this.warnedKept) {
                this.warnedKept = true;
                this.say(FULL_OF_KEPT);
            }
            if (home && toDeposit && this.steps >= this.noUnloadUntil && wantUnload(s.pack!, asked?.unload)) {
                const ok = await this.goUnload(w, home, signal);
                if (signal.aborted) return MORE;
                if (!ok) { this.noUnloadUntil = this.steps + o.unload_retry_steps; this.counters.failed++; }
                this.line({ ...entry, action: 'unload' }, ok ? 'done' : 'failed');
                return MORE;
            }
        }

        const d = decideFarmStep({ s, asked, v2: this.v2, crop, isBanned: this.isBanned });
        if (d.ruled) this.counters.rules++;
        if (d.said) Object.assign(entry, d.said);
        if (d.banned) entry.banned = d.banned;
        Object.assign(entry, { action: d.action, target: d.target, item: d.item, source: d.source });

        if (d.kind === 'find_water') {
            const r = await this.findWater(w, entry, signal);
            if (r === 'none') return this.finish(false, 'no water', NO_WATER);
            return MORE;
        }
        if (d.kind === 'wait') {
            this.waits++;
            this.bad = 0;
            this.line(entry, d.source === 'low-confidence' ? 'low-confidence' : 'wait');
            if (this.waits >= o.wait_limit && !growing(s.grid)) return this.finish(false, 'nothing to do', 'Nothing to farm here and nothing growing; stopping.');
            await w.sleep(d.source === 'low-confidence' ? o.step_ms : o.step_ms * 4, signal);
            return MORE;
        }
        this.waits = 0;

        if (d.missing) {
            const ok = await this.getItem(w, d.missing, d.missing === 'wheat_seeds' ? 4 : 1, signal);
            if (signal.aborted) return MORE;
            if (!ok) {
                this.counters.failed++;
                // a water bucket for a dry place that can't be had: find water
                if (d.missing === 'water_bucket' && !hasWater(s.grid)) {
                    const r = await this.findWater(w, entry, signal);
                    if (r === 'none') return this.finish(false, 'no water', NO_WATER);
                    return MORE;
                }
                await w.sleep(o.step_ms, signal);
            }
            return MORE; // read again with the new item
        }
        if (d.veto) {
            bump(this.counters.vetoes, d.veto);
            this.line(entry, 'veto', { veto: d.veto });
            if (this.badStep(d.action, d.target)) return this.finish(false, 'stuck', `I keep failing to ${d.action} here; stopping.`);
            await w.sleep(o.step_ms, signal);
            return MORE;
        }
        // a done step that changed nothing (the same answer on the same state again): it does nothing, so it failed
        const key = `${d.action} ${d.target}`;
        if (this.lastDone && this.lastDone.key === key && this.lastDone.state === st) {
            this.lastDone = null;
            this.counters.failed++;
            this.line(entry, 'failed');
            if (this.badStep(d.action, d.target)) return this.finish(false, 'stuck', `I keep failing to ${d.action} here; stopping.`);
            await w.sleep(o.step_ms, signal);
            return MORE;
        }
        this.credit(w);
        const ok = await w.act(d.action, d.target, d.use, s, signal).catch(() => false);
        const got = this.credit(w);
        // interrupted (defend, eat, stop): neither done nor failed; the harvest so far counts
        if (signal.aborted) return MORE;
        if (ok) bump(this.counters.done, d.action);
        else this.counters.failed++;
        if (d.action === 'harvest') entry.harvested = got;
        this.line(entry, ok ? 'done' : 'failed');
        this.lastDone = ok ? { key, state: st } : null;
        if (ok) this.bad = 0;
        else if (this.badStep(d.action, d.target)) return this.finish(false, 'stuck', `I keep failing to ${d.action} here; stopping.`);
        if (this.reached()) return this.done();
        return MORE;
    }
}

/** settingsOf: the farm settings from the deps (missing: the task is off). */
const settingsOf = (deps: JobDeps) => (): FarmSettings => deps.farm?.() ?? { ...FARM_DEFAULTS, enabled: false, model: null };

/** farmRunner runs a farm job; with the farm task off it ends at once (the old bot said so too). */
export function farmRunner(job: JobOf<'farm'>, deps: JobDeps): JobStepper {
    const spec = job.spec;
    const p = job.progress as FarmProgress;
    const settings = settingsOf(deps);
    const count = spec.goal === 'forever' || !('count' in spec.goal) ? 'forever' : spec.goal.count;
    // timed: from the job's start (a pause or a restart doesn't add time)
    const until = spec.goal !== 'forever' && 'minutes' in spec.goal ? job.startedAt + spec.goal.minutes * 60_000 : undefined;
    if (!settings().enabled) {
        return { step: async (): Promise<StepResult> => ({ how: 'end', end: { how: 'failed', reason: 'the farm task is off' }, say: FARM_OFF }) };
    }
    const home = homeFinder(deps);
    const run = new FarmRun({
        crop: spec.crop, count, progress: p, settings, ...(until !== undefined ? { until, now: deps.now ?? Date.now } : {}),
        world: () => { const a = deps.act(); return a ? farmWorld(a, deps, settings().water_radius, home) : null; },
        log: line => deps.farmLog?.(line),
        note: text => deps.note(text),
        chat: text => deps.chat?.(text),
        checkpoint: () => deps.checkpoint?.(),
    });
    return {
        async step(_f, signal): Promise<StepResult> {
            const r = await run.step(signal);
            if (r.how === 'more') return { how: 'more' };
            const e = r.end;
            if (e.ok) return { how: 'end', end: { how: 'done' }, ...(e.say ? { say: e.say } : {}) };
            return { how: 'end', end: { how: 'failed', reason: e.reason }, say: e.say ?? jobFailedMessage(spec, e.reason) };
        },
        close: () => run.close(),
        left: () => (count === 'forever' ? null : Math.max(0, count - (p.harvested ?? 0))),
    };
}
