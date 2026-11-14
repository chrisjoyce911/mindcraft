// The defend task's state: laya-go's defend prompt v1 (games/defend/prompt), from the bot's health,
// hunger, armour, gear, the time of day, a nearby player and the hostile mobs around it. A port of the
// old bot's src/agent/laya/defend_state.js; test/fixtures/laya-defend-v1 pins it.
//
//   Defend.
//   Health 14 Food 12 Armor 8 Night yes Player no
//   Weapons iron_sword bow
//   Arrows 12 Shield yes Apples 1
//   Mobs zombie E2 N2 H20 skeleton W12 S4 H20

export const NONE = 'none';
export const MAX_MOBS = 4;
export const MOB_RANGE = 16;
export const MAX_WEAPONS = 3;
export const PLAYER_NEAR = 8;

export interface KindInfo {
    /** Full health. */
    health: number;
    /** Distance within which it is a threat. */
    notice: number;
    /** Shoots or throws (skeleton, stray, witch). */
    ranged: boolean;
    /** Higher is dealt with first. */
    priority: number;
    /** Neutral in daylight (spiders). */
    dayCalm: boolean;
}

/** KINDS are laya-go's defend mobs (games/defend/rules.Kinds). */
export const KINDS = {
    zombie: { health: 20, notice: 8, ranged: false, priority: 2, dayCalm: false },
    husk: { health: 20, notice: 8, ranged: false, priority: 2, dayCalm: false },
    spider: { health: 16, notice: 8, ranged: false, priority: 1, dayCalm: true },
    cave_spider: { health: 12, notice: 8, ranged: false, priority: 1, dayCalm: true },
    creeper: { health: 20, notice: 8, ranged: false, priority: 5, dayCalm: false },
    skeleton: { health: 20, notice: 15, ranged: true, priority: 3, dayCalm: false },
    stray: { health: 20, notice: 15, ranged: true, priority: 3, dayCalm: false },
    witch: { health: 26, notice: 12, ranged: true, priority: 4, dayCalm: false },
} as const satisfies Record<string, KindInfo>;
export type DefendKind = keyof typeof KINDS;
export const isDefendKind = (k: string): k is DefendKind => Object.hasOwn(KINDS, k);
export const kindInfo = (k: DefendKind): KindInfo => KINDS[k];

export interface WeaponInfo { damage: number; speed: number; ranged: boolean }
/** WEAPONS are laya-go's weapons (Java 1.21 damage and attacks per second), in its fixed order. */
export const WEAPONS = {
    wooden_sword: { damage: 4, speed: 1.6, ranged: false },
    stone_sword: { damage: 5, speed: 1.6, ranged: false },
    iron_sword: { damage: 6, speed: 1.6, ranged: false },
    diamond_sword: { damage: 7, speed: 1.6, ranged: false },
    netherite_sword: { damage: 8, speed: 1.6, ranged: false },
    wooden_axe: { damage: 7, speed: 0.8, ranged: false },
    stone_axe: { damage: 9, speed: 0.8, ranged: false },
    iron_axe: { damage: 9, speed: 0.9, ranged: false },
    diamond_axe: { damage: 9, speed: 1.0, ranged: false },
    netherite_axe: { damage: 10, speed: 1.0, ranged: false },
    bow: { damage: 6, speed: 1, ranged: true },
} as const satisfies Record<string, WeaponInfo>;
export type WeaponName = keyof typeof WEAPONS;
export const WEAPON_NAMES = Object.keys(WEAPONS) as WeaponName[];
export const isWeapon = (w: string): w is WeaponName => Object.hasOwn(WEAPONS, w);
/** dps is a weapon's melee damage per second (damage × speed, as laya-go computes it). */
export const dps = (w: WeaponName): number => WEAPONS[w].damage * WEAPONS[w].speed;

/** A mob at a block offset from the bot's column, with its health. */
export interface DefendMob { kind: DefendKind; dx: number; dz: number; health: number }

