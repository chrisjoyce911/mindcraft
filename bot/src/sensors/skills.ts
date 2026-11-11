// The skill models' sensors (skills-spec v1 §2–4, design §11.4), pure over plain inputs: what the hunt, gather and
// place jobs see. The jobs' worlds (jobs/skillWorld.ts) feed them from the live bot; tests feed them by hand.
//
// - Directions: N E S W by the larger axis of (dx, dz) from andy; a tie goes to N/S (N is −z).
// - Distances: ⌊horizontal Euclidean distance⌋ from andy (as the chores search), capped at 99.
// - The search square: 49, 97 or 193 columns on a side around the run's start (half 24, 48, 96).
// - Counts are capped at 9, have at 999, free at 0–36: the sensor clamps, the renderers refuse.
// - The place grid: 9×9 at step 1 around the base centre, or for torches 7×7 at step 3 (±9): LIT_OFFSETS, the same
//   points chores' lit line samples. Each column's cell is classified by CELL_TABLE (data) and columnCell.
import type { Vec3Like } from '../types/index.js';
import {
    DROPS_RANGE, HUNT_KINDS, MAX_COUNT, MAX_DIST, MAX_FREE, MAX_HAVE, UNSEEN, gridSize,
    type Cell, type Dir, type GatherGoal, type HuntKind, type PlaceItem, type Search, type Seen,
} from '../types/index.js';

export interface XZ { x: number; z: number }

/** dirOf: the direction of (dx, dz) by the larger axis; a tie goes to N/S (dz ≤ 0: N). */
export function dirOf(dx: number, dz: number): Dir {
    if (Math.abs(dz) >= Math.abs(dx)) return dz <= 0 ? 'N' : 'S';
    return dx > 0 ? 'E' : 'W';
}

/** flatDist: ⌊horizontal Euclidean distance⌋. */
export const flatDist = (a: XZ, b: XZ): number => Math.floor(Math.hypot(a.x - b.x, a.z - b.z));

/** inSearch: p's column is inside the search square around the origin. */
export function inSearch(origin: XZ, p: XZ, search: Search): boolean {
    const half = (search - 1) / 2;
    return Math.abs(Math.floor(p.x) - Math.floor(origin.x)) <= half && Math.abs(Math.floor(p.z) - Math.floor(origin.z)) <= half;
}

/** seenOf: how many points (capped at 9), the nearest one's distance from me (capped at maxDist) and direction. */
export function seenOf(me: XZ, points: readonly XZ[], maxDist = MAX_DIST): Seen {
    if (!points.length) return { ...UNSEEN };
    let best = points[0]!, bd = Infinity;
    for (const p of points) {
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) { best = p; bd = d; }
    }
    return { count: Math.min(MAX_COUNT, points.length), dist: Math.min(maxDist, flatDist(me, best)), dir: dirOf(best.x - me.x, best.z - me.z) };
}

/** nearestTo: the thing nearest me (by its position), or null. */
export function nearestTo<T extends { position: XZ }>(me: XZ, list: readonly T[]): T | null {
    let best: T | null = null, bd = Infinity;
    for (const t of list) {
        const p = t.position;
        const d = Math.hypot(p.x - me.x, p.z - me.z);
        if (d < bd) { best = t; bd = d; }
    }
    return best;
}

export const clampHave = (n: number): number => Math.max(0, Math.min(MAX_HAVE, Math.floor(n)));
export const clampFree = (n: number): number => Math.max(0, Math.min(MAX_FREE, Math.floor(n)));

// ---- animals and drops ----

/** An animal as the sensors see it (adult or not, sheared or not, read by the world). */
export interface Creature { id: number; name: string; position: Vec3Like; baby: boolean; sheared?: boolean }
/** An item entity on the ground and the item it is. */
export interface GroundItem { id: number; item: string; position: Vec3Like }

/** huntKindOf: a hunt kind for an entity name (a mooshroom counts as a cow, as chores v1.1), or null. */
export function huntKindOf(name: string): HuntKind | null {
    if (name === 'mooshroom') return 'cow';
    return (HUNT_KINDS as readonly string[]).includes(name) ? (name as HuntKind) : null;
}

/** preyOf: the adults of a kind inside the search. */
export const preyOf = (kind: HuntKind, origin: XZ, search: Search, creatures: readonly Creature[]): Creature[] =>
    creatures.filter(c => !c.baby && huntKindOf(c.name) === kind && inSearch(origin, c.position, search));

/** huntAnimals: the Animals line: each kind's adults inside the search, seen from me. */
export function huntAnimals(me: XZ, origin: XZ, search: Search, creatures: readonly Creature[]): Record<HuntKind, Seen> {
    return Object.fromEntries(HUNT_KINDS.map(k => [k, seenOf(me, preyOf(k, origin, search, creatures).map(c => c.position))])) as Record<HuntKind, Seen>;
}

