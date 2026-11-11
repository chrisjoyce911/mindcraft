// The farm rules (a typed port of the old farm_state.js decide and farm.js veto/needed/farmKeep, and pack.js's
// Unload rule; laya-go games/farm/rules v2.1): the rules' answer, the fallback when the model isn't sure (v2) or
// its answer is banned; the safety veto; the item an answer needs; what unloading keeps; the Unload truth. Pure.
import { CROP_INFO, CROP_OF, FOODS, NEEDS, NONE, PRODUCE, SEEDS, SIZE, isSeed, type AnimalKind, type FarmAction, type Inv } from './data.js';
import type { FarmSituation, Pack } from './render.js';
import {
    at, besideHole, cellName, countOf, has, isGrowing, isRipe, nearest, nearestDry, parseCellName, type FarmView, type GridPos,
} from './view.js';
import type { CellCode } from './data.js';
import type { Stack } from '../../home/chest.js';

export const FARM_RULES = ['harvest', 'water', 'plant-crop', 'replant', 'plant', 'till', 'pond', 'find_water', 'breed', 'bone_meal', 'wait'] as const;
export type FarmRule = (typeof FARM_RULES)[number];

/** An answer: the action, its target (a cell name, an animal kind or none) and item. */
export interface FarmAnswer { action: FarmAction; target: string; item: string }
export interface FarmDecision extends FarmAnswer { rule: FarmRule }

const KEEP = 4; // seeds kept back from breeding

function seedFor(s: FarmSituation, p: GridPos): { seed: string; rule: FarmRule } {
    const want = s.crop && s.crop !== 'any' ? CROP_OF[s.crop] : null;
    if (want && countOf(s, want.seed) > 0) return { seed: want.seed, rule: 'plant-crop' };
    const counts: Record<string, number> = {};
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = p.x + dx, z = p.z + dz;
        if ((dx === 0 && dz === 0) || x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
        const code = s.grid[z]![x]!;
        const cr = CROP_INFO.find(c => c.growing === code || c.ripe === code);
        if (cr && countOf(s, cr.seed) > 0) counts[cr.seed] = (counts[cr.seed] || 0) + 1;
    }
    let best = '', n = 0;
    for (const cr of CROP_INFO) if ((counts[cr.seed] || 0) > n) { best = cr.seed; n = counts[cr.seed]!; }
    if (best) return { seed: best, rule: 'replant' };
    for (const cr of CROP_INFO) if (countOf(s, cr.seed) > 0 && (!best || countOf(s, cr.seed) > countOf(s, best))) best = cr.seed;
    return { seed: best, rule: 'plant' };
}

function breedFood(s: FarmSituation, kind: AnimalKind): string | null {
    const spare = (f: string) => countOf(s, f) - (isSeed(f) ? KEEP : 0);
    let best = '';
    for (const f of FOODS[kind]) if (spare(f) >= 2 && (!best || spare(f) > spare(best))) best = f;
    return best || null;
}

/** farmCell: part of a farm, or one without needing water (laya-go farmCell). */
const farmCell = (c: CellCode) => isRipe(c) || isGrowing(c) || c === 'G' || c === 'F' || c === 'D';

/** decide is laya-go's rules.Decide: the answer and its rule; prompt v2's rules when the situation has a crop. */
export function decide(s: FarmSituation): FarmDecision {
    const g = s.grid, near = (m: (c: CellCode) => boolean) => nearest(g, m);
    const d = (action: FarmAction, p: GridPos | string, item: string, rule: FarmRule): FarmDecision =>
        ({ action, target: typeof p === 'string' ? p : cellName(p.x, p.z), item, rule });
    let p = near(isRipe);
    if (p) return d('harvest', p, NONE, 'harvest');
    const bucket = countOf(s, 'water_bucket') > 0;
    if (bucket && (p = near(c => c === 'D'))) return d('water', p, 'water_bucket', 'water');
    if (CROP_INFO.some(c => countOf(s, c.seed) > 0)) {
        if ((p = near(c => c === 'F' || (!bucket && c === 'D')))) {
            const { seed, rule } = seedFor(s, p);
            return d('plant', p, seed, rule);
        }
        if (countOf(s, 'hoe') > 0 && (p = near(c => c === 'G'))) return d('till', p, 'hoe', 'till');
    }
    if (s.crop) { // v2
        if (bucket && countOf(s, 'hoe') > 0 && CROP_INFO.some(c => countOf(s, c.seed) > 0) && (p = nearestDry(g)))
            return d('pond', p, 'water_bucket', 'pond');
        if (!bucket && !near(farmCell)) return d('find_water', NONE, NONE, 'find_water');
    }
    for (const h of s.animals) {
        if (h.count < 2) continue;
        const f = breedFood(s, h.kind);
        if (f) return d('breed', h.kind, f, 'breed');
    }
    if (countOf(s, 'bone_meal') > 0 && (p = near(isGrowing))) return d('bone_meal', p, 'bone_meal', 'bone_meal');
    return d('wait', NONE, NONE, 'wait');
}

