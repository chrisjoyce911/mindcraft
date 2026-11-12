// The chores centre (home) (a typed port of the old bot's src/agent/laya/chores_home.js chooseCentre, homeOnPlace's
// table/chest rules and chestToAdopt; spec "Home and base centre"). Pure: the caller passes what it sees. In order:
//   1. the home bed (home_bed: the bed he placed for himself, or last slept in)
//   2. the saved home (home_chest, or home_table when the home is a table)
//   3. a chest or table a player placed (the most recent) → saved as home
//   4. the nearest chest, barrel or table: with a saved chores_centre, only in its base area (21×21, ±16); else
//      within the 49×49 work area of andy and ±16 of him (6.2a: never one underground far away) → saved as home
//   5. a saved chores_centre (kept until a home exists; a lost table or bed home leaves its spot here, 6.2a)
//   6. the player who last spoke, within 32, on the surface → chores_centre
//   7. his own position → chores_centre
// 5.6 replaces 5.5's baseCentre stand-in: the place skill uses the same centre (baseCentre: the saved places alone).
import type { Vec3Like } from '../types/index.js';
import type { PlaceBook } from './places.js';
import { HOME_PLACE } from './chest.js';

export const WORK = 49;
export const BASE = 21;
export const BASE_HEIGHT = 16;
/** A player's position is the centre within this. */
export const PLAYER_REACH = 32;

export type CentreHome = 'bed' | 'chest' | 'table' | 'player' | 'self';
export type StationKind = 'chest' | 'table';
type P3 = readonly [number, number, number];

export interface Speaker { name: string; pos: Vec3Like; dist: number; overworld: boolean; onGround: boolean; inFluid: boolean; openSky: boolean }

export interface CentreSeen {
    homeBed: P3 | null;
    homeChest: P3 | null;
    homeTable: P3 | null;
    /** Chests and tables players placed, most recent last (still standing). */
    playerPlaced: readonly { kind: StationKind; pos: Vec3Like }[];
    /** Chests and tables around the saved centre (else andy) (only looked for when there is no home). */
    nearby: readonly { kind: StationKind; pos: Vec3Like }[];
    speaker: Speaker | null;
    /** The saved chores_centre and what it was saved from. */
    saved: { kind: 'player' | 'self'; pos: Vec3Like } | null;
    self: Vec3Like;
}

/** What the caller saves (and says): a place to remember. chores_centre saves its kind too. */
export interface CentreSave { place: 'home_chest' | 'home_table' | 'chores_centre'; pos: Vec3Like; kind?: 'player' | 'self'; say?: string }
export interface Centre { home: CentreHome; pos: Vec3Like; save?: CentreSave }

const at = (p: Vec3Like): Vec3Like => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const xyz = (a: P3): Vec3Like => ({ x: Math.floor(a[0]), y: Math.floor(a[1]), z: Math.floor(a[2]) });
const half = (n: number) => Math.floor(n / 2);
const inColumns = (c: Vec3Like, p: Vec3Like, size: number) =>
    Math.abs(Math.floor(p.x) - Math.floor(c.x)) <= half(size) && Math.abs(Math.floor(p.z) - Math.floor(c.z)) <= half(size);
export const inBaseArea = (c: Vec3Like, p: Vec3Like) => inColumns(c, p, BASE) && Math.abs(Math.floor(p.y) - Math.floor(c.y)) <= BASE_HEIGHT;
const d2 = (a: Vec3Like, b: Vec3Like) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const word = (k: StationKind) => (k === 'table' ? 'crafting table' : 'chest');
const placeOf = (k: StationKind) => (k === 'table' ? 'home_table' : 'home_chest') as 'home_table' | 'home_chest';

/** surfaceOk: the speaker's position can be the centre: overworld, on the ground, not in a fluid, open sky. */
export const surfaceOk = (s: Speaker): boolean => s.overworld && s.onGround && !s.inFluid && s.openSky;