/** groundOf: the ground items within range of me that pass test. */
export const groundOf = (me: Vec3Like, items: readonly GroundItem[], test: (item: string) => boolean, range = DROPS_RANGE): GroundItem[] =>
    items.filter(i => test(i.item) && Math.hypot(i.position.x - me.x, i.position.z - me.z) <= range && Math.abs(i.position.y - me.y) <= range);

/** dropsSeen: the Drops line: ground items within 16 that pass test. */
export const dropsSeen = (me: Vec3Like, items: readonly GroundItem[], test: (item: string) => boolean): Seen =>
    seenOf(me, groundOf(me, items, test).map(i => i.position), DROPS_RANGE);

// ---- what counts toward a goal ----

/** The harmful foods (pack.ts HARMFUL) and the not-food (kit NOT_FOOD) are not food. */
const NOT_FOOD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish', 'suspicious_stew']);
export const isHuntFood = (name: string, isFood: (n: string) => boolean): boolean => isFood(name) && !NOT_FOOD.has(name);

/** gatherItem: an item counts toward a gather goal (logs: logs and planks; wool: any colour; saplings: any kind). */
export function gatherItem(goal: GatherGoal, name: string): boolean {
    switch (goal) {
        case 'logs': return isLog(name) || name.endsWith('_planks');
        case 'seeds': return name === 'wheat_seeds';
        case 'wool': return name.endsWith('_wool');
        case 'saplings': return name.endsWith('_sapling') || name === 'mangrove_propagule';
    }
}
/** gatherDrop: a ground item is the goal's drop (logs: logs only). */
export const gatherDrop = (goal: GatherGoal, name: string): boolean => goal === 'logs' ? isLog(name) : gatherItem(goal, name);

/** isLog: a log or stem (not stripped wood blocks' "wood"). */
export const isLog = (name: string): boolean => /_(log|stem)$/.test(name);

/** gatherCount: what items count for a goal (logs: wood = logs + ⌊planks/4⌋, as chores). */
export function gatherCount(goal: GatherGoal, items: readonly { name: string; count: number }[]): number {
    if (goal === 'logs') {
        let logs = 0, planks = 0;
        for (const i of items) if (isLog(i.name)) logs += i.count; else if (i.name.endsWith('_planks')) planks += i.count;
        return logs + Math.floor(planks / 4);
    }
    return items.filter(i => gatherItem(goal, i.name)).reduce((n, i) => n + i.count, 0);
}

// ---- trees ----

/** A tree: its log positions (lowest first) and its base (the lowest log). */
export interface Tree { base: Vec3Like; logs: Vec3Like[] }

/**
 * treesOf: logs clustered by column (columns next to each other, a 2×2 trunk, are one tree); a cluster is a tree
 * when a log of it has leaves beside it. Player-built logs and stumps without leaves aren't trees.
 */
export function treesOf(logs: readonly Vec3Like[], leavesBeside: (p: Vec3Like) => boolean): Tree[] {
    const cols = new Map<string, Vec3Like[]>();
    for (const p of logs) {
        const k = `${p.x},${p.z}`;
        cols.set(k, [...(cols.get(k) ?? []), p]);
    }
    const seen = new Set<string>();
    const trees: Tree[] = [];
    for (const k of cols.keys()) {
        if (seen.has(k)) continue;
        const group: Vec3Like[] = [];
        const todo = [k];
        seen.add(k);
        while (todo.length) {
            const c = todo.pop()!;
            group.push(...cols.get(c)!);
            const [x, z] = c.split(',').map(Number) as [number, number];
            for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
                const n = `${x + dx},${z + dz}`;
                if (!seen.has(n) && cols.has(n)) { seen.add(n); todo.push(n); }
            }
        }
        if (!group.some(leavesBeside)) continue;
        group.sort((a, b) => a.y - b.y || a.x - b.x || a.z - b.z);
        trees.push({ base: group[0]!, logs: group });
    }
    return trees;
}

// ---- the place grid ----

/** The torch grid's offsets (7 points, step 3, ±9): chores' lit line samples the same points (skills-spec §1). */
export const LIT_OFFSETS: readonly number[] = [-9, -6, -3, 0, 3, 6, 9];

/** gridOffsets: the grid's column offsets from the centre for an item, west/north first. */
export function gridOffsets(item: PlaceItem): number[] {
    const { n, step } = gridSize(item);
    return Array.from({ length: n }, (_, i) => (i - (n >> 1)) * step);
}

