// The pack: what laya-go's v2 prompts (mine v2, farm v2) say about the bot's
// inventory, health and home chest, the Unload rule, and what goes into the
// home chest. Pure (no mineflayer): pack_actions.js is the game side.
//
// The pack line (laya-go games/mine/prompt v2 and games/farm/prompt v2):
//
//   Pack <free> Home <dist|none> Health <0-20> Food <0-20> Hostiles <0-9> Valuables <n>
//
// free: empty inventory slots (0–36); Home: straight-line blocks to the home
// chest (memory place "home_chest"), rounded up, 1 to 999, "none" when none
// is known (laya-go reads Home 0 as none, so a known chest is never 0);
// Hostiles: hostile mobs within 16 blocks, capped at 9; Valuables: what the
// game counts as valuable, capped at 999.
//
// Shared by the farm (and, from merge time, the mine) tasks: laya-mine-plan
// has its own copies of these in mine_state.js, mine.js and skills.js.

export const MAX_FREE = 36;
export const HOME_CAP = 999;
export const HOSTILES_CAP = 9;
export const VALUABLES_CAP = 999;
export const HOSTILE_RANGE = 16;

// The Unload rule's thresholds (laya-go rules.Unload).
export const FULL_FREE = 2;
export const LOW_FREE = 6;
export const NEAR_HOME = 24;
export const RISK_VALUABLES = 4;
export const LOW_HEALTH = 8;
export const LOW_FOOD = 6;
export const MANY_HOSTILES = 2;

// homeDistance: the distance to the home chest as the pack line writes it, or
// null when none is known.
export function homeDistance(from, home) {
    if (!home || !from) return null;
    const d = Math.ceil(Math.hypot(home.x - from.x, home.y - from.y, home.z - from.z));
    return Math.max(1, Math.min(HOME_CAP, d));
}

// homeOf turns a remembered place ([x, y, z], {x, y, z} or a function giving
// one) into {x, y, z}, or null.
export function homeOf(place) {
    const p = typeof place === 'function' ? place() : place;
    if (Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)) return { x: p[0], y: p[1], z: p[2] };
    if (p && [p.x, p.y, p.z].every(Number.isFinite)) return { x: p.x, y: p.y, z: p.z };
    return null;
}

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, Math.round(n)));

// pack builds a pack ({free, home, health, food, hostiles, valuables}) with
// every number in range.
export function pack({ free = MAX_FREE, home = null, health = 20, food = 20, hostiles = 0, valuables = 0 } = {}) {
    return {
        free: clamp(free, 0, MAX_FREE), home: home == null ? null : clamp(home, 1, HOME_CAP),
        health: clamp(health, 0, 20), food: clamp(food, 0, 20),
        hostiles: clamp(hostiles, 0, HOSTILES_CAP), valuables: clamp(valuables, 0, VALUABLES_CAP),
    };
}

// packLine writes a pack as its prompt line.
export function packLine(p) {
    return `Pack ${p.free} Home ${p.home == null ? 'none' : p.home} Health ${p.health} Food ${p.food} Hostiles ${p.hostiles} Valuables ${p.valuables}`;
}

// unloadRule is laya-go's Unload truth on a pack: a home chest is known (and
// nothing else blocks it, e.g. fluid touching a miner), and the pack is full,
// nearly full with home near, or it carries valuables while in danger.
export function unloadRule(p, blocked = false) {
    if (p.home == null || blocked) return false;
    if (p.free <= FULL_FREE) return true;
    if (p.free <= LOW_FREE && p.home <= NEAR_HOME) return true;
    const danger = p.health <= LOW_HEALTH || p.food <= LOW_FOOD || p.hostiles >= MANY_HOSTILES;
    return p.valuables >= RISK_VALUABLES && danger;
}

// wantUnload decides whether to unload now: never without a home chest;
// always with no free slot; else the model's Unload answer when it is
// confident, the rule when it isn't.
export function wantUnload(p, answer, rule) {
    if (p.home == null) return false;
    if (p.free === 0) return true;
    if (answer && answer.confident) return answer.probability >= 0.5;
    return !!rule;
}

// countHostiles counts entities within range of me that isHostile says are
// hostile.
export function countHostiles(entities, me, isHostile, range = HOSTILE_RANGE) {
    let n = 0;
    for (const e of entities) {
        if (!e || e === me || !e.position || !isHostile(e)) continue;
        if (e.position.distanceTo(me.position) <= range) n++;
    }
    return n;
}

// depositList is what goes into the home chest from an inventory ({name:
// count}): keep(name, count) returns how many of an item stay in the pack.
export function depositList(inv, keep) {
    const out = [];
    for (const [name, count] of Object.entries(inv)) {
        const n = count - Math.min(count, Math.max(0, keep(name, count) || 0));
        if (n > 0) out.push({ name, count: n });
    }
    return out;
}

// TOOL is the tools a task keeps in its pack.
export const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel|fishing_rod|bow|crossbow|shield)$/;
export const isTool = name => TOOL.test(name);
