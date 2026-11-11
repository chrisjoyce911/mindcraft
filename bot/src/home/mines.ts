// Mine memory (bots/<name>/laya-mines.json; a typed port of the old bot's src/agent/laya/mine_memory.js and the
// file I/O in skills.js): each mine a mine job lays out is saved, so a new mine job near a saved mine goes on with
// it. The file is the list, newest first, as JSON.stringify(list, null, 1) (today's format), now written
// atomically. Nothing uses it until 5.2.
import fs from 'fs';
import path from 'path';
import type { Vec3Like } from '../types/index.js';

export const REUSE_RANGE = 16;
export const MAX_MINES = 32;

export interface MineRecord {
    entrance: Vec3Like;
    /** The staircase's heading (N, E, S, W). */
    heading: string;
    /** Whether it started at the surface. */
    surface?: boolean;
    /** The ores mined there. */
    ores?: string[];
    /** The deepest level reached. */
    deepest?: number;
    /** Where andy last was in it. */
    last?: Vec3Like | null;
    started?: number;
    updated?: number;
}

const flat = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.z - b.z);
const key = (e: Vec3Like): string => `${e.x},${e.y},${e.z}`;

/** nearestMine: the saved mine nearest to feet within range (to its entrance or where andy last was), or null. */
export function nearestMine(mines: readonly MineRecord[] | null | undefined, feet: Vec3Like, range = REUSE_RANGE): MineRecord | null {
    let best: MineRecord | null = null, bestD = Infinity;
    for (const m of mines ?? []) {
        if (!m?.entrance) continue;
        const d = Math.min(flat(m.entrance, feet), m.last ? flat(m.last, feet) : Infinity);
        if (d <= range && d < bestD) { best = m; bestD = d; }
    }
    return best;
}

/** upsertMine: the list with rec in it (matched by its entrance), newest first, at most MAX_MINES. */
export function upsertMine(mines: readonly MineRecord[] | null | undefined, rec: MineRecord): MineRecord[] {
    const rest = (mines ?? []).filter(m => m?.entrance && key(m.entrance) !== key(rec.entrance));
    return [rec, ...rest].slice(0, MAX_MINES);
}

/** The mine memory over a load/save pair; never throws (memory is a nicety). */
export interface MineBook {
    find(feet: Vec3Like): MineRecord | null;
    save(rec: MineRecord): void;
    /** forget drops a mine that isn't there any more (a new world, filled in). */
    forget(entrance: Vec3Like): void;
}

export function mineBook(io: { load(): unknown; save(list: MineRecord[]): void }, range = REUSE_RANGE): MineBook {
    const read = (): MineRecord[] => { try { const v = io.load(); return Array.isArray(v) ? v as MineRecord[] : []; } catch { return []; } };
    return {
        find: feet => nearestMine(read(), feet, range),
        save: rec => { try { io.save(upsertMine(read(), rec)); } catch { /* nicety */ } },
        forget: entrance => { try { io.save(read().filter(m => m?.entrance && key(m.entrance) !== key(entrance))); } catch { /* nicety */ } },
    };
}

/** mineStore: the mine memory in a file (today's laya-mines.json format), written atomically. */
export function mineStore(file: string, range = REUSE_RANGE): MineBook {
    return mineBook({
        load: () => JSON.parse(fs.readFileSync(file, 'utf8')),
        save: list => {
            const tmp = `${file}.${process.pid}.tmp`;
            try {
                fs.mkdirSync(path.dirname(file), { recursive: true });
                fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
                fs.renameSync(tmp, file);
            } catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing */ } throw e; }
        },
    }, range);
}
