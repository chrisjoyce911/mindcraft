// The mine plan: an orderly layout for !layaMine (prompt v2), so a person can
// follow the mine, reuse it and find the bot in it. Pure: no mineflayer.
//
// From the entrance (the bot's feet and heading when it starts):
//   1. a staircase (1 wide, 2 high) straight ahead down to the first level:
//      the ore's best level (band.best, clamped to the band; else the band's
//      top), and from the surface (surface: true) at least surface_depth
//      below the entrance, so it never branch-mines at the surface; the
//      entrance height when it starts underground inside the band, or from
//      the surface already below the target (up to the band's bottom when it
//      starts below it);
//   2. at each level a main tunnel main_length blocks long, with a branch
//      branch_length blocks to the left and then the right every branch_every
//      blocks of it;
//   3. from the end of the main tunnel the staircase continues ahead
//      level_gap blocks down, and that level's main tunnel runs back the
//      other way (a serpentine, so the levels stack);
//   4. when the next level would leave the band (below its bottom, or MIN_Y),
//      a tunnel next_shaft blocks to the right (of the entrance heading)
//      starts a new column with a grid at that level, which then climbs
//      level by level (never above the first level's target), and so on,
//      turning back at each end.
//
// The plan is a list of segments (a straight run of one move kind in one
// direction from a start cell) made lazily, so a segment can start where the
// one before it stopped. plan.next(feet) gives the next step: the move from
// the current plan cell, or a walk back to that cell when the bot is
// elsewhere (after collecting ore off the line, after a branch, after
// unloading at home). plan.abandon() gives up the rest of the current branch
// or main tunnel (a main tunnel abandoned ends that level: the staircase
// continues from where it stopped); for a staircase it continues the
// staircase from where the bot's detour took it (plan.abandon(feet)), or
// without one shifts it one block to the right, up to max_shifts times with
// no stair step done in between (then the plan ends).

import { OFFSET, MIN_Y, rightOf, leftOf, backOf } from './mine_state.js';

export const PLAN_DEFAULTS = { branch_every: 3, branch_length: 16, main_length: 32, level_gap: 4, next_shaft: 40, max_shifts: 3,
    surface_depth: 10 };

const DY = { tunnel: 0, down: -1, up: 1 };

// cellAt is a segment's k-th cell (k = 0 is its start).
export function cellAt(seg, k) {
    const [dx, dz] = OFFSET[seg.dir];
    return { x: seg.from.x + dx * k, y: seg.from.y + DY[seg.kind] * k, z: seg.from.z + dz * k };
}

const same = (a, b) => a.x === b.x && a.y === b.y && a.z === b.z;

// targetLevel is the level the staircase goes down to from above: the
// ore's best level (else the band's top) clamped to the band, and from the
// surface at least depth below the entrance (within the band).
export function targetLevel(y, lo, hi, minY = MIN_Y, { best = null, surface = false, depth = PLAN_DEFAULTS.surface_depth } = {}) {
    const bottom = Math.max(lo, minY);
    const clamp = v => Math.max(bottom, Math.min(hi, v));
    let t = clamp(best ?? hi);
    if (surface) t = clamp(Math.min(t, y - depth));
    return t;
}

// firstLevel is the plan's first level for an entrance height and a band
// (opts: targetLevel's best, surface, depth).
export function firstLevel(y, lo, hi, minY = MIN_Y, opts = {}) {
    const bottom = Math.max(lo, minY);
    // already underground inside the band: the grid starts here
    if (!opts.surface && y >= bottom && y <= hi) return y;
    const t = targetLevel(y, lo, hi, minY, opts);
    return y > t ? t : y < bottom ? bottom : y;
}

