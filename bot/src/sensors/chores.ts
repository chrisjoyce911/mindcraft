// The chores v2 sensors (skills-spec v1 §1 "State", design §11.4), pure over plain inputs: what the Chores class
// (chores/sense.ts) reads from the live bot is put through these; tests feed them by hand.
//
// - Carry: carried only, by kind: wood = logs + ⌊planks/4⌋; cobble = cobblestone + cobbled deepslate; coal = coal +
//   charcoal; iron = raw iron + iron ingots; food, raw, wool (string: 4 to a wool), seeds, saplings as chores v1.
//   Capped at 999.
// - Chest: the home chest's saved items less the reserved kit (home/kit.ts kitReserved), by the same kinds; all 0
//   with no home chest.
// - Made: crafting tables, furnaces, chests and beds carried (0–9). Kit: the kit's tiers, food and torches (≤ 99).
// - Tools: the best tier of each tool carried (golden as wooden, netherite as diamond), and shears.
// - Searches: the smallest square (49, 97, 193 columns around the centre) holding one of the positions, 0 for none.
// - lit: no floor point of place's torch grid (the 7×7 points, step 3, ±9: sensors/skills litPoints and columnCell)
//   is dark (block light < 8), so the place skill and this line agree.
import type { Vec3Like } from '../types/index.js';
import {
    CHORES_MAX, HAVE_KINDS, TIERS, zeroCounts,
    type BiomeWord, type ChoreSearch, type Counts, type Tier, type TimeWord,
} from '../types/chores.js';
import { columnCell, isLog, litPoints, type GridBlockAt } from './skills.js';

export interface Stack { name: string; count: number }

export const RAW_MEAT = new Set(['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon']);
export const NOT_FOOD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato']);
export const SEED_ITEMS = new Set(['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato']);
export const STRING_PER_WOOL = 4;
export const isSapling = (n: string): boolean => /_sapling$|_propagule$/.test(n);

const cap = (n: number, c: number) => Math.max(0, Math.min(c, Math.floor(n)));

/** haveCounts: the Carry (or Chest) line's counts for items. isFood: minecraft-data's foods. */
export function haveCounts(items: readonly Stack[], isFood: (name: string) => boolean): Counts {
    let logs = 0, planks = 0, string = 0;
    const c = zeroCounts();
    for (const { name, count } of items) {
        if (isLog(name)) logs += count;
        else if (name.endsWith('_planks')) planks += count;
        else if (name === 'stick') c.sticks += count;
        else if (name === 'cobblestone' || name === 'cobbled_deepslate') c.cobble += count;
        else if (name === 'coal' || name === 'charcoal') c.coal += count;
        else if (name === 'raw_iron' || name === 'iron_ingot') c.iron += count;
        else if (name === 'torch') c.torches += count;
        else if (name.endsWith('_wool')) c.wool += count;
        else if (name === 'string') string += count;
        else if (isSapling(name)) c.saplings += count;
        if (SEED_ITEMS.has(name)) c.seeds += count;
        if (isFood(name) && !NOT_FOOD.has(name)) {
            c.food += count;
            if (RAW_MEAT.has(name)) c.raw += count;
        }
    }
    c.wood = logs + Math.floor(planks / 4);
    c.wool += Math.floor(string / STRING_PER_WOOL);
    for (const k of HAVE_KINDS) c[k] = cap(c[k], CHORES_MAX.count);
    c.raw = Math.min(c.raw, c.food);
    return c;
}

/** madeCounts: the stations carried, waiting to be placed (the Made line). */
export function madeCounts(items: readonly Stack[]): { table: number; furnace: number; chest: number; bed: number } {
    const n = (test: (name: string) => boolean) => cap(items.filter(i => test(i.name)).reduce((s, i) => s + i.count, 0), CHORES_MAX.made);
    return { table: n(x => x === 'crafting_table'), furnace: n(x => x === 'furnace'), chest: n(x => x === 'chest'), bed: n(x => x.endsWith('_bed')) };
}

/** toolTier: a tool name's tier (golden as wooden, netherite as diamond), none for anything else. */
export function toolTier(name: string): Tier {
    const m = /^(wooden|golden|stone|iron|diamond|netherite)_/.exec(name);
    if (!m) return 'none';
    return ({ wooden: 'wooden', golden: 'wooden', stone: 'stone', iron: 'iron', diamond: 'diamond', netherite: 'diamond' } as const)[m[1] as 'wooden'];
}
const better = (a: Tier, b: Tier) => TIERS.indexOf(a) > TIERS.indexOf(b);

export interface ToolTiers { axe: Tier; pickaxe: Tier; sword: Tier; hoe: Tier; shovel: Tier }

