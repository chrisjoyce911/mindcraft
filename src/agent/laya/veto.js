// The safety veto: laya-go's follow rules (games/follow/world) applied to the
// same 9×9 grid the model saw, so a move the rules call harmful or illegal is
// never taken, whatever the model says.
//
// A step onto a neighbour is legal when the neighbour is known and at most one
// block higher. It is harmful when the neighbour is harmful (lava and the like)
// or four or more blocks lower and not water. A diagonal must also not climb,
// and both orthogonal neighbours it passes between must be legal, harmless and
// no higher than the bot.

import { OFFSETS, WINDOW, MOB_KINDS } from './follow_state.js';

const C = (WINDOW - 1) / 2;
const DIAGONAL_PARTS = { NE: ['N', 'E'], SE: ['S', 'E'], SW: ['S', 'W'], NW: ['N', 'W'] };

function cell(grid, move) {
    const [dx, dz] = OFFSETS[move];
    return grid[C + dz][C + dx];
}

const enterable = (a, b) => b.surface !== 'unknown' && b.height - a.height <= 1;
const harmful = (a, b) => b.surface === 'harmful' || (a.height - b.height >= 4 && b.surface !== 'water');

// mobHarm reports whether a column at offset (dx, dz) from the bot is within
// a mob's harm radius (mobs as offsets from the bot).
function mobHarm(mobs, dx, dz) {
    return mobs.some(m => Math.hypot(m.dx - dx, m.dz - dz) <= MOB_KINDS[m.kind].harm);
}

// check returns {ok: true} or {ok: false, reason} for a move on a grid of
// cells relative to the bot ({surface, height}), refusing steps into a mob's
// harm radius too (mobs as offsets from the bot).
export function check(grid, move, mobs = []) {
    if (move === 'wait') return { ok: true };
    if (!OFFSETS[move]) return { ok: false, reason: 'unknown move' };
    if (mobHarm(mobs, ...OFFSETS[move])) return { ok: false, reason: 'mob' };
    const a = grid[C][C], b = cell(grid, move);
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
