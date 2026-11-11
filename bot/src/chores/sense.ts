// Chores sensing on the live bot (skills-spec v1 §1 "State"; the old chores_actions.js sense, centreOf, litBase,
// farmFacts, animalsNear, groundSaplings): the centre (home/centre chooseCentre, saving what it says and adopting a
// base chest), then every line of the state, through the pure sensors (sensors/chores.ts). It reads and remembers
// places; it never moves andy.
import type { Vec3Like } from '../types/index.js';
import { CHORE_ANIMALS, CHORES_MAX, type ChoreSearch, type Home, type LastRun } from '../types/chores.js';
import type { Act, ActEntity } from '../actuators/bot.js';
import type { PlaceBook } from '../home/places.js';
import type { ChoresState } from '../home/chores.js';
import type { MineBook } from '../home/mines.js';
import { CHESTS, HOME_PLACE, isChest } from '../home/chest.js';
import { chestToAdopt, chooseCentre, type Centre, type Speaker, type StationKind } from '../home/centre.js';
import { kitReserved, unreserved } from '../home/kit.js';
import {
    BASE, BASE_HEIGHT, WORK, bestTiers, biomeWord, farmOf, haveCounts, inBase, inColumns, isSapling, kitLine, litOf, madeCounts, reachOf,
    searchOf, timeWord,
} from '../sensors/chores.js';
import { isLog } from '../sensors/skills.js';
import { STONES, surfaceStone } from '../jobs/chores.js';
import type { ChoresSituation } from '../models/chores/index.js';

export const TABLES = ['crafting_table'] as const;
export const FURNACES = ['furnace', 'smoker', 'blast_furnace'] as const;
export const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroots'] as const;
export const GRASS = ['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern'] as const;
export const COAL_ORES = ['coal_ore', 'deepslate_coal_ore'] as const;
export const IRON_ORES = ['iron_ore', 'deepslate_iron_ore'] as const;
/** How many of each thing the Near searches look at (nearest the centre first). */
export const NEAR_COUNT = 24;
/** A block a player placed counts as theirs within this of them. */
export const PLACED_NEAR = 5;

export interface SenseDeps {
    places: PlaceBook;
    /** The saved chores state (chestItems, centreKind); save() writes it. */
    state(): ChoresState;
    save(): void;
    /** Says something in game (the centre's "I'll use your chest …"). */
    say(text: string): void;
    /** The player who last spoke to andy, or null. */
    speaker(): string | null;
    /** Chests and tables players placed since the centre was last saved, most recent last. */
    placed(): { kind: StationKind; pos: Vec3Like }[];
    clearPlaced(): void;
    mines?: MineBook;
    canPlace: boolean;
    canSmelt: boolean;
}

const floorV = (p: Vec3Like): Vec3Like => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const p3 = (p: readonly [number, number, number] | null) => (p ? floorV({ x: p[0], y: p[1], z: p[2] }) : null);

/** placedBy: who placed a block that just appeared at pos: the nearest player within 5 when andy isn't nearer. */
export function placedBy(pos: Vec3Like, players: readonly { name: string; pos: Vec3Like }[], me: Vec3Like | null): string | null {
    const d = (p: Vec3Like) => Math.hypot(p.x - pos.x - 0.5, p.y - pos.y, p.z - pos.z - 0.5);
    let best: { name: string; pos: Vec3Like } | null = null;
    for (const p of players) if (d(p.pos) <= PLACED_NEAR && (!best || d(p.pos) < d(best.pos))) best = p;
    if (!best || (me && d(me) < d(best.pos))) return null;
    return best.name;
}

/** findIn: blocks named one of names within size×size columns of the centre (±dy when given), nearest the centre first. */
function findIn(a: Act, names: readonly string[], c: Vec3Like, size: number, n: number, dy: number | null = null, keep?: (p: Vec3Like) => boolean): Vec3Like[] {
    let found: Vec3Like[] = [];
    try { found = a.bot.findBlocks(names, c, reachOf(size), keep ? n * 4 : n); } catch { return []; }
    return found.filter(p => inColumns(c, p, size) && (dy === null || Math.abs(p.y - Math.floor(c.y)) <= dy) && (!keep || keep(p))).slice(0, n);
}

