// The mine's world geometry (the pure helpers of the old bot's src/agent/laya/mine.js): which ore is safe and near
// enough to collect, fluid near a cell, cover above ore, open sky, the drop under a cell, ore veins, where a move
// leaves andy and what it digs, what goes into the home chest, whether torches can be made, and the pick-up of a
// dug ore's drop. Pure: blockAt is passed in.
import type { Vec3Like } from '../../types/index.js';
import { DY, OFFSET, SEEN_RANGE, THROWAWAY, type Dir, type Inv } from './data.js';
import { FEET, type View, type ViewCell } from './view.js';
import type { Move } from './view.js';

// The floor under andy (the old mine.js dropBelow and floorDrop; actuators/floor.ts re-exports them): never dig the
// block andy stands on when there is a drop of more than MAX_SAFE_DROP under it.
export const MAX_SAFE_DROP = 3;
export type BoxAt = (x: number, y: number, z: number) => { boundingBox?: string } | null;

/**
 * dropBelow counts the air under a cell (x, y, z) andy would stand in: from its floor down, or, when the floor is
 * one block thick, from under that floor (a thin floor over a cave). Unloaded blocks count as solid.
 */
export function dropBelow(blockAt: BoxAt, x: number, y: number, z: number, max = 8): number {
    const empty = (yy: number) => { const b = blockAt(x, yy, z); return !!b && b.boundingBox === 'empty'; };
    const start = empty(y - 1) ? y - 1 : y - 2;
    let n = 0;
    while (n < max && empty(start - n)) n++;
    return n;
}

/** floorDrop: digging o (the block under andy's feet) would drop andy more than maxDrop blocks. */
export function floorDrop(blockAt: BoxAt, feet: Vec3Like | null, o: Vec3Like | null, maxDrop = MAX_SAFE_DROP): boolean {
    if (!feet || !o) return false;
    const f = { x: Math.floor(feet.x), y: Math.floor(feet.y), z: Math.floor(feet.z) };
    if (o.x !== f.x || o.z !== f.z || o.y !== f.y - 1) return false;
    return dropBelow(blockAt, o.x, o.y, o.z, maxDrop + 1) > maxDrop;
}

/** A block as these helpers read it (a mineflayer Block fits). */
export interface GeoBlock { name: string; boundingBox?: string; getProperties?: () => Record<string, unknown> }
export type GeoBlockAt = (x: number, y: number, z: number) => GeoBlock | null;

