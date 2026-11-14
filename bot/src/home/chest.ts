// The home chest (a typed port of the old bot's src/agent/laya/home_chest.js): the remembered place
// "home_chest" (the chest block's exact position) that the jobs unload into. Pure (no mineflayer).
//
// Three ways to set it: !setHomeChest (the chest nearest the player who spoke), the command model's "home"
// command (which runs the same job), and a sign within SIGN_RANGE whose text has the bot's name, on or next
// to a chest, adopted when no home chest is saved yet (wired by the farm and mine jobs, 5.x).
import type { Vec3Like } from '../types/index.js';

export const CHESTS = ['chest', 'trapped_chest', 'barrel'] as const;
export const HOME_PLACE = 'home_chest';
/** !setHomeChest also forgets these: a player's home replaces a table home and the chores centre. */
export const HOME_REPLACES = ['home_table', 'chores_centre'] as const;
export const SET_RANGE = 8;
export const SIGN_RANGE = 32;
export type HomeState = 'ok' | 'gone' | 'unknown';

export interface NamedBlock { name: string }
export type NamedBlockAt = (x: number, y: number, z: number) => NamedBlock | null;

export const isChest = (b: NamedBlock | null | undefined): boolean => !!b && (CHESTS as readonly string[]).includes(b.name);
export const isSign = (b: NamedBlock | null | undefined): boolean => !!b && /_(wall_|hanging_|wall_hanging_)?sign$/.test(b.name);

const dist2 = (a: Vec3Like, b: Vec3Like) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

/** isHomeName: a place name meaning the home chest ("home_chest", "Home Chest"). */
export const isHomeName = (name: string | null | undefined): boolean => /^home[\s_-]*chest$/i.test(String(name ?? '').trim());

/** homeState: 'ok' (a chest is at the saved place), 'gone' (loaded and not a chest) or 'unknown' (not loaded, none saved). */
export function homeState(place: readonly [number, number, number] | null | undefined, blockAt: NamedBlockAt): HomeState {
    if (!place) return 'unknown';
    const b = blockAt(Math.floor(place[0]), Math.floor(place[1]), Math.floor(place[2]));
    if (!b) return 'unknown';
    return isChest(b) ? 'ok' : 'gone';
}

/** nearestChest: the chest position nearest `at` within range, or null. */
export function nearestChest(chests: readonly Vec3Like[], at: Vec3Like, range: number = SET_RANGE): Vec3Like | null {
    let best: Vec3Like | null = null;
    for (const c of chests) if (dist2(c, at) <= range * range && (!best || dist2(c, at) < dist2(best, at))) best = c;
    return best ? { x: best.x, y: best.y, z: best.z } : null;
}

/** A sign block as signText reads it (a mineflayer Block fits). */
export interface SignBlock { getSignText?: () => unknown; signText?: string }

/** signText joins a sign's lines (front and back) into one string. */
export function signText(block: SignBlock): string {
    try {
        const t = block.getSignText?.();
        if (Array.isArray(t)) return t.join('\n');
        if (typeof t === 'string') return t;
    } catch { /* not a sign entity */ }
    return block.signText ?? '';
}

export interface Sign extends Vec3Like { text: string }

/**
 * signedChest: the chest marked with the bot's name: a sign whose text has the name (any case) with a chest
 * within 1 block (any of the 26 neighbours; one straight next to it wins). Nearest sign to `from` first.
 */
export function signedChest(signs: readonly Sign[], blockAt: NamedBlockAt, name: string, from: Vec3Like | null = null): Vec3Like | null {
    const want = name.toLowerCase();
    const ordered = from ? [...signs].sort((a, b) => dist2(a, from) - dist2(b, from)) : signs;
    for (const s of ordered) {
        if (!String(s.text ?? '').toLowerCase().includes(want)) continue;
        let best: (Vec3Like & { d: number }) | null = null;
        for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy && !dz) continue;
            const p = { x: s.x + dx, y: s.y + dy, z: s.z + dz };
            const d = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
            if (isChest(blockAt(p.x, p.y, p.z)) && (!best || d < best.d)) best = { ...p, d };
        }
        if (best) return { x: best.x, y: best.y, z: best.z };
    }
    return null;
}

/** chestsAt: the home chest and the chests touching it, home first (where unloading tries when it is full). */
export function chestsAt(home: Vec3Like | null, blockAt: NamedBlockAt): Vec3Like[] {
    if (!home || !isChest(blockAt(home.x, home.y, home.z))) return [];
    const out: Vec3Like[] = [{ x: home.x, y: home.y, z: home.z }];
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as const) {
        const p = { x: home.x + dx, y: home.y + dy, z: home.z + dz };
        if (isChest(blockAt(p.x, p.y, p.z))) out.push(p);
    }
    return out;
}

export interface Stack { name: string; count: number }

/**
 * depositAll puts items into the chests in order, trying the next when one is full or won't open.
 * depositInto(chest, items) returns what it couldn't put in, or throws. Returns what is left.
 */
export async function depositAll(chests: readonly Vec3Like[], items: readonly Stack[],
    depositInto: (chest: Vec3Like, items: Stack[]) => Promise<Stack[]>): Promise<Stack[]> {
    let left = items.filter(i => i.count > 0);
    for (const c of chests) {
        if (!left.length) break;
        try {
            left = (await depositInto(c, left)).filter(i => i.count > 0);
        } catch { /* this chest won't open: try the next */ }
    }
    return left;
}
