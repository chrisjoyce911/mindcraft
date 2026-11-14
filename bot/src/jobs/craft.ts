// The craft and gather jobs (the old craft.js runCraft and skills.js layaMake): make (or gather) count more of an
// item with the Laya craft model, one model step per job step, so the director's lease, pause and interrupt work
// between steps. Each step: read the situation (inventory, nearby crafting table, furnace and chest, the chest's
// known contents), ask the craft model for the next step (models/craft decideCraftStep: the recipe rules when it is
// unsure or the step can't be done), and do it. The run ends when the model says done with the goal carried, or a
// step can't be done. Gathering N of something is the same loop with a gathered item as the goal.
//
// The old fixes are kept: the target is fixed when the job starts (a resumed job doesn't make more); the chest is
// read once when near (a failed take reads it again, once per item); what a take or store really moved is the
// pack's change (a take takes at least 8 of a material); store 64 means all; a failed extra step after the goal is
// carried is done (director-b 22:05); a placed chest is known empty; the player kit is never taken.
//
// The legacy forms run one actuator call: craft legacy 'craftRecipe' (no model), gather legacy 'collectBlocks'.
import type { JobStepper, StepResult } from '../types/index.js';
import { carriedOf, decideCraftStep, layaItem, situation, type CraftAction, type CraftItem, type Counts, type Near } from '../models/craft/index.js';
import { craftLine } from '../log/jsonl.js';
import { craftRecipe } from '../actuators/craft.js';
import { collectBlocks } from '../actuators/collect.js';
import { CRAFT_DEFAULTS, type CraftSettings, type JobDeps, type JobOf } from './deps.js';
import { jobFailedMessage } from './message.js';
import { missing } from '../types/chores.js';
import { craftWorld } from './craftWorld.js';

/** What the runner needs of the world (craftWorld builds it from the actuators; tests pass fakes). */
export interface CraftWorld {
    /** andy's main inventory and hotbar. */
    items(): readonly { name: string; count: number }[];
    near(): Near;
    /** The nearest chest's usable contents (generic counts, the player kit left out), or null when unknown. */
    readChest(signal: AbortSignal): Promise<Counts | null>;
    /** Each action on a generic item and a count (store -1: all); true when it did something. */
    act: Record<Exclude<CraftAction, 'done'>, (item: string, n: number, signal: AbortSignal) => Promise<boolean>>;
}

/** A take or store under way: what was carried before it (a pause or restart counts what moved on the next step). */
export interface CraftMoving { action: 'take' | 'store'; item: string; before: number }

/** The job's progress (kept in laya-job.json). */
export interface CraftProgress {
    /** How many of the goal to carry: carried + count when the job started. */
    target?: number;
    steps?: number;
    fallbacks?: number;
    /** The nearest chest's known contents; null: unknown (read when near). */
    chest?: Counts | null;
    /** Items whose failed take re-read the chest (once each). */
    retried?: string[];
    moving?: CraftMoving;
    /** A legacy single action started (it is never run twice). */
    ran?: boolean;
}

export interface CraftRunContext {
    kind: 'craft' | 'gather';
    /** The item as asked (a Minecraft or everyday name), and how many more. */
    item: string;
    count: number;
    /** Whose job: a chore's gather answer ends the run (skills-spec §5); 5.6 wires chores. */
    purpose: 'player' | 'chore';
    progress: CraftProgress;
    settings(): CraftSettings;
    world(): CraftWorld | null;
    log(line: ReturnType<typeof craftLine>): void;
    checkpoint(): void;
}

const ended = (say: string): StepResult => ({ how: 'end', end: { how: 'done' }, say });

/** failedEnd: the job ends failed with the reason; andy says the old jobFailedMessage. */
function failedEnd(c: CraftRunContext, reason: string): StepResult {
    const say = jobFailedMessage({ kind: c.kind, item: c.item, count: c.count }, reason);
    return { how: 'end', end: { how: 'failed', reason }, say };
}