export const VETOES = ['no-pair', 'wrong-food', 'no-cell', 'not-ripe', 'not-farmland', 'not-a-seed', 'not-tillable', 'not-dry-farmland',
    'not-dry-ground', 'beside-hole', 'not-growing', 'unknown-action'] as const;
export type FarmVeto = (typeof VETOES)[number];

/**
 * veto returns null when the answer is safe to carry out, or why it isn't. Flooding is checked by the act (it needs
 * the world), trampling by the movements it uses.
 */
export function veto(s: FarmView, action: FarmAction, target: string, item: string): FarmVeto | null {
    if (action === 'wait' || action === 'find_water') return null;
    if (action === 'breed') {
        const herd = s.animals.find(h => h.kind === target);
        if (!herd || herd.count < 2) return 'no-pair';
        if (!FOODS[herd.kind].includes(item)) return 'wrong-food';
        return null;
    }
    const cell = parseCellName(target);
    if (!cell) return 'no-cell';
    const code = at(s.grid, cell);
    switch (action) {
        case 'harvest': return isRipe(code) ? null : 'not-ripe';
        case 'plant': return code === 'F' || code === 'D' ? (SEEDS.includes(item) ? null : 'not-a-seed') : 'not-farmland';
        case 'till': return code === 'G' || code === 'L' ? null : 'not-tillable';
        case 'water': return code === 'D' ? null : 'not-dry-farmland';
        case 'pond': return code !== 'L' ? 'not-dry-ground' : besideHole(s, cell) ? 'beside-hole' : null;
        case 'bone_meal': return isGrowing(code) ? null : 'not-growing';
        default: return 'unknown-action';
    }
}

/** needed returns the item an answer needs that andy doesn't carry, or null. */
export function needed(s: FarmView, action: FarmAction, item: string): string | null {
    const want = item !== NONE ? item : NEEDS[action];
    if (!want || action === 'harvest' || action === 'wait' || action === 'find_water') return null;
    return has(s, want) ? null : want;
}

/** TOOL: the tools a task keeps in its pack (pack.js). */
export const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel|fishing_rod|bow|crossbow|shield)$/;
export const isTool = (name: string): boolean => TOOL.test(name);

/** A keep rule: how many of an item stay in the pack when unloading. */
export type Keep = (name: string, count: number) => number;

/**
 * farmKeep: tools, buckets, bone meal and food all stay; up to keepSeeds of each seed (carrots and potatoes are
 * seeds, though food); the produce (wheat, beetroot) none.
 */
export function farmKeep(isFood: (name: string) => boolean = () => false, keepSeeds = 16): Keep {
    return (name, count) => {
        if (isTool(name) || name === 'bucket' || name === 'water_bucket' || name === 'bone_meal') return count;
        if (SEEDS.includes(name)) return Math.min(count, keepSeeds);
        if (PRODUCE.any.includes(name)) return 0;
        return isFood(name) ? count : 0;
    };
}

/** depositList: what goes into the home chest from an inventory (the rest of keep). */
export function depositList(inv: Inv, keep: Keep): Stack[] {
    const out: Stack[] = [];
    for (const [name, count] of Object.entries(inv)) {
        const n = count - Math.min(count, Math.max(0, keep(name, count) || 0));
        if (n > 0) out.push({ name, count: n });
    }
    return out;
}

/** farmValuables: prompt v2's Valuables: the harvested crops carried beyond what unloading keeps. */
export function farmValuables(inv: Inv, keep: Keep): number {
    let n = 0;
    for (const name of PRODUCE.any) {
        const c = inv[name] || 0;
        n += c - Math.min(c, keep(name, c));
    }
    return n;
}

// The Unload rule's thresholds (laya-go rules.Unload).
export const FULL_FREE = 2;
export const LOW_FREE = 6;
export const NEAR_HOME = 24;
export const RISK_VALUABLES = 4;
export const LOW_HEALTH = 8;
export const LOW_FOOD = 6;
export const MANY_HOSTILES = 2;

/**
 * unloadRule is laya-go's Unload truth on a pack: a home chest is known, and the pack is full, nearly full with home
 * near, or it carries valuables while in danger.
 */
export function unloadRule(p: Pack): boolean {
    if (p.home == null) return false;
    if (p.free <= FULL_FREE) return true;
    if (p.free <= LOW_FREE && p.home <= NEAR_HOME) return true;
    const danger = p.health <= LOW_HEALTH || p.food <= LOW_FOOD || p.hostiles >= MANY_HOSTILES;
    return p.valuables >= RISK_VALUABLES && danger;
}

/** wantUnload: never without a home chest; always with no free slot; else the model when confident, else the rule. */
export function wantUnload(p: Pack, answer: { probability: number; confident: boolean } | undefined): boolean {
    if (p.home == null) return false;
    if (p.free === 0) return true;
    if (answer && answer.confident) return answer.probability >= 0.5;
    return unloadRule(p);
}