/** What the defend model and rules decide from (laya-go rules.Situation). */
export interface DefendSituation {
    health: number;
    food: number;
    armor: number;
    night: boolean;
    /** A player to protect within PLAYER_NEAR. */
    playerNear: boolean;
    /** Carried weapons, distinct, in WEAPON_NAMES order, at most MAX_WEAPONS (chooseWeapons). */
    weapons: WeaponName[];
    arrows: number;
    shield: boolean;
    /** Golden apples (plain and enchanted). */
    apples: number;
    /** Nearest first, at most MAX_MOBS (nearMobs). */
    mobs: DefendMob[];
}

/** offset writes an offset as laya-go does: "E3 N2". */
export function offset(dx: number, dz: number): string {
    return `${dx < 0 ? 'W' + -dx : 'E' + dx} ${dz < 0 ? 'N' + -dz : 'S' + dz}`;
}

/** dist is a mob's distance from the bot's column. */
export const dist = (m: { dx: number; dz: number }): number => Math.hypot(m.dx, m.dz);

/** sortMobs orders mobs nearest first, ties by kind, then dz, then dx (laya-go's generate.SortMobs). */
export function sortMobs<M extends DefendMob>(mobs: M[]): M[] {
    return mobs.sort((a, b) => dist(a) - dist(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.dz - b.dz || a.dx - b.dx);
}

/** A hostile mob seen by the sensors: its kind (entity name), block column, health if known, entity id. */
export interface SeenMob { kind: string; x: number; z: number; health?: number; id?: number }
export interface NearMob extends DefendMob { id?: number }

/**
 * nearMobs returns the defend mobs within MOB_RANGE of the bot's column (bx, bz), nearest first, at most
 * MAX_MOBS, with health rounded up and clamped to 1…full (unknown: full).
 */
export function nearMobs(mobs: readonly SeenMob[], bx: number, bz: number): NearMob[] {
    const rel: NearMob[] = [];
    for (const m of mobs) {
        if (!isDefendKind(m.kind)) continue;
        const full = kindInfo(m.kind).health;
        const h = m.health !== undefined && Number.isFinite(m.health) && m.health > 0 ? Math.min(full, Math.max(1, Math.ceil(m.health))) : full;
        const n: NearMob = { kind: m.kind, dx: m.x - bx, dz: m.z - bz, health: h };
        if (m.id !== undefined) n.id = m.id;
        if (dist(n) <= MOB_RANGE) rel.push(n);
    }
    return sortMobs(rel).slice(0, MAX_MOBS);
}

/** chooseWeapons keeps at most MAX_WEAPONS carried weapons, in laya-go's order: the bow (when carried) and the best melee by DPS. */
export function chooseWeapons(names: readonly string[]): WeaponName[] {
    const carried = WEAPON_NAMES.filter(w => names.includes(w));
    if (carried.length <= MAX_WEAPONS) return carried;
    const bow = carried.includes('bow');
    const melee = carried.filter(w => w !== 'bow').sort((a, b) => dps(b) - dps(a) || WEAPON_NAMES.indexOf(a) - WEAPON_NAMES.indexOf(b));
    const keep = new Set<WeaponName>(melee.slice(0, bow ? MAX_WEAPONS - 1 : MAX_WEAPONS));
    if (bow) keep.add('bow');
    return WEAPON_NAMES.filter(w => keep.has(w));
}

/** defendState writes a situation as defend prompt v1. */
export function defendState(s: DefendSituation): string {
    const yn = (b: boolean): string => (b ? 'yes' : 'no');
    const mobs = s.mobs.length ? s.mobs.map(m => `${m.kind} ${offset(m.dx, m.dz)} H${m.health}`).join(' ') : NONE;
    return [
        'Defend.',
        `Health ${s.health} Food ${s.food} Armor ${s.armor} Night ${yn(s.night)} Player ${yn(s.playerNear)}`,
        `Weapons ${s.weapons.length ? s.weapons.join(' ') : NONE}`,
        `Arrows ${s.arrows} Shield ${yn(s.shield)} Apples ${s.apples}`,
        `Mobs ${mobs}`,
    ].join('\n');
}
