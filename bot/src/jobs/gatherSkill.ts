// The gather skill job (5.5; skills-spec v1 §3, design §11.3–11.4): collect logs (as wood), seeds, wool or saplings
// until the count to have (carried + the home chest as the caller knows it) is met. One model step per job step:
// sense → decide (models/gather decideGatherStep) → act:
//   cut      logs: fell the nearest tree, top logs too (each log dug, lowest first), then pick up; seeds: break the
//            nearest grass and pick up the seeds;
//   shear    shear the nearest unsheared adult sheep (shears held), then pick up;
//   kill     kill the nearest adult sheep, then pick up;
//   approach go near the nearest source;   collect: pick up the goal's items (within 16);
//   search   widen the search square;   done: ends done;   give_up: failed full (no free slot) or no_source.
// Sources: logs → trees (a log with leaves beside it, by column: sensors treesOf); seeds → short/tall grass; wool →
// adult sheep (unsheared ones when shears are carried: a sheared sheep can't be shorn again); saplings → sapling items
// on the ground (the source is the drops). Never tosses anything. Bounds, resume and the skipped (unreachable) ground
// items as the hunt skill.
import type { JobStepper, Outcome, StepResult, Vec3Like } from '../types/index.js';
import { decideGatherStep, PICKUP, type GatherGoal, type GatherSituation } from '../models/gather/index.js';
import { UNSEEN, widerSearch, type Search } from '../models/skill/index.js';
import {
    clampFree, clampHave, dropsSeen, gatherCount, groundOf, gatherDrop, gatherItem, inSearch, nearestTo, seenOf, treesOf,
    type Creature, type GroundItem, type Tree, type XZ,
} from '../sensors/skills.js';
import type { JobDeps, JobOf } from './deps.js';
import { jobFailedMessage } from './message.js';
import { collectAndSkip, maxSkillSteps, repeated, skillDone, skillFailed, skillLogger, skillSettings, type Repeat } from './skill.js';
import { skillWorld } from './skillWorld.js';

/** What the gather skill needs of the world (skillWorld builds it from the actuators; tests pass fakes). */
export interface GatherSkillWorld {
    me(): Vec3Like;
    items(): readonly { name: string; count: number }[];
    /** Empty main inventory slots. */
    free(): number;
    creatures(): Creature[];
    ground(): GroundItem[];
    /** Log positions in the search square around origin. */
    logs(origin: XZ, search: Search): Vec3Like[];
    leavesBeside(p: Vec3Like): boolean;
    /** Short and tall grass positions in the search square around origin. */
    grass(origin: XZ, search: Search): Vec3Like[];
    /** Dig a tree's logs (lowest first, top ones too) and pick up. */
    fell(tree: Tree, signal: AbortSignal): Promise<Outcome>;
    /** Break the block at p and pick up what drops. */
    dig(p: Vec3Like, signal: AbortSignal): Promise<Outcome>;
    shear(c: Creature, signal: AbortSignal): Promise<Outcome>;
    kill(c: Creature, signal: AbortSignal): Promise<Outcome>;
    approach(p: Vec3Like, signal: AbortSignal): Promise<Outcome>;
    collect(signal: AbortSignal): Promise<number>;
}

export interface GatherSkillProgress {
    origin?: XZ;
    search?: Search;
    steps?: number;
    repeat?: Repeat;
    /** Ground items a collect couldn't pick up: left out of Drops (and of the saplings source). */
    skip?: number[];
}

const shears = (items: readonly { name: string }[]) => items.some(i => i.name === 'shears');

/** sources: the goal's sources in the search (positions, and the things themselves for the act). */
function sources(goal: GatherGoal, w: GatherSkillWorld, ground: () => GroundItem[], origin: XZ, search: Search, withShears: boolean): { at: Vec3Like; tree?: Tree; creature?: Creature }[] {
    switch (goal) {
        case 'logs': return treesOf(w.logs(origin, search), p => w.leavesBeside(p)).filter(t => inSearch(origin, t.base, search)).map(t => ({ at: t.base, tree: t }));
        case 'seeds': return w.grass(origin, search).filter(p => inSearch(origin, p, search)).map(p => ({ at: p }));
        case 'wool': return w.creatures().filter(c => c.name === 'sheep' && !c.baby && (!withShears || !c.sheared) && inSearch(origin, c.position, search))
            .map(c => ({ at: c.position, creature: c }));
        case 'saplings': return ground().filter(i => gatherItem('saplings', i.item) && inSearch(origin, i.position, search)).map(i => ({ at: i.position }));
    }
}

