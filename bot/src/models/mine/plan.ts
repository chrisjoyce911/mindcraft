// The mine plan (a typed port of the old bot's src/agent/laya/mine_plan.js): an orderly layout for a mine job
// (prompt v2), so a person can follow the mine, reuse it and find andy in it. Pure.
//
// From the entrance (andy's feet and heading when it starts):
//   1. a staircase (1 wide, 2 high) straight ahead down to the first level: the ore's best level (clamped to the
//      band; else the band's top), and from the surface at least surface_depth below the entrance, so it never
//      branch-mines at the surface; the entrance height when it starts underground inside the band, or from the
//      surface already below the target (up to the band's bottom when it starts below it);
//   2. at each level a main tunnel main_length blocks long, with a branch branch_length blocks to the left and then
//      the right every branch_every blocks of it;
//   3. from the end of the main tunnel the staircase continues ahead level_gap blocks down, and that level's main
//      tunnel runs back the other way (a serpentine, so the levels stack);
//   4. when the next level would leave the band (below its bottom, or MIN_Y), a tunnel next_shaft blocks to the
//      right (of the entrance heading) starts a new column with a grid at that level, which then climbs level by
//      level (never above the first level's target), and so on, turning back at each end.
//
// The plan is a list of segments (a straight run of one move kind in one direction from a start cell) made lazily,
// so a segment can start where the one before it stopped. next(feet) gives the next step: the move from the current
// plan cell, or a walk back to that cell when andy is elsewhere. abandon() gives up the rest of the current branch
// or main tunnel (a main tunnel abandoned ends that level); for a staircase it continues from where andy's detour
// took him (abandon(feet)), or without one shifts it one block to the right, up to max_shifts times with no stair
// step done in between (then the plan ends).
import type { Vec3Like } from '../../types/index.js';
import { DY, MIN_Y, OFFSET, type Dir, type MoveKind } from './data.js';
import type { MoveAction } from './questions.js';
import { backOf, leftOf, rightOf } from './rules.js';

export interface PlanOptions {
    branch_every: number;
    branch_length: number;
    main_length: number;
    level_gap: number;
    next_shaft: number;
    max_shifts: number;
    surface_depth: number;
}
export const PLAN_DEFAULTS: Readonly<PlanOptions> = { branch_every: 3, branch_length: 16, main_length: 32, level_gap: 4, next_shaft: 40,
    max_shifts: 3, surface_depth: 10 };
export const PLAN_KEYS = Object.keys(PLAN_DEFAULTS) as (keyof PlanOptions)[];

export type SegmentType = 'stair' | 'shift' | 'main' | 'branch' | 'shaft';

/** A straight run of one move kind in one direction from a start cell; k: the cells done. */
export interface Segment {
    type: SegmentType;
    kind: MoveKind;
    dir: Dir;
    from: Vec3Like;
    length: number;
    k: number;
    abandoned: boolean;
    /** Where andy stood after the detour that abandoned it (a staircase carries on from there). */
    restart?: Vec3Like;
    /** A descent stopped here: this is the level. */
    stopAt?: Vec3Like;
}

export type PlanStep =
    | { step: MoveAction; target: Vec3Like; segment: SegmentType }
    | { walk: Vec3Like; segment: SegmentType }
    | { done: string };

export interface Band { lo: number; hi: number; best?: number | null }

export interface MinePlan {
    readonly entrance: Vec3Like;
    readonly heading: Dir;
    readonly options: PlanOptions & { minY: number; surface: boolean };
    readonly segment: Segment | null;
    next(feet: Vec3Like): PlanStep;
    abandon(restart?: Vec3Like | null): void;
    skipDug(isOpen: (c: Vec3Like) => boolean, max?: number): number;
    stopDescent(feet: Vec3Like): boolean;
    torchWall(): Dir;
}

/** cellAt is a segment's k-th cell (k = 0 is its start). */
export function cellAt(seg: Pick<Segment, 'kind' | 'dir' | 'from'>, k: number): Vec3Like {
    const [dx, dz] = OFFSET[seg.dir];
    return { x: seg.from.x + dx * k, y: seg.from.y + DY[seg.kind] * k, z: seg.from.z + dz * k };
}

const same = (a: Vec3Like, b: Vec3Like) => a.x === b.x && a.y === b.y && a.z === b.z;

export interface LevelOptions { best?: number | null; surface?: boolean; depth?: number }

/**
 * targetLevel: the level the staircase goes down to from above: the ore's best level (else the band's top) clamped
 * to the band, and from the surface at least depth below the entrance (within the band).
 */
export function targetLevel(y: number, lo: number, hi: number, minY = MIN_Y, { best = null, surface = false, depth = PLAN_DEFAULTS.surface_depth }: LevelOptions = {}): number {
    const bottom = Math.max(lo, minY);
    const clamp = (v: number) => Math.max(bottom, Math.min(hi, v));
    let t = clamp(best ?? hi);
    if (surface) t = clamp(Math.min(t, y - depth));
    return t;
}

/** firstLevel: the plan's first level for an entrance height and a band. */
export function firstLevel(y: number, lo: number, hi: number, minY = MIN_Y, opts: LevelOptions = {}): number {
    const bottom = Math.max(lo, minY);
    // already underground inside the band: the grid starts here
    if (!opts.surface && y >= bottom && y <= hi) return y;
    const t = targetLevel(y, lo, hi, minY, opts);
    return y > t ? t : y < bottom ? bottom : y;
}

