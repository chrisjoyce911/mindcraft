// The mine view (a typed port of the old mine_state.js; laya-go games/mine/rules): the 5×5×5 blocks around andy,
// five layers from just above his head (y+2) to under his floor (y−2), each 5×5 with north up; andy is the centre
// of the head and feet layers. Cells: S solid, A air, W water, L lava, O target ore, B bedrock. Also which moves
// are unsafe (the veto), which cells touch fluid and the Hazard truth. Pure.
import { OFFSET, type Dir, type MoveKind } from './data.js';

export const SIZE = 5;
const C = 2;
export const ABOVE = 0, HEAD = 1, FEET = 2, FLOOR = 3, BELOW = 4;
export type Layer = 0 | 1 | 2 | 3 | 4;

export type Cell = 'S' | 'A' | 'W' | 'L' | 'O' | 'B';
/** view[layer][z][x], z and x from −2 to 2 (index + 2). */
export type View = Cell[][][];
/** A view cell: [layer, dx, dz]. */
export type ViewCell = readonly [number, number, number];

/** A block as the view reads it (a mineflayer Block fits; null: not loaded). */
export interface ViewBlock { name: string; boundingBox?: string }
export type BlockAt = (x: number, y: number, z: number) => ViewBlock | null;

const WATER_BLOCKS = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
const HARD_BLOCKS = new Set(['bedrock', 'barrier', 'obsidian', 'crying_obsidian', 'reinforced_deepslate', 'end_portal_frame']);

/** cellOf classifies a block (null when not loaded) for an ore's blocks. */
export function cellOf(block: ViewBlock | null | undefined, oreBlocks: readonly string[]): Cell {
    if (!block) return 'S';
    if (block.name === 'lava') return 'L';
    if (WATER_BLOCKS.has(block.name)) return 'W';
    if (oreBlocks.includes(block.name)) return 'O';
    if (HARD_BLOCKS.has(block.name)) return 'B';
    if (block.boundingBox === 'empty') return 'A';
    return 'S';
}

/** readView reads the view around feet (bx, by, bz). */
export function readView(blockAt: BlockAt, bx: number, by: number, bz: number, oreBlocks: readonly string[]): View {
    const view: View = [];
    for (let l = 0; l < SIZE; l++) {
        const layer: Cell[][] = [];
        for (let dz = -C; dz <= C; dz++) {
            const row: Cell[] = [];
            for (let dx = -C; dx <= C; dx++) row.push(cellOf(blockAt(bx + dx, by + FEET - l, bz + dz), oreBlocks));
            layer.push(row);
        }
        view.push(layer);
    }
    return view;
}

/** at returns the cell at layer l, offset (dx, dz), or S outside the view. */
export function at(view: View, l: number, dx: number, dz: number): Cell {
    if (l < 0 || l >= SIZE || dx < -C || dx > C || dz < -C || dz > C) return 'S';
    return view[l]![C + dz]![C + dx]!;
}

/** setCell sets a cell inside the view (a copy is the caller's). */
export function setCell(view: View, [l, dx, dz]: ViewCell, c: Cell): void {
    view[l]![C + dz]![C + dx] = c;
}

export const copyView = (view: View): View => view.map(l => l.map(r => r.slice()));

const fluid = (c: Cell) => c === 'W' || c === 'L';
const firm = (c: Cell) => c === 'S' || c === 'O' || c === 'B';

/** A move step: its kind and direction. */
export interface Move { kind: MoveKind; dir: Dir }

/** dug returns the cells a move digs and its new floor. */
export function dug(m: Move): { cells: ViewCell[]; floor: ViewCell } {
    const [dx, dz] = OFFSET[m.dir];
    switch (m.kind) {
        case 'tunnel': return { cells: [[HEAD, dx, dz], [FEET, dx, dz]], floor: [FLOOR, dx, dz] };
        case 'down': return { cells: [[HEAD, dx, dz], [FEET, dx, dz], [FLOOR, dx, dz]], floor: [BELOW, dx, dz] };
        case 'up': return { cells: [[ABOVE, 0, 0], [HEAD, dx, dz], [ABOVE, dx, dz]], floor: [FEET, dx, dz] };
    }
}

export type Unsafe = '' | 'fluid' | 'bedrock' | 'fluid behind' | 'no floor';

/** unsafe returns why a move is unsafe in a view (laya-go rules.Unsafe), or '' when it is safe. */
export function unsafe(view: View, m: Move | null): Unsafe {
    if (!m) return '';
    const d = dug(m);
    const key = (c: ViewCell) => c.join(',');
    const inside = new Set([...d.cells.map(key), key([HEAD, 0, 0]), key([FEET, 0, 0])]);
    for (const [l, dx, dz] of d.cells) {
        const c = at(view, l, dx, dz);
        if (fluid(c)) return 'fluid';
        if (c === 'B') return 'bedrock';
        const around: ViewCell[] = [[l - 1, dx, dz], [l + 1, dx, dz], [l, dx + 1, dz], [l, dx - 1, dz], [l, dx, dz + 1], [l, dx, dz - 1]];
        for (const n of around) if (!inside.has(key(n)) && fluid(at(view, ...n))) return 'fluid behind';
    }
    if (!firm(at(view, ...d.floor))) return 'no floor';
    return '';
}

/** TOUCHING: the cells fluid could flow into andy from, in laya-go's order. */
export const TOUCHING: readonly ViewCell[] = [[ABOVE, 0, 0], [FLOOR, 0, 0],
    ...[HEAD, FEET].flatMap(l => (['N', 'E', 'S', 'W'] as const).map(d => [l, ...OFFSET[d]] as const))];

/** touching returns the touching cells holding lava or water. */
export function touching(view: View): ViewCell[] {
    return TOUCHING.filter(c => fluid(at(view, ...c)));
}

/** hazard is laya-go's Hazard truth: fluid within one block of feet or head. */
export function hazard(view: View): boolean {
    for (let l = ABOVE; l <= FLOOR; l++)
        for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++)
                if (fluid(at(view, l, dx, dz))) return true;
    return false;
}
