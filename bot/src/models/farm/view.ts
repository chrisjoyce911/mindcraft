// The farm view (a typed port of the old farm_state.js; laya-go games/farm/rules): the 9×9 cells around andy read
// from the world, what he carries and the adult animals near, cell names, the nearest cells and the pond checks. Pure.
//
// Cells, one character each (rows north to south, each west to east, andy in the middle):
//
//   G grass or dirt with water within 4 blocks   L the same with no water near
//   X path, stone, wood: walkable, not tillable  O fence or wall
//   W water   F empty wet farmland   D empty dry farmland
//   crops growing/ripe: wheat 1/2, carrot 3/4, potato 5/6, beetroot 7/8
import { ANIMAL_RANGE, C, CROP_INFO, FARM_ITEMS, KINDS, SIZE, type AnimalKind, type CellCode, type CropInfo, type FarmItem, type Inv } from './data.js';

/** A block as the view reads it (a mineflayer Block fits; null: not loaded). */
export interface FarmBlock { name: string; boundingBox?: string; metadata?: number; getProperties?: () => Record<string, unknown> }
export type FarmBlockAt = (x: number, y: number, z: number) => FarmBlock | null | undefined;

/** A grid position: column x, row z (0…SIZE−1). */
export interface GridPos { x: number; z: number }
export type Grid = CellCode[][];

export interface Carry { item: FarmItem; count: number }
export interface Herd { kind: AnimalKind; count: number }
/** An animal near andy (the world reads them; baby: about half an adult's height). */
export interface Animal { kind: string; x: number; z: number; baby?: boolean }

/** The situation the farm model is asked about (the old readFarm result). */
export interface FarmView {
    grid: Grid;
    /** The ground block's height for each cell (a crop's farmland). */
    ys: number[][];
    carry: Carry[];
    animals: Herd[];
}

const TILLABLE = new Set(['grass_block', 'dirt', 'dirt_path']);
const isFence = (n: string) => n.endsWith('_fence') || n.endsWith('_wall') || n.endsWith('_fence_gate');

/** cropOf returns the crop for a block, its age and whether it's ripe. */
export function cropOf(block: FarmBlock | null | undefined): { crop: CropInfo; age: number; ripe: boolean } | null {
    const crop = CROP_INFO.find(c => c.block === block?.name);
    if (!crop || !block) return null;
    const a = block.getProperties?.().age;
    const age = typeof a === 'number' ? a : (block.metadata ?? 0);
    return { crop, age, ripe: age >= crop.ripeAge };
}

/** waterNear: water within 4 blocks (Chebyshev) of the column, at the ground's level or one above (hydration). */
function waterNear(blockAt: FarmBlockAt, x: number, y: number, z: number): boolean {
    for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++)
            for (const yy of [y, y + 1])
                if (blockAt(x + dx, yy, z + dz)?.name === 'water') return true;
    return false;
}

/**
 * readCell reads one column: down from feetY + 1 to feetY − 3 for the first block that isn't an empty plant (grass,
 * flowers); y is the ground block's height (the crop's farmland for crops). Farmland found at feetY + 1 (andy stands
 * a block low, e.g. in water) shows the crop on it (5.3: the old read missed it, and andy "planted" there forever).
 */
export function readCell(blockAt: FarmBlockAt, x: number, z: number, feetY: number): { code: CellCode; y: number } {
    for (let y = feetY + 1; y >= feetY - 3; y--) {
        const b = blockAt(x, y, z);
        if (!b) return { code: 'X', y: feetY - 1 };
        const c = cropOf(b);
        if (c) return { code: c.ripe ? c.crop.ripe : c.crop.growing, y: y - 1 };
        if (b.name === 'water') return { code: 'W', y };
        if (isFence(b.name)) return { code: 'O', y };
        if (b.name === 'farmland') {
            // farmland at the top of the scan (level with andy's head): its crop is above the scan
            const top = y === feetY + 1 ? cropOf(blockAt(x, y + 1, z)) : null;
            if (top) return { code: top.ripe ? top.crop.ripe : top.crop.growing, y };
            return { code: waterNear(blockAt, x, y, z) ? 'F' : 'D', y };
        }
        if (TILLABLE.has(b.name)) return { code: waterNear(blockAt, x, y, z) ? 'G' : 'L', y };
        if (b.boundingBox === 'block') return { code: 'X', y };
    }
    return { code: 'X', y: feetY - 1 };
}

/** carried sums items into the prompt's items, in FARM_ITEMS order (any hoe counts as hoe). */
export function carried(items: readonly { name: string; count: number }[]): Carry[] {
    const counts: Partial<Record<FarmItem, number>> = {};
    for (const it of items) {
        const name = it.name.endsWith('_hoe') ? 'hoe' : it.name;
        if ((FARM_ITEMS as readonly string[]).includes(name)) counts[name as FarmItem] = (counts[name as FarmItem] || 0) + it.count;
    }
    return FARM_ITEMS.filter(n => (counts[n] ?? 0) > 0).map(n => ({ item: n, count: counts[n]! }));
}

/** herds counts adult animals within ANIMAL_RANGE of (bx, bz), in KINDS order. */
export function herds(animals: readonly Animal[], bx: number, bz: number): Herd[] {
    const counts: Partial<Record<AnimalKind, number>> = {};
    for (const a of animals) {
        if (!(KINDS as readonly string[]).includes(a.kind) || a.baby || Math.hypot(a.x - bx, a.z - bz) > ANIMAL_RANGE) continue;
        counts[a.kind as AnimalKind] = (counts[a.kind as AnimalKind] || 0) + 1;
    }
    return KINDS.filter(k => (counts[k] ?? 0) > 0).map(k => ({ kind: k, count: counts[k]! }));
}

