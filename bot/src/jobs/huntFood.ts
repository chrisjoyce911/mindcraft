// The hunt skill job (5.5; skills-spec v1 §2, design §11.3–11.4): kill food animals and pick up their drops until
// the food to have (carried + the home chest as the caller knows it) is met. One model step per job step, so the
// director can pause between steps: sense → decide (models/hunt decideHuntStep: the model when on, sure and not
// harmful, else rules v1) → act:
//   attack   kill the nearest adult of the kind in the search (killEntity), then pick up the drops;
//   approach go near it;
//   collect  pick up the food drops (within 16);
//   search   widen the search square (49 → 97 → 193) around the run's start; nothing moves;
//   done     the run ends done;  give_up: failed no_source.
// Bounds: maxSkillSteps(goal) steps (timeout) and the same step on the same state STUCK_REPEATS times (stuck). An
// abort mid-step counts nothing: the job resumes and decides again. Progress (start, search, steps, kills) is kept in
// laya-job.json, so a resumed run keeps its search and counts. Items a collect left lying (unreachable) are left out
// of Drops from then on (progress skip).
import type { JobStepper, Outcome, StepResult, Vec3Like } from '../types/index.js';
import { decideHuntStep, PICKUP, type HuntSituation } from '../models/hunt/index.js';
import { widerSearch, type Search } from '../models/skill/index.js';
import { clampHave, dropsSeen, groundOf, huntAnimals, isHuntFood, nearestTo, preyOf, type Creature, type GroundItem, type XZ } from '../sensors/skills.js';
import type { JobDeps, JobOf } from './deps.js';
import { jobFailedMessage } from './message.js';
import { collectAndSkip, maxSkillSteps, repeated, skillDone, skillFailed, skillLogger, skillSettings, type Repeat } from './skill.js';
import { skillWorld } from './skillWorld.js';

/** What the hunt skill needs of the world (skillWorld builds it from the actuators; tests pass fakes). */
export interface HuntFoodWorld {
    me(): Vec3Like;
    items(): readonly { name: string; count: number }[];
    isFood(name: string): boolean;
    creatures(): Creature[];
    ground(): GroundItem[];
    /** Fight the creature until it dies (cancelled on an abort). */
    kill(c: Creature, signal: AbortSignal): Promise<Outcome>;
    /** Go near a creature or a place. */
    approach(p: Vec3Like, signal: AbortSignal): Promise<Outcome>;
    /** Pick up the items on the ground near andy (within 16); how many. */
    collect(signal: AbortSignal): Promise<number>;
}

export interface HuntFoodProgress {
    /** The run's start: the search square's centre. */
    origin?: XZ;
    search?: Search;
    steps?: number;
    kills?: number;
    repeat?: Repeat;
    /** Ground items a collect couldn't pick up: left out of Drops. */
    skip?: number[];
}

/** huntFoodStep: one step of the hunt skill. */
export async function huntFoodStep(job: JobOf<'huntFood'>, w: HuntFoodWorld, deps: JobDeps, signal: AbortSignal): Promise<StepResult> {
    const spec = job.spec, p = job.progress as HuntFoodProgress;
    const settings = skillSettings(deps, 'hunt');
    const s = settings();
    const log = skillLogger(deps, 'hunt', settings);
    const me = w.me();
    p.origin ??= { x: Math.floor(me.x), z: Math.floor(me.z) };
    p.search ??= 49;
    p.steps ??= 0;
    p.kills ??= 0;
    const failed = (reason: Parameters<typeof skillFailed>[0]) => skillFailed(reason, jobFailedMessage(spec, reason));
    const ground = () => w.ground().filter(g => !(p.skip ?? []).includes(g.id));
    const near = () => groundOf(w.me(), ground(), n => isHuntFood(n, w.isFood), PICKUP);
    const have = () => w.items().filter(i => isHuntFood(i.name, w.isFood)).reduce((n, i) => n + i.count, 0) + (spec.chest ?? 0);
    const sit: HuntSituation = {
        goal: clampHave(Math.max(1, spec.goal)), have: clampHave(have()), search: p.search,
        animals: huntAnimals(me, p.origin, p.search, w.creatures()),
        drops: dropsSeen(me, ground(), n => isHuntFood(n, w.isFood)),
    };
    if (p.steps >= maxSkillSteps(spec.goal) && sit.have < sit.goal) return failed('timeout');
    const d = await decideHuntStep(sit, s.model, s.min_confidence);
    if (signal.aborted) return { how: 'more' };
    const line = { purpose: job.origin, goal: `food ${sit.goal}`, ...d };
    const step = d.step;
    if (step.action === 'done') {
        log(line, 'done');
        return skillDone(`Hunted: I have ${sit.have} food.`);
    }
    if (step.action === 'give_up' || (step.action === 'search' && widerSearch(p.search) === null)) {
        log(line, 'ended', 'no_source');
        return failed('no_source');
    }
    if (repeated(p, d.state, d.words)) {
        log(line, 'ended', 'stuck');
        return failed('stuck');
    }
    let o: Outcome = { ok: true };
    switch (step.action) {
        case 'search': p.search = widerSearch(p.search)!; break;
        case 'collect': await collectAndSkip(p, near, w.collect, signal); break;
        case 'attack': case 'approach': {
            const c = nearestTo(me, preyOf(step.target, p.origin, p.search, w.creatures()));
            if (!c) { o = { ok: false, reason: 'no-block', detail: `no ${step.target}` }; break; }
            if (step.action === 'approach') { o = await w.approach(c.position, signal); break; }
            o = await w.kill(c, signal);
            if (o.ok) { p.kills++; await collectAndSkip(p, near, w.collect, signal); }
            break;
        }
    }
    if (signal.aborted || (!o.ok && o.reason === 'cancelled')) return { how: 'more' };
    p.steps++;
    log(line, o.ok ? 'did' : 'failed', o.ok ? undefined : o.reason);
    if (!o.ok) deps.note(`hunt skill: ${step.action}${'target' in step ? ` ${step.target}` : ''} failed: ${o.reason}${o.detail ? ` (${o.detail})` : ''}`);
    return { how: 'more' };
}

export function huntFoodRunner(job: JobOf<'huntFood'>, deps: JobDeps, worldOf: (deps: JobDeps) => HuntFoodWorld | null = d => {
    const a = d.act();
    return a ? skillWorld(a) : null;
}): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const w = worldOf(deps);
            if (!w) return skillFailed('not in game', 'not in game');
            const r = await huntFoodStep(job, w, deps, signal);
            if (r.how === 'end') deps.note(`hunt skill food ${job.spec.goal}: ${r.end.how}${r.end.how === 'failed' ? ` (${r.end.reason})` : ''}`);
            return r;
        },
        left(): number | null {
            const w = worldOf(deps);
            if (!w) return null;
            const have = w.items().filter(i => isHuntFood(i.name, w.isFood)).reduce((n, i) => n + i.count, 0) + (job.spec.chest ?? 0);
            return Math.max(0, job.spec.goal - have);
        },
    };
}
