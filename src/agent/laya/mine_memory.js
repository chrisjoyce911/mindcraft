// Mine memory: each mine !layaMine lays out (its entrance, heading, whether
// it started at the surface, the ores mined there, the deepest level reached
// and where the bot last was) is saved, so a new mine job near a saved mine
// goes on with that mine instead of digging a new staircase beside it. The
// plan is the same layout from the same entrance, so its dug staircase and
// tunnels are walked through (plan.skipDug) and a deeper ore's staircase
// carries on below. One mine serves every ore. Pure: the file I/O is passed
// in (load() → array, save(array)).

export const REUSE_RANGE = 16;
export const MAX_MINES = 32;

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// nearestMine is the saved mine nearest to feet within range (horizontal
// distance to its entrance or to where the bot last was in it), or null.
export function nearestMine(mines, feet, range = REUSE_RANGE) {
    let best = null, bestD = Infinity;
    for (const m of mines || []) {
        if (!m?.entrance) continue;
        const d = Math.min(flat(m.entrance, feet), m.last ? flat(m.last, feet) : Infinity);
        if (d <= range && d < bestD) { best = m; bestD = d; }
    }
    return best;
}

// upsertMine puts a mine record in the list (matched by its entrance),
// newest first, at most MAX_MINES; returns the new list.
export function upsertMine(mines, rec) {
    const key = m => `${m.entrance.x},${m.entrance.y},${m.entrance.z}`;
    const rest = (mines || []).filter(m => m?.entrance && key(m) !== key(rec));
    return [rec, ...rest].slice(0, MAX_MINES);
}

// mineStore wraps load/save into find(feet) and save(rec); never throws.
export function mineStore({ load, save }, range = REUSE_RANGE) {
    const read = () => { try { const v = load(); return Array.isArray(v) ? v : []; } catch { return []; } };
    return {
        find: feet => nearestMine(read(), feet, range),
        save: rec => { try { save(upsertMine(read(), rec)); } catch { /* memory is a nicety */ } },
    };
}