/** gatherSkillStep: one step of the gather skill. */
export async function gatherSkillStep(job: JobOf<'gatherSkill'>, w: GatherSkillWorld, deps: JobDeps, signal: AbortSignal): Promise<StepResult> {
    const spec = job.spec, p = job.progress as GatherSkillProgress, goal = spec.target;
    const settings = skillSettings(deps, 'gather');
    const s = settings();
    const log = skillLogger(deps, 'gather', settings);
    const me = w.me();
    p.origin ??= { x: Math.floor(me.x), z: Math.floor(me.z) };
    p.search ??= 49;
    p.steps ??= 0;
    const failed = (reason: Parameters<typeof skillFailed>[0]) => skillFailed(reason, jobFailedMessage(spec, reason));
    const items = w.items();
    const withShears = shears(items);
    const ground = () => w.ground().filter(g => !(p.skip ?? []).includes(g.id));
    // what a collect is for: the goal's drops within reach (saplings: the source, which is the drops)
    const near8 = () => groundOf(w.me(), ground(), n => gatherDrop(goal, n), PICKUP);
    const src = sources(goal, w, ground, p.origin, p.search, withShears);
    const sit: GatherSituation = {
        goal, want: clampHave(Math.max(1, spec.goal)), have: clampHave(gatherCount(goal, items) + (spec.chest ?? 0)),
        source: seenOf(me, src.map(x => x.at)),
        drops: goal === 'saplings' ? { ...UNSEEN } : dropsSeen(me, ground(), n => gatherDrop(goal, n)),
        shears: withShears, free: clampFree(w.free()), search: p.search,
    };
    if (p.steps >= maxSkillSteps(spec.goal) && sit.have < sit.want) return failed('timeout');
    const d = await decideGatherStep(sit, s.model, s.min_confidence);
    if (signal.aborted) return { how: 'more' };
    const line = { purpose: job.origin, goal: `${goal} ${sit.want}`, ...d };
    const a = d.step.action;
    if (a === 'done') {
        log(line, 'done');
        return skillDone(`Gathered: I have ${sit.have} ${goal}.`);
    }
    if (a === 'give_up' || (a === 'search' && widerSearch(p.search) === null)) {
        const reason = sit.free === 0 ? 'full' : 'no_source';
        log(line, 'ended', reason);
        return failed(reason);
    }
    if (repeated(p, d.state, d.words)) {
        log(line, 'ended', 'stuck');
        return failed('stuck');
    }
    const near = nearestTo(me, src.map(x => ({ ...x, position: x.at })));
    const none: Outcome = { ok: false, reason: 'no-block', detail: `no ${goal} source` };
    let o: Outcome = { ok: true };
    switch (a) {
        case 'search': p.search = widerSearch(p.search)!; break;
        case 'collect': await collectAndSkip(p, near8, w.collect, signal); break;
        case 'approach': o = near ? await w.approach(near.at, signal) : none; break;
        case 'cut':
            if (goal === 'logs') o = near?.tree ? await w.fell(near.tree, signal) : none;
            else if (goal === 'seeds') o = near ? await w.dig(near.at, signal) : none;
            else o = { ok: false, reason: 'error', detail: `cut for ${goal}` };
            break;
        case 'shear': o = near?.creature && withShears ? await w.shear(near.creature, signal) : none; break;
        case 'kill': {
            // a kill takes any adult sheep (rules v1 kill only without shears, leaving two)
            const c = nearestTo(me, w.creatures().filter(c => c.name === 'sheep' && !c.baby && inSearch(p.origin!, c.position, p.search!)));
            o = c ? await w.kill(c, signal) : none;
            if (o.ok) await collectAndSkip(p, near8, w.collect, signal);
            break;
        }
    }
    if (signal.aborted || (!o.ok && o.reason === 'cancelled')) return { how: 'more' };
    p.steps++;
    log(line, o.ok ? 'did' : 'failed', o.ok ? undefined : o.reason);
    if (!o.ok) deps.note(`gather skill: ${a} failed: ${o.reason}${o.detail ? ` (${o.detail})` : ''}`);
    return { how: 'more' };
}

export function gatherSkillRunner(job: JobOf<'gatherSkill'>, deps: JobDeps, worldOf: (deps: JobDeps) => GatherSkillWorld | null = d => {
    const a = d.act();
    return a ? skillWorld(a) : null;
}): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const w = worldOf(deps);
            if (!w) return skillFailed('not in game', 'not in game');
            const r = await gatherSkillStep(job, w, deps, signal);
            if (r.how === 'end') deps.note(`gather skill ${job.spec.target} ${job.spec.goal}: ${r.end.how}${r.end.how === 'failed' ? ` (${r.end.reason})` : ''}`);
            return r;
        },
        left(): number | null {
            const w = worldOf(deps);
            if (!w) return null;
            return Math.max(0, job.spec.goal - gatherCount(job.spec.target, w.items()) - (job.spec.chest ?? 0));
        },
    };
}