/** chooseCentre picks the centre and says what to remember. */
export function chooseCentre(w: CentreSeen): Centre {
    if (w.homeBed) return { home: 'bed', pos: xyz(w.homeBed) };
    if (w.homeChest && !w.homeTable) return { home: 'chest', pos: xyz(w.homeChest) };
    if (w.homeTable) return { home: 'table', pos: xyz(w.homeTable) };
    const placed = w.playerPlaced.at(-1);
    if (placed) {
        const p = at(placed.pos);
        return { home: placed.kind, pos: p, save: { place: placeOf(placed.kind), pos: p, say: `I'll use your ${word(placed.kind)} at ${p.x} ${p.y} ${p.z} as home.` } };
    }
    const self = at(w.self);
    const from = w.saved ? at(w.saved.pos) : self;
    const inArea = (p: Vec3Like) => (w.saved ? inBaseArea(from, p) : inColumns(self, p, WORK) && Math.abs(Math.floor(p.y) - self.y) <= BASE_HEIGHT);
    const near = w.nearby.filter(b => inArea(b.pos)).sort((a, b) => d2(a.pos, from) - d2(b.pos, from))[0];
    if (near) {
        const p = at(near.pos);
        return { home: near.kind, pos: p, save: { place: placeOf(near.kind), pos: p, say: `I'll use the ${word(near.kind)} at ${p.x} ${p.y} ${p.z} as home.` } };
    }
    if (w.saved) return { home: w.saved.kind, pos: at(w.saved.pos) };
    const sp = w.speaker;
    if (sp && sp.dist <= PLAYER_REACH && surfaceOk(sp)) {
        const p = at(sp.pos);
        return { home: 'player', pos: p, save: { place: 'chores_centre', kind: 'player', pos: p } };
    }
    return { home: 'self', pos: self, save: { place: 'chores_centre', kind: 'self', pos: self } };
}

/**
 * chestToAdopt: with the home table or a (moved) home bed as the centre, a chest in the base area becomes the home
 * chest when the home chest isn't in the base area (nothing is moved out of the old one). Its position, or null.
 */
export function chestToAdopt(c: Centre, homeChest: P3 | null, chests: readonly Vec3Like[]): Vec3Like | null {
    if (c.home !== 'table' && c.home !== 'bed') return null;
    if (homeChest && inBaseArea(c.pos, xyz(homeChest))) return null;
    const best = chests.filter(p => inBaseArea(c.pos, p)).sort((a, b) => d2(a, c.pos) - d2(b, c.pos))[0];
    return best ? at(best) : null;
}

/** The saved places of the centre, in chooseCentre's order (the place skill reads these). */
export const CENTRE_PLACES = ['home_bed', HOME_PLACE, 'home_table', 'chores_centre'] as const;

/**
 * baseCentre: the centre from the saved places alone (home bed, home chest, home table, chores centre), else where
 * andy stands: chooseCentre without the looking around and saving, which the chores ask does before a place run.
 */
export function baseCentre(places: PlaceBook, me: Vec3Like): Vec3Like {
    const r = (n: string) => places.recall(n);
    const c = chooseCentre({
        homeBed: r('home_bed'), homeChest: r(HOME_PLACE), homeTable: r('home_table'), playerPlaced: [], nearby: [], speaker: null,
        saved: (() => { const s = r('chores_centre'); return s ? { kind: 'self' as const, pos: { x: s[0], y: s[1], z: s[2] } } : null; })(),
        self: me,
    });
    return c.pos;
}

/**
 * homeOnPlace: what a placed block changes (the old chores_home.js homeOnPlace). kind: chest, table or bed; by: me
 * or a player; mine: a bed andy placed for himself. Returns the places to remember (pos) or forget (pos null).
 *   - a bed he placed for himself, or any bed when the home bed is gone, becomes the home bed ("My home is now at …");
 *     his second bed is the player's (player_bed)
 *   - the first chest or table he places with no home becomes the home (the chores centre is dropped)
 *   - with a table home (or a bed home), the first chest placed in the base area becomes the home chest
 */
export function homeOnPlace(kind: StationKind | 'bed', pos: Vec3Like, by: 'me' | 'player',
    w: { homeBed: P3 | null; playerBed: P3 | null; homeChest: P3 | null; homeTable: P3 | null; centre: Vec3Like | null }): { place: string; pos: Vec3Like | null; say?: string }[] {
    const p = at(pos);
    if (kind === 'bed') {
        if (!w.homeBed) return [{ place: 'home_bed', pos: p, say: `My home is now at ${p.x} ${p.y} ${p.z}.` }];
        if (by === 'me' && !w.playerBed) return [{ place: 'player_bed', pos: p, say: `I put a bed for you at ${p.x} ${p.y} ${p.z}.` }];
        return [];
    }
    const noHome = !w.homeBed && !w.homeChest && !w.homeTable;
    if (noHome && by === 'me') return [{ place: placeOf(kind), pos: p }, { place: 'chores_centre', pos: null }];
    if (kind === 'chest' && w.centre && inBaseArea(w.centre, p) && !(w.homeChest && inBaseArea(w.centre, xyz(w.homeChest)))) return [{ place: HOME_PLACE, pos: p }];
    return [];
}
