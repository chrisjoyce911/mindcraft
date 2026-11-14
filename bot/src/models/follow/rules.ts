// The follow safety rules (a port of the old bot's src/agent/laya/veto.js): laya-go's follow rules
// (games/follow/world) applied to the same 9×9 grid the model saw, so a move the rules call harmful or
// illegal is never taken, whatever the model says.
//
// A step onto a neighbour is legal when the neighbour is known and at most one block higher. It is harmful
// when the neighbour is harmful (lava and the like) or four or more blocks lower and not water. A diagonal
// must also not climb, and both orthogonal neighbours it passes between must be legal, harmless and no
// higher than the bot. A step into a known mob's harm radius is refused too.

import { MOB_KINDS, OFFSETS, WINDOW, type Column, type Grid, type Move, type RelMob } from './render.js';

export const FOLLOW_VETOES = ['mob', 'unknown', 'climb', 'harmful', 'drop', 'diagonal climb', 'corner'] as const;
export type FollowVeto = (typeof FOLLOW_VETOES)[number];
export type Verdict = { ok: true } | { ok: false; reason: FollowVeto };

const C = (WINDOW - 1) / 2;
const DIAGONAL_PARTS: Partial<Record<Move, readonly [Move, Move]>> = { NE: ['N', 'E'], SE: ['S', 'E'], SW: ['S', 'W'], NW: ['N', 'W'] };
const UNKNOWN: Column = { surface: 'unknown', height: 0 };

function cell(grid: Grid, move: Move): Column {
    const [dx, dz] = OFFSETS[move];
    return grid[C + dz]?.[C + dx] ?? UNKNOWN;
}

const enterable = (a: Column, b: Column) => b.surface !== 'unknown' && b.height - a.height <= 1;
const harmful = (a: Column, b: Column) => b.surface === 'harmful' || (a.height - b.height >= 4 && b.surface !== 'water');
const mobHarm = (mobs: readonly RelMob[], dx: number, dz: number) =>
    mobs.some(m => Math.hypot(m.dx - dx, m.dz - dz) <= MOB_KINDS[m.kind].harm);

/** check: may the bot take move on grid (cells relative to the bot), with mobs as offsets from the bot? */
export function check(grid: Grid, move: Move, mobs: readonly RelMob[] = []): Verdict {
    if (move === 'wait') return { ok: true };
    const [mx, mz] = OFFSETS[move];
    if (mobHarm(mobs, mx, mz)) return { ok: false, reason: 'mob' };
    const a = grid[C]?.[C] ?? UNKNOWN, b = cell(grid, move);
    if (b.surface === 'unknown') return { ok: false, reason: 'unknown' };
    if (!enterable(a, b)) return { ok: false, reason: 'climb' };
    if (b.surface === 'harmful') return { ok: false, reason: 'harmful' };
    if (harmful(a, b)) return { ok: false, reason: 'drop' };
    const parts = DIAGONAL_PARTS[move];
    if (parts) {
        if (b.height > a.height) return { ok: false, reason: 'diagonal climb' };
        for (const p of parts) {
            const c = cell(grid, p);
            if (!enterable(a, c) || harmful(a, c) || c.height > a.height) return { ok: false, reason: 'corner' };
        }
    }
    return { ok: true };
}