/** craftStep: one step of the craft loop (the old runCraft loop body). */
export async function craftStep(c: CraftRunContext, signal: AbortSignal): Promise<StepResult> {
    const s = c.settings();
    const g = layaItem(c.item);
    if (!g) return failedEnd(c, `the craft model doesn't know ${c.item}`);
    if (!s.enabled) return failedEnd(c, 'the craft task is off (settings.decision_models.tasks.craft)');
    const w = c.world();
    if (!w) return failedEnd(c, 'not in game');
    const p = c.progress;
    p.target ??= carriedOf(w.items(), g) + c.count;
    p.steps ??= 0;
    p.fallbacks ??= 0;
    p.retried ??= [];
    if (p.chest === undefined) p.chest = null;
    const done = (): StepResult => ended(`Laya craft: made ${c.item} in ${p.steps} steps.`);
    // a take or store that a pause or a restart cut short: what moved is the pack's change
    if (p.moving) {
        book(p, p.moving, carriedOf(w.items(), p.moving.item), null);
        delete p.moving;
    }
    if (p.steps >= s.max_steps) return failedEnd(c, 'max-steps');
    const near = w.near();
    if (near.chest && p.chest === null) {
        p.chest = await w.readChest(signal);
        if (signal.aborted) return { how: 'more' };
    }
    const sit = situation(w.items(), g, p.target, near, p.chest ?? {});
    sit.chestKnown = p.chest !== null;
    const d = await decideCraftStep(sit, s.model, s.min_confidence);
    if (signal.aborted) return { how: 'more' };
    const goal = `${g} x${p.target}`;
    const log = (line: Parameters<typeof craftLine>[0]) => { if (s.log_steps) c.log(craftLine(line)); };
    if (d.kind === 'stop') {
        log({ goal, state: d.state, outcome: 'stop', reason: 'no-answer' });
        return failedEnd(c, 'no-answer');
    }
    if (d.kind === 'end') {
        log({ goal, state: d.state, entry: d.entry, outcome: d.done ? 'done' : 'stop', reason: d.why });
        return d.done ? done() : failedEnd(c, `${d.entry.action} ${d.entry.item}: ${d.why}`);
    }
    if (d.kind === 'done') {
        log({ goal, state: d.state, entry: d.entry, outcome: 'done' });
        return done();
    }
    if (d.why && d.rule) {
        log({ goal, state: d.state, entry: d.entry, outcome: 'fallback', reason: d.why, rule: d.rule });
        p.fallbacks++;
    }
    const step = d.step;
    if (step.action === 'done') return done(); // never: a rule is never done
    // a chore gathers nothing itself: it reports what it lacks as the Last line's missing_<kind> (skills-spec §1: gather
    // log → failed:missing_logs; an item with no kind: stuck), and the chores model picks the gather run
    if (c.purpose === 'chore' && step.action === 'gather') return { how: 'end', end: { how: 'failed', reason: missing(step.item) } };
    p.steps++;
    let n = step.count;
    if (step.action === 'store') n = (sit.have[step.item] ?? 0) <= 64 || n >= 64 ? -1 : n; // 64 means all
    if (step.action === 'take' && p.chest) n = Math.min(n, p.chest[step.item] || n);
    const before = carriedOf(w.items(), step.item);
    if (step.action === 'take' || step.action === 'store') {
        // on disk before the take or store: a kill during it counts what moved on restore, never twice
        p.moving = { action: step.action, item: step.item, before };
        c.checkpoint();
    }
    const ok = await w.act[step.action](step.item, n, signal);
    if (signal.aborted) return { how: 'more' }; // a moving take or store is counted on the next step
    log({ goal, state: d.state, entry: d.entry, outcome: ok ? 'did' : 'failed' });
    const moving = p.moving;
    delete p.moving;
    if (!ok) {
        // a failed extra step after the goal is carried doesn't undo it
        if (carriedOf(w.items(), g) >= p.target) return done();
        // a take the chest couldn't give: read the chest again and go on (once per item), so the next step sees
        // what is really there
        if (step.action === 'take' && !p.retried.includes(step.item)) {
            p.retried.push(step.item);
            p.chest = null;
            return { how: 'more' };
        }
        return failedEnd(c, `${step.action} ${step.item} failed`);
    }
    if (moving) {
        // what really moved (a take takes at least 8 of a material, a store may store all): the pack's change,
        // else the asked count
        const asked = step.action === 'store' ? (n === -1 ? sit.have[step.item] ?? 0 : n) : n;
        book(p, moving, carriedOf(w.items(), step.item), asked);
    }
    if (step.action === 'place' && step.item === 'chest') p.chest = {};
    return { how: 'more' };
}