// createPlan lays out a mine from start {x, y, z, heading} for an ore band
// {lo, hi, best?}. Options: PLAN_DEFAULTS, minY, surface (the entrance is
// under the open sky).
export function createPlan(start, band, options = {}) {
    const o = { ...PLAN_DEFAULTS, minY: MIN_Y, ...options };
    const bottom = Math.max(band.lo, o.minY);
    const entrance = { x: start.x, y: start.y, z: start.z };
    const side = rightOf(start.heading); // where new columns go
    const seg = (type, kind, dir, from, length) => ({ type, kind, dir, from: { ...from }, length, k: 0, abandoned: false });
    const stopped = s => cellAt(s, s.k); // where a finished or abandoned segment left off

    // stair runs a staircase from `from` in dir to height ty; returns its end
    // or null when it is blocked.
    function* stair(from, dir, ty) {
        let at = from, shifts = 0;
        while (at.y !== ty) {
            const s = seg('stair', ty < at.y ? 'down' : 'up', dir, at, Math.abs(ty - at.y));
            yield s;
            at = stopped(s);
            if (s.stopAt) return s.stopAt; // the descent stops here: this is the level
            if (!s.abandoned) continue;
            if (s.k > 0) shifts = 0; // stair steps were done since the last one
            if (++shifts > o.max_shifts) return null;
            // From where the detour took the bot: never back to the cell
            // that failed (a detour, a walk back, the same veto, ...).
            if (s.restart) { at = s.restart; continue; }
            const sh = seg('shift', 'tunnel', rightOf(dir), at, 1);
            yield sh;
            at = sh.abandoned && sh.restart ? sh.restart : stopped(sh);
        }
        return at;
    }

    // grid runs a level's main tunnel from `from` in dir with its branches;
    // returns where the main tunnel ends.
    function* grid(from, dir) {
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

    function* layout() {
        let at = entrance, dir = start.heading, vdir = -1;
        const lv = { best: band.best ?? null, surface: !!o.surface, depth: o.surface_depth };
        const y1 = firstLevel(entrance.y, band.lo, band.hi, o.minY, lv);
        // climbing columns stop at the first level's target (or y1 when lower down)
        const top = Math.max(y1, targetLevel(entrance.y, band.lo, band.hi, o.minY, lv));
        if (y1 !== at.y) {
            at = yield* stair(at, dir, y1);
            if (!at) return 'the staircase is blocked';
        }
        for (;;) {
            at = yield* grid(at, dir);
            let ny = at.y + vdir * o.level_gap;
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
    let current = null, done = null;
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

        // next gives the next step from feet {x, y, z}: {step: 'kind dir',
        // target, segment}, {walk: cell, segment}, or {done: reason}.
        next(feet) {
            for (;;) {
                if (!current) return { done };
                if (current.k >= current.length) { advance(); continue; }
                const here = cellAt(current, current.k), there = cellAt(current, current.k + 1);
                if (same(feet, there)) { current.k++; continue; }
                if (same(feet, here)) return { step: `${current.kind} ${current.dir}`, target: there, segment: current.type };
                return { walk: here, segment: current.type };
            }
        },

        // abandon gives up the rest of the current segment. restart
        // ({x, y, z}, optional): where the bot stands after its detour; a
        // staircase carries on from there (else it shifts right).
        abandon(restart = null) {
            if (!current) return;
            current.abandoned = true;
            if (restart) current.restart = { x: restart.x, y: restart.y, z: restart.z };
            advance();
        },

        // stopDescent ends a staircase where the bot stands (feet): the
        // level's grid starts there (e.g. the ground below is a cave).
        // Returns whether it did (only on a staircase going down).
        stopDescent(feet) {
            if (!current || current.type !== 'stair' || current.kind !== 'down') return false;
            current.abandoned = true;
            current.stopAt = { x: feet.x, y: feet.y, z: feet.z };
            advance();
            return true;
        },

        // torchWall is the wall a torch goes on: the left of the direction of
        // travel away from the entrance.
        torchWall() {
            return current ? leftOf(current.dir) : leftOf(start.heading);
        },
    };
}
