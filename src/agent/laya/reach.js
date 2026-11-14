// Unreachable blocks while collecting (openspec fix-gather-unreachable-logs).
// A log high up a trunk whose bottom was chopped can't be reached (andy
// doesn't pillar up), and the old collect loop went back to the same
// nearest log after every failed path. Pure: blockAt is passed in.

export const MAX_COLLECT_FAILURES = 5;
// LOG_REACH_ABOVE_GROUND: the highest a log can be above the ground block
// under its column and still be cut from the ground (eyes at ground + 2.62,
// reach 4.5: up to ground + 6).
export const LOG_REACH_ABOVE_GROUND = 6;

export const LOG_TYPES = ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
    'mangrove_log', 'cherry_log', 'pale_oak_log'];

const isLog = name => /_(log|wood)$/.test(name || '');
const isLeaves = name => /_leaves$/.test(name || '');
const isLiquid = name => name === 'water' || name === 'lava';
// solid ground to stand on: a full block that isn't leaves or liquid
const isGround = b => !!b && b.boundingBox === 'block' && !isLeaves(b.name) && !isLiquid(b.name);

// logReachable: whether the log at pos {x, y, z} can be cut from the ground.
// Walks down its column through its own trunk, air, leaves and plants to
// the first ground block; reachable when the log is at most maxAbove above
// it. An unloaded block (null) counts as reachable (no guessing).
export function logReachable(blockAt, pos, maxAbove = LOG_REACH_ABOVE_GROUND) {
    for (let d = 1; d <= maxAbove; d++) {
        const b = blockAt(pos.x, pos.y - d, pos.z);
        if (!b) return true;
        if (isLog(b.name)) continue; // its own trunk: the ground is further down
        if (isGround(b)) return true;
    }
    return false;
}

// CollectTries: the blocks one collect call has failed on (never chosen
// again in that call), and failures in a row (the call gives up at max).
export class CollectTries {
    constructor(max = MAX_COLLECT_FAILURES) { this.max = max; this.failed = new Set(); this.inRow = 0; }
    static key(p) { return `${p.x},${p.y},${p.z}`; }
    skips(p) { return !!p && this.failed.has(CollectTries.key(p)); }
    fail(p) { if (p) this.failed.add(CollectTries.key(p)); this.inRow++; }
    ok() { this.inRow = 0; }
    givenUp() { return this.inRow >= this.max; }
}

// shortReason: why a collect ended short. → 'unreachable' when it gave up
// on failures or every candidate left was out of reach, else 'none'.
export function shortReason({ givenUp, failedCount, skippedOutOfReach }) {
    return givenUp || failedCount > 0 || skippedOutOfReach ? 'unreachable' : 'none';
}