/** homeFacts: the saved home places still standing (a gone bed or table is forgotten; an unloaded one kept). */
function homeFacts(a: Act, places: PlaceBook) {
    const check = (name: string, ok: (block: string) => boolean) => {
        const h = places.recall(name);
        if (!h) return null;
        const b = a.bot.blockAt(Math.floor(h[0]), Math.floor(h[1]), Math.floor(h[2]));
        if (!b || ok(b.name)) return h;
        places.forget(name);
        return null;
    };
    const chest = places.recall(HOME_PLACE);
    const cb = chest ? a.bot.blockAt(Math.floor(chest[0]), Math.floor(chest[1]), Math.floor(chest[2])) : null;
    return {
        homeBed: check('home_bed', n => n.endsWith('_bed')),
        playerBed: check('player_bed', n => n.endsWith('_bed')),
        homeTable: check('home_table', n => n === 'crafting_table'),
        // a gone home chest is the director's to forget: here it is just not there
        homeChest: chest && (!cb || isChest(cb)) ? chest : null,
    };
}

function speakerOf(a: Act, name: string | null): Speaker | null {
    if (!name) return null;
    const e = a.bot.player(name) as (ActEntity & { onGround?: boolean }) | null;
    if (!e) return null;
    const me = a.bot.entity.position, p = e.position;
    const feet = a.bot.blockAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const head = { x: Math.floor(p.x), y: Math.floor(p.y) + 1, z: Math.floor(p.z) };
    return {
        name, pos: { x: p.x, y: p.y, z: p.z }, dist: Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z),
        overworld: (a.bot.dimension?.() ?? 'overworld') === 'overworld', onGround: e.onGround !== false,
        inFluid: /water|lava/.test(feet?.name ?? ''), openSky: (a.bot.skyLight?.(head) ?? 15) >= 14,
    };
}

/** centreOf: the chores centre, saving (and saying) what chooseCentre says to keep, and adopting a base chest. */
export function centreOf(a: Act, d: SenseDeps): Centre & { homeBed: boolean; playerBed: boolean; homeChest: Vec3Like | null } {
    const h = homeFacts(a, d.places);
    const self = a.bot.entity.position;
    const placed = d.placed().filter(p => {
        const b = a.bot.blockAt(p.pos.x, p.pos.y, p.pos.z);
        return !b || (p.kind === 'table' ? b.name === 'crafting_table' : isChest(b));
    });
    const noHome = !h.homeBed && !h.homeChest && !h.homeTable && !placed.length;
    const nearby = noHome ? [
        ...findIn(a, TABLES, self, WORK, 4).map(pos => ({ kind: 'table' as const, pos })),
        ...findIn(a, CHESTS, self, WORK, 4).map(pos => ({ kind: 'chest' as const, pos })),
    ] : [];
    const saved = d.places.recall('chores_centre');
    const st = d.state();
    const c = chooseCentre({
        homeBed: h.homeBed, homeChest: h.homeChest, homeTable: h.homeTable, playerPlaced: placed, nearby,
        speaker: speakerOf(a, d.speaker()),
        saved: saved ? { kind: st.centreKind === 'player' ? 'player' : 'self', pos: { x: saved[0], y: saved[1], z: saved[2] } } : null,
        self: { x: self.x, y: self.y, z: self.z },
    });
    let homeChest = p3(h.homeChest);
    if (c.save) {
        d.places.remember(c.save.place, c.save.pos);
        if (c.save.place === 'chores_centre') st.centreKind = c.save.kind ?? 'self';
        else d.places.forget('chores_centre');
        if (c.save.place === HOME_PLACE) homeChest = c.save.pos;
        d.clearPlaced();
        if (c.save.say) d.say(c.save.say);
        d.save();
    }
    // a table or (moved) bed home: a chest in the base area becomes the home chest
    const adopt = chestToAdopt(c, h.homeChest, findIn(a, CHESTS, c.pos, BASE, 4, BASE_HEIGHT));
    if (adopt) { d.places.remember(HOME_PLACE, adopt); homeChest = adopt; }
    return { ...c, homeBed: !!h.homeBed, playerBed: !!h.playerBed, homeChest };
}

/** isTree: a log with leaves beside or above it within 6 up (a tree, not a house beam). */
function isTree(a: Act, p: Vec3Like): boolean {
    for (let dy = 0; dy <= 6; dy++) {
        const up = a.bot.blockAt(p.x, p.y + dy, p.z);
        if (!up) break;
        if (up.name.endsWith('_leaves')) return true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (a.bot.blockAt(p.x + dx, p.y + dy, p.z + dz)?.name.endsWith('_leaves')) return true;
        if (!isLog(up.name)) break;
    }
    return false;
}

/** An adult (1.21 metadata 16: a baby), as the old animalsNear. */
const isAdult = (e: ActEntity) => e.metadata?.[16] !== true;

