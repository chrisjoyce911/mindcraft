// The chores setting and its saved state (bots/<name>/laya-chores.json; a typed port of the old bot's
// loadChoresState/saveChoresState in src/agent/laya/chores.js): {on, centreKind, chestItems, chestAt, stumps},
// today's format (JSON.stringify, no indent), now written atomically. stumps: where a felled tree's sapling still
// goes. The test harness's forgetAgent writes {"on":false,"by":"test-harness"} (6.2b): a harness launch
// (ANDY_TEST_HARNESS=1) reads it as off and keeps the mark on every save; any other start (play, the normal start)
// ignores the harness's word and takes on from settings.chores (on unless the user's settings say false). A file a
// player wrote ("take a break", no mark) is kept as it says.
import fs from 'fs';
import path from 'path';
import type { Vec3Like } from '../types/index.js';

/** Who wrote the file's on: the test harness (only a harness launch heeds it). */
export const HARNESS_MARK = 'test-harness';
export type ChoresBy = typeof HARNESS_MARK;

/** choresSettingOn: settings.chores as the start's default: on unless the user's settings say false (6.2b). */
export function choresSettingOn(settings: object): boolean { return (settings as { chores?: unknown }).chores !== false; }

export interface LoadChoresOptions { /** This start is the test harness's launch (ANDY_TEST_HARNESS=1). */ harness?: boolean }

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
    /** Set only on a harness launch: every save keeps the harness's mark. */
    by?: ChoresBy;
}

/**
 * loadChoresState: the saved state; on comes from settingOn when the file doesn't say (or there is none), or when
 * the test harness wrote it and this isn't a harness launch.
 */
export function loadChoresState(file: string, settingOn: boolean, opts: LoadChoresOptions = {}): ChoresState {
    const mark: { by?: ChoresBy } = opts.harness ? { by: HARNESS_MARK } : {};
    try {
        const j = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
        const harnessWrote = j.by === HARNESS_MARK;
        return {
            on: typeof j.on === 'boolean' && (opts.harness || !harnessWrote) ? j.on : !!settingOn,
            centreKind: typeof j.centreKind === 'string' && j.centreKind ? j.centreKind : null,
            chestItems: Array.isArray(j.chestItems) ? j.chestItems as ChestItem[] : [],
            chestAt: j.chestAt && typeof j.chestAt === 'object' ? j.chestAt as Vec3Like : null,
            stumps: Array.isArray(j.stumps) ? j.stumps as Stump[] : [],
            ...mark,
        };
    } catch {
        return { on: !!settingOn, centreKind: null, chestItems: [], chestAt: null, stumps: [], ...mark };
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
