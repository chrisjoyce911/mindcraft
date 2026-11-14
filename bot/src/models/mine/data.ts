// The mine task's tables (a typed port of the old bot's src/agent/laya/mine_state.js constants; laya-go's
// games/mine/rules): the ores with their pickaxe tier, best height band and drop, the pickaxes, the throwaway
// blocks, the valuables and the caps the prompt writes. Pure.
import { ORES as ORE_NAMES, type Ore } from '../../types/jobs.js';

export type { Ore };
export { ORE_NAMES };

export const TORCH_EVERY = 8;
export const SEEN_RANGE = 16;
export const MIN_Y = -59;
/** With a plan, ore seen further than this is left (laya-go rules.CollectRange, the bot's collect_range). */
export const COLLECT_RANGE = 12;
/** With a plan, a step down at this health or less is a stop (rule low-health). */
export const LOW_HEALTH = 8;

export const TIERS = ['none', 'wooden', 'stone', 'iron', 'diamond'] as const;
/** A pickaxe tier: 0 none … 4 diamond. */
export type Tier = 0 | 1 | 2 | 3 | 4;

export interface OreInfo {
    /** The pickaxe tier mining it needs. */
    tier: Tier;
    /** The ore's best band of feet heights. */
    lo: number;
    hi: number;
    /** Its blocks (stone and deepslate). */
    blocks: readonly string[];
    /** The item mining it drops. */
    drop: string;
    /** The level the plan's staircase goes down to first. */
    best: number;
}

/** BEST_LEVEL: the level the mine plan's staircase goes down to first (emerald too, though it isn't mined). */
export const BEST_LEVEL = { coal: 45, copper: 48, iron: 16, lapis: 0, gold: -16, redstone: -58, diamond: -58, emerald: 16 } as const;

export const ORES: Readonly<Record<Ore, OreInfo>> = {
    coal: { tier: 1, lo: 8, hi: 96, blocks: ['coal_ore', 'deepslate_coal_ore'], drop: 'coal', best: BEST_LEVEL.coal },
    copper: { tier: 2, lo: 32, hi: 64, blocks: ['copper_ore', 'deepslate_copper_ore'], drop: 'raw_copper', best: BEST_LEVEL.copper },
    iron: { tier: 2, lo: 8, hi: 24, blocks: ['iron_ore', 'deepslate_iron_ore'], drop: 'raw_iron', best: BEST_LEVEL.iron },
    lapis: { tier: 2, lo: -8, hi: 8, blocks: ['lapis_ore', 'deepslate_lapis_ore'], drop: 'lapis_lazuli', best: BEST_LEVEL.lapis },
    gold: { tier: 3, lo: -24, hi: -8, blocks: ['gold_ore', 'deepslate_gold_ore'], drop: 'raw_gold', best: BEST_LEVEL.gold },
    redstone: { tier: 3, lo: -58, hi: -50, blocks: ['redstone_ore', 'deepslate_redstone_ore'], drop: 'redstone', best: BEST_LEVEL.redstone },
    diamond: { tier: 3, lo: -58, hi: -52, blocks: ['diamond_ore', 'deepslate_diamond_ore'], drop: 'diamond', best: BEST_LEVEL.diamond },
};

export const isOre = (s: string): s is Ore => (ORE_NAMES as readonly string[]).includes(s);

/** PICKAXES: a pickaxe's tier (gold mines like wood, netherite like diamond). */
export const PICKAXES: Readonly<Record<string, Tier>> = {
    wooden_pickaxe: 1, golden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3, diamond_pickaxe: 4, netherite_pickaxe: 4,
};
/** TIER_PICKAXE: the pickaxe to craft for a tier. */
export const TIER_PICKAXE = [null, 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'] as const;
export type CraftablePickaxe = Exclude<(typeof TIER_PICKAXE)[number], null>;
export const pickaxeFor = (tier: Tier): CraftablePickaxe => TIER_PICKAXE[Math.max(1, tier) as 1 | 2 | 3 | 4];

/** THROWAWAY blocks fill lava and water ("block"). */
export const THROWAWAY = ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff'] as const;

/** VALUABLES count fully in prompt v2's Valuables; coal counts half. */
export const VALUABLES = ['diamond', 'emerald', 'raw_iron', 'iron_ingot', 'raw_gold', 'gold_ingot', 'raw_copper', 'redstone', 'lapis_lazuli'] as const;
export const HOSTILES_CAP = 9;
export const VALUABLES_CAP = 999;
/** HOME_CAP caps the home chest distance in prompt v2. */
export const HOME_CAP = 999;

export const DIRS = ['N', 'E', 'S', 'W'] as const;
export type Dir = (typeof DIRS)[number];
export const isDir = (s: string): s is Dir => (DIRS as readonly string[]).includes(s);
export const OFFSET: Readonly<Record<Dir, readonly [number, number]>> = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };
/** The block face a torch goes on when it is on the wall in that direction. */
export const FACE: Readonly<Record<Dir, 'north' | 'east' | 'south' | 'west'>> = { N: 'north', E: 'east', S: 'south', W: 'west' };

/** The side of a cell a block or torch is placed against: the floor, or a wall (a wall torch). */
export type PlaceOnWord = 'bottom' | (typeof FACE)[Dir];

/** MOVE_KINDS are the move steps' kinds, in laya-go's order. */
export const MOVE_KINDS = ['tunnel', 'down', 'up'] as const;
export type MoveKind = (typeof MOVE_KINDS)[number];
export const isMoveKind = (s: string): s is MoveKind => (MOVE_KINDS as readonly string[]).includes(s);
export const DY: Readonly<Record<MoveKind, number>> = { tunnel: 0, down: -1, up: 1 };

/** Item counts by Minecraft name. */
export type Inv = Readonly<Record<string, number>>;

/** pickTier is the best pickaxe tier in an inventory. */
export function pickTier(inv: Inv): Tier {
    let t: Tier = 0;
    for (const [name, tier] of Object.entries(PICKAXES)) if ((inv[name] ?? 0) > 0 && tier > t) t = tier;
    return t;
}

export function countOf(inv: Inv, names: readonly string[]): number {
    return names.reduce((n, name) => n + (inv[name] || 0), 0);
}

/** valuables is prompt v2's Valuables for an inventory. */
export function valuables(inv: Inv): number {
    return Math.min(VALUABLES_CAP, countOf(inv, VALUABLES) + Math.floor((inv.coal || 0) / 2));
}