/** readFarm reads the situation around andy at column (bx, bz) with feet at feetY. */
export function readFarm(blockAt: FarmBlockAt, bx: number, feetY: number, bz: number, items: readonly { name: string; count: number }[], animals: readonly Animal[]): FarmView {
    const grid: Grid = [], ys: number[][] = [];
    for (let z = 0; z < SIZE; z++) {
        const row: CellCode[] = [], yrow: number[] = [];
        for (let x = 0; x < SIZE; x++) {
            const cell = readCell(blockAt, bx + x - C, bz + z - C, feetY);
            row.push(cell.code);
            yrow.push(cell.y);
        }
        grid.push(row);
        ys.push(yrow);
    }
    if (grid[C]![C] === 'W' || grid[C]![C] === 'O') grid[C]![C] = 'X';
    return { grid, ys, carry: carried(items), animals: herds(animals, bx, bz) };
}

/** A cell's name: its offset from andy ("E2 N1", "W3 S0"). */
export type CellName = `${'E' | 'W'}${number} ${'N' | 'S'}${number}`;

export function cellName(x: number, z: number): CellName {
    const dx = x - C, dz = z - C;
    return `${dx < 0 ? `W${-dx}` as const : `E${dx}` as const} ${dz < 0 ? `N${-dz}` as const : `S${dz}` as const}`;
}

/** parseCellName reads a cell name back to its grid position, or null (not a name, or outside the view). */
export function parseCellName(name: string): GridPos | null {
    const m = /^([EW])(\d+) ([NS])(\d+)$/.exec(name);
    if (!m) return null;
    const x = C + (m[1] === 'W' ? -1 : 1) * Number(m[2]), z = C + (m[3] === 'N' ? -1 : 1) * Number(m[4]);
    return x >= 0 && z >= 0 && x < SIZE && z < SIZE ? { x, z } : null;
}

/** BY_DISTANCE: every cell nearest first, ties to the north, then the west (laya-go rules.ByDistance). */
export const BY_DISTANCE: readonly GridPos[] = (() => {
    const ps: GridPos[] = [];
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) ps.push({ x, z });
    const d = (p: GridPos) => (p.x - C) ** 2 + (p.z - C) ** 2;
    return ps.map((p, i) => [p, i] as const).sort((a, b) => d(a[0]) - d(b[0]) || a[1] - b[1]).map(([p]) => p);
})();

export const isRipe = (c: string): boolean => CROP_INFO.some(cr => cr.ripe === c);
export const isGrowing = (c: string): boolean => CROP_INFO.some(cr => cr.growing === c);
export const at = (g: Grid, p: GridPos): CellCode => g[p.z]![p.x]!;

/** nearest: the nearest cell whose code matches, or null. */
export function nearest(grid: Grid, match: (c: CellCode) => boolean): GridPos | null {
    return BY_DISTANCE.find(p => match(at(grid, p))) ?? null;
}

const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
const inView = (x: number, z: number) => x >= 0 && z >= 0 && x < SIZE && z < SIZE;

/**
 * nearestDry: where a pond goes (laya-go nearestDry, v2.1 rules): the nearest dry ground cell other than andy's own
 * with no X beside it (solid: a dug hole reads as one, and water poured beside it runs off), else the nearest dry
 * ground cell.
 */
export function nearestDry(grid: Grid): GridPos | null {
    const besideSolid = (p: GridPos) => SIDES.some(([dx, dz]) => inView(p.x + dx, p.z + dz) && grid[p.z + dz]![p.x + dx] === 'X');
    let first: GridPos | null = null;
    for (const p of BY_DISTANCE.slice(1)) {
        if (at(grid, p) !== 'L') continue;
        if (!besideSolid(p)) return p;
        first ??= p;
    }
    return first;
}

/** pondCell names the nearest dry ground cell other than andy's own (and not skipped), or null. */
export function pondCell(grid: Grid, skip: (name: CellName) => boolean = () => false): CellName | null {
    const p = BY_DISTANCE.slice(1).find(q => at(grid, q) === 'L' && !skip(cellName(q.x, q.z)));
    return p ? cellName(p.x, p.z) : null;
}

/** besideHole: water poured at a cell could run off: a side cell holds water or its ground is lower (a hole, a drop). */
export function besideHole(s: Pick<FarmView, 'grid'> & Partial<Pick<FarmView, 'ys'>>, cell: GridPos): boolean {
    for (const [dx, dz] of SIDES) {
        const x = cell.x + dx, z = cell.z + dz;
        if (!inView(x, z)) continue;
        if (s.grid[z]![x] === 'W') return true;
        if (s.ys && s.ys[z]![x]! < s.ys[cell.z]![cell.x]!) return true;
    }
    return false;
}

/** hasWater: the view has water or anything hydrated by it. */
export function hasWater(grid: Grid): boolean {
    return grid.some(r => r.some(c => c === 'W' || c === 'G' || c === 'F'));
}

/** growing: any crop in the view is still growing. */
export function growing(grid: Grid): boolean {
    return grid.some(r => r.some(isGrowing));
}

/** count: how many of a prompt item andy carries. */
export const countOf = (s: Pick<FarmView, 'carry'>, item: string): number => s.carry.find(c => c.item === item)?.count ?? 0;
export const has = (s: Pick<FarmView, 'carry'>, item: string): boolean => countOf(s, item) > 0;

/** produceOf: how many of a crop goal's produce an inventory holds. */
export function produceOf(inv: Inv, names: readonly string[]): number {
    return names.reduce((n, name) => n + (inv[name] || 0), 0);
}