/** book: the chest's bookkeeping after a take or store; asked is used when the pack shows no change (null: none). */
function book(p: CraftProgress, m: CraftMoving, now: number, asked: number | null): void {
    if (!p.chest) return;
    const diff = now - m.before;
    const moved = m.action === 'store' ? (diff < 0 ? -diff : asked ?? 0) : (diff > 0 ? diff : asked ?? 0);
    p.chest[m.item] = Math.max(0, (p.chest[m.item] || 0) + (m.action === 'store' ? moved : -moved));
}

/** settingsOf: the craft settings from the deps (missing: the task is off). */
export const settingsOf = (deps: JobDeps) => (): CraftSettings =>
    deps.craft?.() ?? { ...CRAFT_DEFAULTS, enabled: false, model: null };

/** craftRunner runs a craft or gather job (or its legacy single action). */
export function craftRunner(job: JobOf<'craft'> | JobOf<'gather'>, deps: JobDeps): JobStepper {
    const spec = job.spec;
    const p = job.progress as CraftProgress;
    if (spec.legacy) return legacyRunner(job, deps);
    const c: CraftRunContext = {
        kind: spec.kind, item: spec.item, count: spec.count, purpose: job.origin, progress: p,
        settings: settingsOf(deps),
        world: () => { const a = deps.act(); return a ? craftWorld(a, deps) : null; },
        log: line => deps.craftLog?.(line),
        checkpoint: () => deps.checkpoint?.(),
    };
    return {
        step: (_f, signal) => craftStep(c, signal),
        left: () => {
            const a = deps.act(), g = layaItem(spec.item);
            if (!a || !g || p.target === undefined) return null;
            return p.target - carriedOf(a.bot.items(), g);
        },
    };
}

/**
 * makeItem makes (or gathers) count more of item with the craft loop, run to its end inside the caller's step: for
 * the mine and farm jobs when they lack a tool or material (5.2/5.3; the old skills.layaMake). It ends early
 * (cancelled) when the signal aborts; the progress object may be kept by the caller to resume.
 */
export async function makeItem(deps: JobDeps, item: string, count: number, signal: AbortSignal,
    o: { purpose?: 'player' | 'chore'; progress?: CraftProgress; settings?: CraftSettings } = {}): Promise<{ ok: boolean; reason: string; steps: number }> {
    const progress = o.progress ?? {};
    const fixed = o.settings;
    const c: CraftRunContext = {
        kind: 'craft', item, count, purpose: o.purpose ?? 'player', progress,
        settings: fixed ? () => fixed : settingsOf(deps),
        world: () => { const a = deps.act(); return a ? craftWorld(a, deps) : null; },
        log: line => deps.craftLog?.(line),
        checkpoint: () => deps.checkpoint?.(),
    };
    while (!signal.aborted) {
        const r = await craftStep(c, signal);
        if (r.how === 'end') {
            const e = r.end;
            return { ok: e.how === 'done', reason: 'reason' in e ? e.reason : e.how, steps: progress.steps ?? 0 };
        }
    }
    return { ok: false, reason: 'cancelled', steps: progress.steps ?? 0 };
}

/** The legacy single actions: !craftRecipe (craft a recipe n times) and !collectBlocks (collect n blocks). */
function legacyRunner(job: JobOf<'craft'> | JobOf<'gather'>, deps: JobDeps): JobStepper {
    const spec = job.spec;
    const p = job.progress as CraftProgress;
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return { how: 'end', end: { how: 'failed', reason: 'not in game' }, say: 'not in game' };
            // the old single actions weren't resumed: one cut short by a fight or a restart ends
            if (p.ran) return { how: 'end', end: { how: 'cancelled' } };
            p.ran = true;
            deps.checkpoint?.();
            if (spec.kind === 'craft') {
                const r = await craftRecipe(a, spec.item, spec.count, signal);
                if (r.cancelled || signal.aborted) return { how: 'more' };
                return r.ok ? ended(r.message) : { how: 'end', end: { how: 'failed', reason: r.message }, say: r.message };
            }
            const r = await collectBlocks(a, spec.item, spec.count, signal);
            if (r.cancelled || signal.aborted) return { how: 'more' };
            return r.collected > 0 ? ended(r.message) : { how: 'end', end: { how: 'failed', reason: r.message }, say: r.message };
        },
    };
}

export type { CraftItem };