/** FLUIDS are the blocks that hold water or lava. */
const FLUIDS = new Set(['water', 'lava', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
const isFluid = (b: GeoBlock | null) => !!b && (FLUIDS.has(b.name) || b.getProperties?.().waterlogged === true);
const SIDES = [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const;
const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** fluidNear: a cell or a cell touching it holds water or lava. */
export function fluidNear(blockAt: GeoBlockAt, x: number, y: number, z: number): boolean {
    return SIDES.some(([dx, dy, dz]) => isFluid(blockAt(x + dx, y + dy, z + dz)));
}

/**
 * oreSafe: ore can be collected from feet without going near water or lava: none touching the ore, and none
 * touching the straight line there at feet or head height.
 */
export function oreSafe(blockAt: GeoBlockAt, feet: Vec3Like, ore: Vec3Like): boolean {
    if (fluidNear(blockAt, ore.x, ore.y, ore.z)) return false;
    const n = Math.ceil(dist(feet, ore) * 2);
    for (let i = 1; i < n; i++) {
        const t = i / n;
        const x = Math.floor(feet.x + 0.5 + (ore.x - feet.x) * t), z = Math.floor(feet.z + 0.5 + (ore.z - feet.z) * t);
        const y = Math.floor(feet.y + (ore.y - feet.y) * t);
        if (fluidNear(blockAt, x, y, z) || fluidNear(blockAt, x, y + 1, z)) return false;
    }
    return true;
}

/** exposed: a block with air beside it (ore on a cave or pocket wall). */
export function exposed(blockAt: GeoBlockAt, o: Vec3Like): boolean {
    return SIDES.slice(1).some(([dx, dy, dz]) => blockAt(o.x + dx, o.y + dy, o.z + dz)?.boundingBox === 'empty');
}

/** coverAbove counts the solid blocks over o up to the first air (at most max): how deep ore lies under the ground. */
export function coverAbove(blockAt: GeoBlockAt, o: Vec3Like, max = 9): number {
    let n = 0;
    while (n < max) {
        const b = blockAt(o.x, o.y + 1 + n, o.z);
        if (b && b.boundingBox === 'empty') return n;
        n++;
    }
    return n;
}

/** openSky: nothing solid above feet (up to height blocks): the mine starts at the surface. */
export function openSky(blockAt: GeoBlockAt, f: Vec3Like, height = 64): boolean {
    for (let dy = 2; dy <= height; dy++) {
        const b = blockAt(f.x, f.y + dy, f.z);
        if (b && b.boundingBox !== 'empty') return false;
    }
    return true;
}

export interface PickOreOptions {
    feet: Vec3Like;
    /** The plan cell (v2), or andy (v1). */
    anchor: Vec3Like;
    /** The mine cells: the plan cell and the cells dug so far, the entrance first (null: the anchor alone). */
    anchors?: readonly Vec3Like[] | null;
    range: number;
    /** The off-plan budget left. */
    budget: number;
    blockAt: GeoBlockAt;
    below?: number;
    belowOpen?: number;
    skip?: (o: Vec3Like) => boolean;
}

/**
 * pickOre chooses the ore to collect from ores (nearest first): the nearest within sight of feet, not skipped,
 * within the off-plan budget left, and safe, that is within range of a mine cell and at most below blocks under
 * that cell (belowOpen for ore open to the air, in a cave or pocket beside the stair; or surface ore under at most
 * below blocks of cover). It returns it or null.
 */
export function pickOre(ores: readonly Vec3Like[], { feet, anchor, anchors = null, range, budget, blockAt, below = Infinity, belowOpen = below, skip = () => false }: PickOreOptions): Vec3Like | null {
    const cells = anchors?.length ? anchors : [anchor];
    // under at most `below` blocks of cover (surface ore on a hillside): reachable by digging down to it
    const shallow = (o: Vec3Like) => {
        const n = coverAbove(blockAt, o, below + 1);
        return n <= below && openSky(blockAt, { x: o.x, y: o.y + n - 1, z: o.z }); // sky over the cover, not a cave roof
    };
    const fromMine = (o: Vec3Like) => cells.some(a => {
        if (dist(a, o) > range) return false;
        const depth = a.y - o.y;
        return depth <= below || (depth <= belowOpen && exposed(blockAt, o)) || shallow(o);
    });
    for (const o of ores) {
        const d = dist(feet, o);
        if (d > SEEN_RANGE || d > budget || skip(o) || !fromMine(o)) continue;
        if (oreSafe(blockAt, feet, o)) return o;
    }
    return null;
}

/** headingToward: the heading from feet towards o along its longer horizontal axis, or null when (nearly) straight below/above. */
export function headingToward(feet: Vec3Like, o: Vec3Like): Dir | null {
    const dx = o.x - feet.x, dz = o.z - feet.z;
    if (Math.max(Math.abs(dx), Math.abs(dz)) < 2) return null;
    return Math.abs(dx) >= Math.abs(dz) ? (dx > 0 ? 'E' : 'W') : (dz > 0 ? 'S' : 'N');
}

/** hollowUnder: the air under o (or under a one-block floor below it) is deeper than maxDrop: nobody stands on o while it is dug. */
export function hollowUnder(blockAt: BoxAt, o: Vec3Like, maxDrop = MAX_SAFE_DROP): boolean {
    return dropBelow(blockAt, o.x, o.y, o.z, maxDrop + 1) > maxDrop;
}

/**
 * veinOf: the ore blocks connected to start (faces and edges, 18 neighbours) whose name is one of names, start
 * first, at most max, within range of start.
 */
export function veinOf(blockAt: (x: number, y: number, z: number) => { name: string } | null, start: Vec3Like, names: readonly string[],
    { max = 16, range = 6 }: { max?: number; range?: number } = {}): Vec3Like[] {
    const key = (p: Vec3Like) => `${p.x},${p.y},${p.z}`;
    const want = new Set(names);
    const out: Vec3Like[] = [], seen = new Set([key(start)]), queue: Vec3Like[] = [start];
    while (queue.length && out.length < max) {
        const p = queue.shift()!;
        const name = blockAt(p.x, p.y, p.z)?.name;
        if (!name || !want.has(name)) continue;
        out.push(p);
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
            const s = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            if (s === 0 || s === 3) continue;
            const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
            if (seen.has(key(q)) || Math.max(Math.abs(q.x - start.x), Math.abs(q.y - start.y), Math.abs(q.z - start.z)) > range) continue;
            seen.add(key(q));
            queue.push(q);
        }
    }
    return out;
}

/** moveFeet: where a move leaves andy's feet. */
export function moveFeet(m: Move, bx: number, by: number, bz: number): Vec3Like {
    const [dx, dz] = OFFSET[m.dir];
    return { x: bx + dx, y: by + DY[m.kind], z: bz + dz };
}

/** worldCell turns a view cell into world coordinates. */
export const worldCell = (bx: number, by: number, bz: number, [l, dx, dz]: ViewCell): Vec3Like => ({ x: bx + dx, y: by + FEET - l, z: bz + dz });

/** cellsToDig: a move's cells that hold something to dig, the cell andy steps into, and its direction. */
export function cellsToDig(view: View, m: Move): { dig: ViewCell[]; target: ViewCell; dir: Dir } {
    const [dx, dz] = OFFSET[m.dir];
    const cells: Record<Move['kind'], ViewCell[]> = {
        tunnel: [[1, dx, dz], [2, dx, dz]],
        down: [[1, dx, dz], [2, dx, dz], [3, dx, dz]],
        up: [[0, 0, 0], [1, dx, dz], [0, dx, dz]],
    };
    const target: Record<Move['kind'], ViewCell> = { tunnel: [2, dx, dz], down: [3, dx, dz], up: [1, dx, dz] };
    return { dig: cells[m.kind].filter(([l, x, z]) => view[l]![2 + z]![2 + x] !== 'A'), target: target[m.kind], dir: m.dir };
}

const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel)$/;
export interface Stack { name: string; count: number }

/** depositList: what goes into the home chest: everything except tools, food, torches and up to keep throwaway blocks. */
export function depositList(inv: Inv, isFood: (name: string) => boolean = () => false, keep = 32): Stack[] {
    const out: Stack[] = [];
    let left = keep;
    for (const n of THROWAWAY) {
        const c = inv[n] || 0;
        const k = Math.min(c, left);
        left -= k;
        if (c > k) out.push({ name: n, count: c - k });
    }
    for (const [name, count] of Object.entries(inv)) {
        if (!count || (THROWAWAY as readonly string[]).includes(name) || name === 'torch' || TOOL.test(name) || isFood(name)) continue;
        out.push({ name, count });
    }
    return out;
}

/** canMakeTorches: coal or charcoal and sticks, or wood to make sticks from. */
export function canMakeTorches(inv: Inv): boolean {
    const fuel = (inv.coal || 0) + (inv.charcoal || 0);
    const wood = Object.entries(inv).some(([n, c]) => c > 0 && (n === 'stick' || /_(planks|log|wood|stem|hyphae)$/.test(n)));
    return fuel > 0 && wood;
}

export interface PickUpDrop<I> {
    /** How many of the drop andy carries. */
    count(): number;
    /** The count before digging. */
    before: number;
    /** A dropped item near the ore, or null. */
    findItem(): I | null;
    /** Walks onto the item. */
    fetch(item: I): Promise<unknown>;
    /** Waits; false: stop (aborted). */
    sleep(ms: number): Promise<unknown>;
    tries?: number;
    wait?: number;
}

/** pickUpDrop makes sure a dug ore's drop reached the pack: waits, fetches up to tries times; whether the count went up. */
export async function pickUpDrop<I>({ count, before, findItem, fetch, sleep, tries = 3, wait = 250 }: PickUpDrop<I>): Promise<boolean> {
    for (let i = 0; i <= tries; i++) {
        if (count() > before) return true;
        if ((await sleep(wait)) === false) break;
        if (count() > before) return true;
        if (i === tries) break;
        const item = findItem();
        if (item) await fetch(item).catch(() => {});
    }
    return count() > before;
}
