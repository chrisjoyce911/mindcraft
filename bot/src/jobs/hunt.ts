// The hunt job (the old bot's !hunt and !attack: skills.huntForDrop, the loop src/agent/laya/hunt.js huntUntil,
// attackNearest and attackEntity). The command model's answer picks the mob, the drop and the count ("get 5 beef":
// hunt cow beef 5; "attack the pig": hunt pig null 1); this loop only carries it out, one kill per job step, so the
// director can pause it between kills. It has no model of its own: the hunt skill model is task 5.5.
//
// Each step: the drop's count reached → done; attack (item null) and one kill done → done; count*3+4 tries made →
// failed; no mob of the kind within HUNT_RANGE → pick up once, then done if the count is reached, else failed
// 'none near'; else kill the nearest and pick up the drops. A kill cut short by an abort counts nothing (the job
// resumes); a kill that fails another way counts as a try, so the loop stays bounded.
//
// Progress ({target, kills, tries}) is kept in laya-job.json. target is fixed on the first step (what andy carries
// plus count) and never computed again, so a hunt resumed after a pause or a restart doesn't add more (the old
// saved.target).
import type { JobStepper, Outcome, StepResult } from '../types/index.js';
import type { ActEntity } from '../actuators/bot.js';
import type { JobDeps, JobOf } from './deps.js';
import { jobFailedMessage } from './message.js';
import { huntWorld } from './huntWorld.js';

/** What the hunt job needs of the world (huntWorld builds it from the actuators; tests pass fakes). */
export interface HuntWorld {
    /** How many of item andy carries (exact name). */
    have(item: string): number;
    /** The nearest live mob of the kind within HUNT_RANGE, or null. */
    nearest(mob: string): ActEntity | null;
    /** Fight e until it dies: OK, or why not (cancelled on an abort). */
    kill(e: ActEntity, signal: AbortSignal): Promise<Outcome>;
    /** Pick up the items on the ground near andy. */
    pickup(signal: AbortSignal): Promise<void>;
}

/** The job's progress (kept in laya-job.json). */
export interface HuntProgress {
    /** The drop count to reach, fixed on the first step (item hunts only). */
    target?: number;
    /** Mobs killed over every run of the job. */
    kills?: number;
    /** Kills tried (killed or failed; not the ones an abort cut short). */
    tries?: number;
}

export interface HuntRunContext {
    note(text: string): void;
    /** Write the progress to disk now (the target once it's fixed). */
    checkpoint?(): void;
}

/** maxTries: the old maxKills (count*3+4). */
export const maxTries = (count: number): number => count * 3 + 4;

const done = (say: string): StepResult => ({ how: 'end', end: { how: 'done' }, say });
const failed = (reason: string, say: string): StepResult => ({ how: 'end', end: { how: 'failed', reason }, say });
const name = (s: string) => s.replace(/_/g, ' ');

/** huntStep: one iteration of the old huntUntil loop on the job's progress. */
export async function huntStep(spec: JobOf<'hunt'>['spec'], p: HuntProgress, w: HuntWorld, signal: AbortSignal, ctx: HuntRunContext): Promise<StepResult> {
    const { mob, item, count } = spec;
    if (item !== null && p.target === undefined) {
        p.target = w.have(item) + count;
        ctx.checkpoint?.();
    }
    const kills = p.kills ?? 0, tries = p.tries ?? 0;
    const reached = () => item !== null && w.have(item) >= (p.target ?? 0);
    const hunted = () => `Hunted ${kills} ${mob}: I have ${w.have(item!)} ${item}.`;
    if (item === null && kills >= 1) return done(`Successfully killed ${name(mob)}.`);
    if (reached()) return done(hunted());
    if (tries >= maxTries(count)) {
        if (item === null) return failed(`no kill after ${tries} tries`, `I couldn't kill the ${name(mob)}.`);
        const reason = `only ${w.have(item)} of ${p.target} after ${kills} kills`;
        return failed(reason, jobFailedMessage(spec, reason));
    }
    const e = w.nearest(mob);
    if (!e) {
        await w.pickup(signal);
        if (signal.aborted) return { how: 'more' };
        if (reached()) return done(hunted());
        if (item === null) return failed('none near', `Could not find any ${mob} to attack.`);
        return failed('none near', jobFailedMessage(spec, 'none near'));
    }
    const o = await w.kill(e, signal);
    if (signal.aborted || (!o.ok && o.reason === 'cancelled')) return { how: 'more' };
    p.tries = tries + 1;
    if (o.ok) p.kills = kills + 1;
    else ctx.note(`hunt: ${mob} ${e.id} not killed: ${o.reason}${o.detail ? ` (${o.detail})` : ''}`);
    await w.pickup(signal);
    return { how: 'more' };
}

export function huntRunner(job: JobOf<'hunt'>, deps: JobDeps, worldOf: (deps: JobDeps) => HuntWorld | null = d => {
    const a = d.act();
    return a ? huntWorld(a) : null;
}): JobStepper {
    const spec = job.spec;
    const ctx: HuntRunContext = { note: t => deps.note(t), checkpoint: () => deps.checkpoint?.() };
    return {
        async step(_f, signal): Promise<StepResult> {
            const w = worldOf(deps);
            if (!w) return failed('not in game', 'not in game');
            const r = await huntStep(spec, job.progress as HuntProgress, w, signal, ctx);
            if (r.how === 'end') deps.note(`hunt ${mob(spec)}: ${r.end.how}${r.end.how === 'failed' ? ` (${r.end.reason})` : ''}`);
            return r;
        },
        left(): number | null {
            const p = job.progress as HuntProgress;
            if (spec.item === null) return (p.kills ?? 0) >= 1 ? 0 : 1;
            const w = p.target === undefined ? null : worldOf(deps);
            return w ? Math.max(0, p.target! - w.have(spec.item)) : spec.count;
        },
    };
}

const mob = (s: JobOf<'hunt'>['spec']) => s.item === null ? s.mob : `${s.mob} for ${s.count} ${s.item}`;