/** litPoints: the torch grid's (and chores lit's) columns around a centre. */
export function litPoints(centre: XZ): XZ[] {
    const cx = Math.floor(centre.x), cz = Math.floor(centre.z);
    return LIT_OFFSETS.flatMap(dz => LIT_OFFSETS.map(dx => ({ x: cx + dx, z: cz + dz })));
}

/** A block as the grid reads it: name, shape, block light (mineflayer Block fits). */
export interface GridBlock { name: string; boundingBox?: string; light?: number }
export type GridBlockAt = (x: number, y: number, z: number) => GridBlock | null;

const GRASS_DIRT = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mycelium']);
const CROPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem']);
/**
 * CELL_TABLE: the cells a block makes by itself, whatever is around it (the spec's symbols), tested in order on the
 * column's top block. Anything else that is solid is floor; anything passable is looked through.
 */
export const CELL_TABLE: readonly { cell: Cell; test: (name: string) => boolean }[] = [
    { cell: '~', test: n => n === 'water' || n === 'bubble_column' || n === 'kelp' || n === 'kelp_plant' || n === 'seagrass' || n === 'tall_seagrass' },
    { cell: 'f', test: n => n === 'farmland' || CROPS.has(n) },
    { cell: '=', test: n => n === 'dirt_path' },
    { cell: 'C', test: n => n === 'chest' || n === 'trapped_chest' || n === 'barrel' },
    { cell: 'T', test: n => n === 'crafting_table' },
    { cell: 'F', test: n => n === 'furnace' || n === 'blast_furnace' || n === 'smoker' },
    { cell: 'B', test: n => n.endsWith('_bed') },
    { cell: 't', test: n => n === 'torch' || n === 'soul_torch' },
    { cell: 's', test: n => n.endsWith('_sapling') || n === 'mangrove_propagule' || isLog(n) },
    { cell: '#', test: n => n.endsWith('_leaves') || n === 'lava' || /(_fence|_wall|_pane|fence_gate|cactus|magma_block|campfire)$/.test(n) },
];
/** Blocks looked through: the column's top is below them. */
const PASSABLE = new Set(['air', 'cave_air', 'void_air', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'snow',
    'dandelion', 'poppy', 'blue_orchid', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy',
    'cornflower', 'lily_of_the_valley', 'sunflower', 'lilac', 'rose_bush', 'peony', 'wall_torch', 'vine']);
const passable = (b: GridBlock): boolean => PASSABLE.has(b.name) || (b.boundingBox === 'empty' && !CELL_TABLE.some(r => r.test(b.name)));
/** A cell is dark when the block light where one stands is below 8 (chores' darkSpot). */
export const DARK_BELOW = 8;
/** How far up and down from the centre's feet height a floor is looked for. */
export const FLOOR_RANGE = 2;

/** A column's cell and, for a floor, the y of the cell one stands in (where the item goes). */
export interface ColumnCell { cell: Cell; feet: number | null }

/**
 * columnCell: the column's cell around feet height cy: its top block within FLOOR_RANGE (looking through air and
 * plants), classified by CELL_TABLE, else a floor (grass/dirt or other, lit or dark) with two passable blocks
 * above; '#' when nothing is in range (a drop), the column isn't loaded, or there is no head room.
 */
export function columnCell(blockAt: GridBlockAt, x: number, z: number, cy: number): ColumnCell {
    const no: ColumnCell = { cell: '#', feet: null };
    for (let y = cy + FLOOR_RANGE; y >= cy - FLOOR_RANGE - 1; y--) {
        const b = blockAt(x, y, z);
        if (!b) return no;
        const special = CELL_TABLE.find(r => r.test(b.name));
        if (special) return { cell: special.cell, feet: special.cell === '#' ? null : y };
        if (passable(b)) continue;
        if (y === cy + FLOOR_RANGE) return no; // solid at the top of the range: a wall
        const above = blockAt(x, y + 1, z), head = blockAt(x, y + 2, z);
        if (!above || !head || !passable(above) || !passable(head)) return no;
        const dark = (above.light ?? 15) < DARK_BELOW;
        const grass = GRASS_DIRT.has(b.name);
        return { cell: grass ? (dark ? ',' : '.') : (dark ? ';' : ':'), feet: y + 1 };
    }
    return no;
}

/** placeGrid: the grid rows (north first, west to east) around the centre for an item, '@' in the middle. */
export function placeGrid(blockAt: GridBlockAt, centre: Vec3Like, item: PlaceItem): string[] {
    const offs = gridOffsets(item);
    const cx = Math.floor(centre.x), cy = Math.floor(centre.y), cz = Math.floor(centre.z);
    return offs.map(dz => offs.map(dx => dx === 0 && dz === 0 ? '@' : columnCell(blockAt, cx + dx, cz + dz, cy).cell).join(''));
}
