// The chores setting and its saved state (bots/<name>/laya-chores.json; a typed port of the old bot's
// loadChoresState/saveChoresState in src/agent/laya/chores.js): {on, centreKind, chestItems, chestAt, stumps},
// today's format (JSON.stringify, no indent), now written atomically. stumps: where a felled tree's sapling still
// goes. The test harness's forgetAgent writes {"on":false}; that reads as off with nothing else saved. Nothing
// changes chores on/off yet (5.6).
import fs from 'fs';
import path from 'path';
import type { Vec3Like } from '../types/index.js';

export interface ChestItem { name: string; count: number }
export interface Stump extends Vec3Like { at?: number }
export interface ChoresState {
    on: boolean;
    /** What the chores centre was saved from (the old 'player' | 'self'), or null. */
    centreKind: string | null;
    /** What the home chest held when andy last looked in it. */
    chestItems: ChestItem[];
    chestAt: Vec3Like | null;
    stumps: Stump[];
}

/** loadChoresState: the saved state; on comes from settingOn when the file doesn't say (or there is none). */
export function loadChoresState(file: string, settingOn: boolean): ChoresState {
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        return {
            on: typeof j.on === 'boolean' ? j.on : !!settingOn,
            centreKind: typeof j.centreKind === 'string' && j.centreKind ? j.centreKind : null,
            chestItems: Array.isArray(j.chestItems) ? j.chestItems as ChestItem[] : [],
            chestAt: j.chestAt && typeof j.chestAt === 'object' ? j.chestAt as Vec3Like : null,
            stumps: Array.isArray(j.stumps) ? j.stumps as Stump[] : [],
        };
    } catch {
        return { on: !!settingOn, centreKind: null, chestItems: [], chestAt: null, stumps: [] };
    }
}

/** saveChoresState writes the state atomically; a failed save never stops the bot (onError is told). */
export function saveChoresState(file: string, st: Partial<ChoresState>, onError?: (e: unknown) => void): void {
    const tmp = `${file}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(st));
        fs.renameSync(tmp, file);
    } catch (e) {
        try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to clean */ }
        onError?.(e);
    }
}