/** senseChores: the chores situation now (with Last given), and the centre it is measured from. */
export function senseChores(a: Act, d: SenseDeps, last: LastRun[]): { situation: ChoresSituation; centre: Vec3Like; home: Home } {
    const c = centreOf(a, d);
    const centre = c.pos;
    const items = a.bot.items().map(i => ({ name: i.name, count: i.count }));
    const isFood = (n: string) => a.bot.isFood(n);
    const st = d.state();
    const chestItems = c.homeChest ? st.chestItems : [];
    const reserved = kitReserved(chestItems, isFood);
    const kit = kitLine(reserved, isFood);
    const tools = bestTiers(items.map(i => i.name));
    const inBaseFound = (names: readonly string[]) => findIn(a, names, centre, BASE, 2, BASE_HEIGHT).length > 0;
    const near = (names: readonly string[], keep?: (p: Vec3Like) => boolean): ChoreSearch => searchOf(centre, findIn(a, names, centre, 193, NEAR_COUNT, null, keep));
    const logs = a.bot.blockNames(isLog);
    const ironSeen = findIn(a, IRON_ORES, centre, 193, NEAR_COUNT);
    const ironMines = (d.mines?.all?.() ?? []).filter(m => m.ores?.includes('iron')).map(m => m.entrance);
    const water = near(['water'], p => (a.bot.blockAt(p.x, p.y, p.z)?.metadata ?? 1) === 0
        && (a.bot.skyLight?.({ x: p.x, y: p.y + 1, z: p.z }) ?? 0) > 0 && a.bot.blockAt(p.x, p.y + 1, p.z)?.name !== 'water');
    const crops = findIn(a, CROPS, centre, WORK, 256, 24, p => a.bot.blockAt(p.x, p.y - 1, p.z)?.name === 'farmland').map(p => {
        const b = a.bot.blockAt(p.x, p.y, p.z);
        const age = Number(b?.getProperties?.().age ?? b?.metadata ?? 0);
        return { name: b?.name ?? '', age };
    });
    const farm = farmOf(crops);
    const animals = Object.fromEntries(CHORE_ANIMALS.map(k => [k, 0])) as Record<(typeof CHORE_ANIMALS)[number], ChoreSearch>;
    for (const e of Object.values(a.bot.entities)) {
        if (!e.position || e.username !== undefined) continue;
        const kind = e.name === 'mooshroom' ? 'cow' : e.name;
        if (!(CHORE_ANIMALS as readonly (string | undefined)[]).includes(kind) || !isAdult(e)) continue;
        const s = searchOf(centre, [e.position]);
        const k = kind as (typeof CHORE_ANIMALS)[number];
        if (s !== 0 && (animals[k] === 0 || s < animals[k])) animals[k] = s;
    }
    const ground = Object.values(a.bot.entities).filter(e => e.name === 'item' && e.position && inBase(centre, e.position)
        && isSapling(a.bot.droppedItem?.(e) ?? '')).length;
    const situation: ChoresSituation = {
        time: timeWord(a.bot.timeOfDay?.() ?? 6000), home: c.home, biome: biomeWord(a.bot.biomeAt?.(centre)),
        table: inBaseFound(TABLES), furnace: inBaseFound(FURNACES), chest: !!c.homeChest || inBaseFound(CHESTS),
        lit: litOf((x, y, z) => a.bot.blockAt(x, y, z), centre), bedMine: c.homeBed, bedPlayer: c.playerBed,
        farm: farm.farm, ready: farm.ready,
        ...tools, shears: items.some(i => i.name === 'shears'),
        carry: haveCounts(items, isFood), inChest: haveCounts(c.homeChest ? unreserved(chestItems, reserved) : [], isFood),
        free: Math.max(0, Math.min(CHORES_MAX.free, a.bot.emptySlots?.() ?? 0)),
        made: madeCounts(items),
        kitPickaxe: kit.pickaxe, kitAxe: kit.axe, kitShovel: kit.shovel, kitSword: kit.sword, kitFood: kit.food, kitTorches: kit.torches,
        trees: near(logs, p => isTree(a, p)), stone: near(STONES, p => surfaceStone(a, p)), coal: near(COAL_ORES),
        iron: searchOf(centre, [...ironSeen, ...ironMines]), grass: near(GRASS), water,
        animals, ground: Math.min(CHORES_MAX.ground, ground),
        canPlace: d.canPlace, canSmelt: d.canSmelt,
        last,
    };
    // a base chest that isn't the home chest: the Chest line is all 0 (only the home chest is counted)
    if (!situation.chest) situation.inChest = haveCounts([], isFood);
    return { situation, centre, home: c.home };
}
