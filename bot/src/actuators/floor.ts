// The floor under andy (the old mine.js dropBelow and floorDrop): never dig the block andy stands on when there
// is a drop of more than MAX_SAFE_DROP under it (a cave under a stone or ore floor). Pure.
import type { Vec3Like } from '../types/index.js';

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