/** createPlan lays out a mine from start for an ore band. Options: PLAN_DEFAULTS, minY, surface. */
export function createPlan(start: Vec3Like & { heading: Dir }, band: Band,
    options: Partial<PlanOptions> & { minY?: number; surface?: boolean } = {}): MinePlan {
    const o = { ...PLAN_DEFAULTS, minY: MIN_Y, surface: false, ...options };
    const bottom = Math.max(band.lo, o.minY);
    const entrance: Vec3Like = { x: start.x, y: start.y, z: start.z };
    const side = rightOf(start.heading); // where new columns go
    const seg = (type: SegmentType, kind: MoveKind, dir: Dir, from: Vec3Like, length: number): Segment =>
        ({ type, kind, dir, from: { ...from }, length, k: 0, abandoned: false });
    const stopped = (s: Segment) => cellAt(s, s.k); // where a finished or abandoned segment left off

    // stair runs a staircase from `from` in dir to height ty; returns its end or null when it is blocked
    function* stair(from: Vec3Like, dir: Dir, ty: number): Generator<Segment, Vec3Like | null, void> {
        let at = from, shifts = 0;
        while (at.y !== ty) {
            const s = seg('stair', ty < at.y ? 'down' : 'up', dir, at, Math.abs(ty - at.y));
            yield s;
            at = stopped(s);
            if (s.stopAt) return s.stopAt; // the descent stops here: this is the level
            if (!s.abandoned) continue;
            if (s.k > 0) shifts = 0; // stair steps were done since the last one
            if (++shifts > o.max_shifts) return null;
            // from where the detour took andy: never back to the cell that failed
            if (s.restart) { at = s.restart; continue; }
            const sh = seg('shift', 'tunnel', rightOf(dir), at, 1);
            yield sh;
            at = sh.abandoned && sh.restart ? sh.restart : stopped(sh);
        }
        return at;
    }

    // grid runs a level's main tunnel from `from` in dir with its branches; returns where the main tunnel ends
    function* grid(from: Vec3Like, dir: Dir): Generator<Segment, Vec3Like, void> {
        let at = from, k = 0;
        while (k < o.main_length) {
            const s = seg('main', 'tunnel', dir, at, Math.min(o.branch_every, o.main_length - k));
            yield s;
            at = stopped(s);
            if (s.abandoned) return at;
            k += s.length;
            if (k % o.branch_every) continue;
            for (const d of [leftOf(dir), rightOf(dir)]) yield seg('branch', 'tunnel', d, at, o.branch_length);
        }
        return at;
    }

    function* layout(): Generator<Segment, string, void> {
        let at: Vec3Like | null = entrance, dir: Dir = start.heading, vdir = -1;
        const lv = { best: band.best ?? null, surface: !!o.surface, depth: o.surface_depth };
        const y1 = firstLevel(entrance.y, band.lo, band.hi, o.minY, lv);
        // climbing columns stop at the first level's target (or y1 when lower down)
        const top = Math.max(y1, targetLevel(entrance.y, band.lo, band.hi, o.minY, lv));
        if (y1 !== at.y) {
            at = yield* stair(at, dir, y1);
            if (!at) return 'the staircase is blocked';
        }
        for (;;) {
            const end: Vec3Like = yield* grid(at, dir);
            at = end;
            const ny: number = end.y + vdir * o.level_gap;
            if (ny >= bottom && ny <= top) {
                at = yield* stair(at, dir, ny);
                if (!at) return 'the staircase is blocked';
            } else {
                const s = seg('shaft', 'tunnel', side, at, o.next_shaft);
                yield s;
                at = stopped(s);
                vdir = -vdir;
            }
            dir = backOf(dir);
        }
    }

    const gen = layout();
    let current: Segment | null = null, done = '';
    const advance = () => {
        const r = gen.next();
        if (r.done) { current = null; done = r.value || 'the plan is finished'; } else current = r.value;
    };
    advance();

    return {
        entrance,
        heading: start.heading,
        options: o,
        get segment() { return current; },

        next(feet) {
            for (;;) {
                const c = current;
                if (!c) return { done };
                if (c.k >= c.length) { advance(); continue; }
                const here = cellAt(c, c.k), there = cellAt(c, c.k + 1);
                if (same(feet, there)) { c.k++; continue; }
                if (same(feet, here)) return { step: `${c.kind} ${c.dir}`, target: there, segment: c.type };
                return { walk: here, segment: c.type };
            }
        },

        abandon(restart = null) {
            const c = current;
            if (!c) return;
            c.abandoned = true;
            if (restart) c.restart = { x: restart.x, y: restart.y, z: restart.z };
            advance();
        },

        skipDug(isOpen, max = 5000) {
            let n = 0;
            while (current && n < max) {
                const c: Segment = current;
                if (c.k >= c.length) { advance(); continue; }
                if (!isOpen(cellAt(c, c.k + 1))) break;
                c.k++;
                n++;
            }
            return n;
        },

        stopDescent(feet) {
            const c = current;
            if (!c || c.type !== 'stair' || c.kind !== 'down') return false;
            c.abandoned = true;
            c.stopAt = { x: feet.x, y: feet.y, z: feet.z };
            advance();
            return true;
        },

        torchWall() {
            return current ? leftOf(current.dir) : leftOf(start.heading);
        },
    };
}