/** bestTiers: the best tier of each tool among the names. */
export function bestTiers(names: readonly string[]): ToolTiers {
    const out: ToolTiers = { axe: 'none', pickaxe: 'none', sword: 'none', hoe: 'none', shovel: 'none' };
    for (const n of names) {
        const m = /_(axe|pickaxe|sword|hoe|shovel)$/.exec(n);
        if (!m) continue;
        const k = m[1] as keyof ToolTiers;
        const t = toolTier(n);
        if (better(t, out[k])) out[k] = t;
    }
    return out;
}

export interface KitLine { pickaxe: Tier; axe: Tier; shovel: Tier; sword: Tier; food: number; torches: number }

/** kitLine: the reserved kit's tiers, food and torches (the Kit line) among the home chest's items (reserved: kitReserved). */
export function kitLine(reserved: Readonly<Record<string, number>>, isFood: (name: string) => boolean): KitLine {
    const tiers = bestTiers(Object.keys(reserved));
    let food = 0, torches = 0;
    for (const [name, n] of Object.entries(reserved)) {
        if (name === 'torch') torches += n;
        else if (isFood(name) && !RAW_MEAT.has(name) && !NOT_FOOD.has(name)) food += n;
    }
    return { pickaxe: tiers.pickaxe, axe: tiers.axe, shovel: tiers.shovel, sword: tiers.sword, food: cap(food, CHORES_MAX.kit), torches: cap(torches, CHORES_MAX.kit) };
}

/** Time of day (chores v1): night 12542 ≤ T < 23460 (a bed is usable), dusk 10142 ≤ T < 12542, else day. */
export function timeWord(timeOfDay: number): TimeWord {
    const t = ((timeOfDay % 24000) + 24000) % 24000;
    if (t >= 12542 && t < 23460) return 'night';
    if (t >= 10142 && t < 12542) return 'dusk';
    return 'day';
}

/** biomeWord: the Biome word for a biome name (chores v1). */
export function biomeWord(name: string | null | undefined): BiomeWord {
    const b = String(name ?? '').toLowerCase();
    if (/snowy|frozen|ice/.test(b)) return 'snowy';
    if (/forest|taiga|jungle|birch|cherry/.test(b)) return 'forest';
    if (/plains|meadow|sunflower|savanna/.test(b)) return 'plains';
    if (/desert|badlands/.test(b)) return 'desert';
    if (/beach|ocean|river|mushroom|shore/.test(b)) return 'beach';
    return 'other';
}

// ---- areas ----

/** The base area: 21×21 columns around the centre, ±16 high. The work area: 49×49. */
export const BASE = 21;
export const WORK = 49;
export const BASE_HEIGHT = 16;
export const CHORE_SEARCHES = [49, 97, 193] as const;

const half = (size: number) => Math.floor(size / 2);
/** inColumns: p is in the size×size columns around the centre (any height). */
export const inColumns = (c: Vec3Like, p: Vec3Like, size: number): boolean =>
    Math.abs(Math.floor(p.x) - Math.floor(c.x)) <= half(size) && Math.abs(Math.floor(p.z) - Math.floor(c.z)) <= half(size);
/** inBase: p is in the base area. */
export const inBase = (c: Vec3Like, p: Vec3Like): boolean => inColumns(c, p, BASE) && Math.abs(Math.floor(p.y) - Math.floor(c.y)) <= BASE_HEIGHT;
/** searchOf: the smallest search holding one of the positions, 0 for none. */
export function searchOf(c: Vec3Like, ps: readonly Vec3Like[]): ChoreSearch {
    for (const s of CHORE_SEARCHES) if (ps.some(p => inColumns(c, p, s))) return s;
    return 0;
}
/** reachOf: the findBlocks distance that covers size×size columns. */
export const reachOf = (size: number): number => Math.ceil(half(size) * Math.SQRT2) + 1;

/** litOf: the base is lit when none of the torch grid's floor points is dark (a ',' or ';' cell). */
export function litOf(blockAt: GridBlockAt, centre: Vec3Like): boolean {
    const cy = Math.floor(centre.y);
    return !litPoints(centre).some(p => {
        const c = columnCell(blockAt, p.x, p.z, cy).cell;
        return c === ',' || c === ';';
    });
}

// ---- farm ----

/** A crop's grown age (wheat, carrots, potatoes 7; beetroots 3). */
export const CROP_GROWN: Readonly<Record<string, number>> = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };

/** farmOf: crops on farmland in the work area (ages given): a farm, ready when ≥ 8 are grown or half (chores v1 farmFacts). */
export function farmOf(crops: readonly { name: string; age: number }[]): { farm: boolean; ready: boolean } {
    const grown = crops.filter(c => c.age >= (CROP_GROWN[c.name] ?? 7)).length;
    return { farm: crops.length > 0, ready: crops.length > 0 && (grown >= 8 || grown * 2 >= crops.length) };
}
