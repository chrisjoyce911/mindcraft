// The place skill job (5.5; skills-spec v1 §4, design §11.4): put one thing (a crafting table, furnace, chest, bed,
// torch or sapling) in the base where the place model says. One step: the item must be carried, else one is taken
// from the home chest (not the player kit; none there: failed missing_<item>); read the grid around the base centre
// (sensors placeGrid: 9×9 step 1, torches 7×7 step 3); decide (models/place decidePlaceStep); none → failed no_spot.
// Else the cell becomes a block position (centre + the answer's blocks, the cell's floor height) and that column is
// read again just before placing (a bed: its east, head column too): a cell that changed is failed no_spot. Then walk
// near, place it (a bed from the west, so its head is on the east cell; a bed facing any other way is taken back) and
// check the block is there. A placement the actuator couldn't make ends failed stuck.
import type { JobStepper, Outcome, PlaceItem, StepResult, Vec3Like } from '../types/index.js';
import { decidePlaceStep, gridSize, type PlaceSituation } from '../models/place/index.js';
import { columnCell, placeGrid, type GridBlockAt } from '../sensors/skills.js';
import type { JobDeps, JobOf } from './deps.js';
import { jobFailedMessage } from './message.js';
import { skillDone, skillFailed, skillLogger, skillSettings } from './skill.js';
import { skillWorld } from './skillWorld.js';

/** What the place skill needs of the world (skillWorld builds it from the actuators; tests pass fakes). */
export interface PlaceWorld {
    /** The carried item that is the thing (a bed: any colour; saplings: any kind), or null. */
    carried(item: PlaceItem): string | null;
    /**
     * Take one of the thing from the home chest (never the player kit: design §11.4); the item's name, or null when
     * there is no home chest or it holds none.
     */
    fetch(item: PlaceItem, signal: AbortSignal): Promise<string | null>;
    /** The base centre (home/centre baseCentre until 5.6 ports chooseCentre). */
    centre(): Vec3Like;
    blockAt: GridBlockAt;
    /**
     * Walk near and place the named item into the cell p (standing on its floor); OK when the block is there. A bed:
     * from the west of the cell (unreachable when that walk fails), and OK only when its head is on the east cell;
     * otherwise it is taken back (never left wrong, never thrown away).
     */
    put(name: string, item: PlaceItem, p: Vec3Like, signal: AbortSignal): Promise<Outcome>;
}

/** placeStep: the place skill's one step. */
export async function placeStep(job: JobOf<'place'>, w: PlaceWorld, deps: JobDeps, signal: AbortSignal): Promise<StepResult> {
    const item = job.spec.item;
    const settings = skillSettings(deps, 'place');
    const s = settings();
    const log = skillLogger(deps, 'place', settings);
    const failed = (reason: Parameters<typeof skillFailed>[0]) => skillFailed(reason, jobFailedMessage(job.spec, reason));
    let name = w.carried(item);
    if (!name) {
        name = await w.fetch(item, signal);
        if (signal.aborted) return { how: 'more' };
        if (!name) return failed(`missing_${item}`);
    }
    const c = w.centre();
    const cx = Math.floor(c.x), cy = Math.floor(c.y), cz = Math.floor(c.z);
    const sit: PlaceSituation = { item, grid: placeGrid(w.blockAt, c, item) };
    const d = await decidePlaceStep(sit, s.model, s.min_confidence);
    if (signal.aborted) return { how: 'more' };
    const line = { purpose: job.origin, goal: item, ...d };
    if (d.step.kind === 'none') {
        log(line, 'ended', 'no_spot');
        return failed('no_spot');
    }
    const { n, step } = gridSize(item);
    const x = cx + d.step.dx, z = cz + d.step.dz;
    const was = sit.grid[(n >> 1) + d.step.dz / step]![(n >> 1) + d.step.dx / step];
    const now = columnCell(w.blockAt, x, z, cy);
    // a bed's head goes on the east cell: the rule read it as floor, so it is read again too
    const eastWas = item === 'bed' ? sit.grid[(n >> 1) + d.step.dz / step]![(n >> 1) + d.step.dx / step + 1] : undefined;
    const eastNow = item === 'bed' ? columnCell(w.blockAt, x + 1, z, cy).cell : undefined;
    if (now.cell !== was || now.feet === null || eastNow !== eastWas) {
        log(line, 'ended', 'no_spot');
        deps.note(`place skill: ${item} cell ${d.words.Target} changed (${was} → ${now.cell}${item === 'bed' ? `, east ${eastWas} → ${eastNow}` : ''})`);
        return failed('no_spot');
    }
    const at = { x, y: now.feet, z };
    const o = await w.put(name, item, at, signal);
    if (signal.aborted || (!o.ok && o.reason === 'cancelled')) return { how: 'more' };
    if (!o.ok) {
        log(line, 'failed', o.reason);
        deps.note(`place skill: ${item} at ${x} ${at.y} ${z} failed: ${o.reason}${o.detail ? ` (${o.detail})` : ''}`);
        return failed(o.reason === 'missing-item' ? `missing_${item}` : 'stuck');
    }
    log(line, 'did');
    return skillDone(`Placed the ${item.replace(/_/g, ' ')} at ${x} ${at.y} ${z}.`);
}

export function placeRunner(job: JobOf<'place'>, deps: JobDeps, worldOf: (deps: JobDeps) => PlaceWorld | null = d => {
    const a = d.act();
    return a ? skillWorld(a, d.places, t => d.note(t)) : null;
}): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const w = worldOf(deps);
            if (!w) return skillFailed('not in game', 'not in game');
            const r = await placeStep(job, w, deps, signal);
            if (r.how === 'end') deps.note(`place skill ${job.spec.item}: ${r.end.how}${r.end.how === 'failed' ? ` (${r.end.reason})` : ''}`);
            return r;
        },
        left: () => 1,
    };
}
