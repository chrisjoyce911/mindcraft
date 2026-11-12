// The farm task's tables (a typed port of the old bot's src/agent/laya/farm_state.js and farm.js constants; laya-go
// games/farm/rules): the crops with their seed and cell codes, the items and animals the prompt names, the actions
// (v1 and v2), the foods each kind breeds with and the item each action needs. Pure.
import { CROPS, type Crop } from '../../types/jobs.js';

export { CROPS, type Crop };

/** The view is SIZE × SIZE cells around andy; C is andy's cell. */
export const SIZE = 9;
export const C = (SIZE - 1) / 2;
/** The most cells the Target question names. */
export const MAX_CELLS = 6;
/** Adult animals within this many blocks are counted. */
export const ANIMAL_RANGE = 16;
export const NONE = 'none';
export type None = typeof NONE;

/** A crop as the world has it: its block, its item, its seed, its growing and ripe cell codes and its ripe age. */
export interface CropInfo {
    crop: Crop;
    block: 'wheat' | 'carrots' | 'potatoes' | 'beetroots';
    name: 'wheat' | 'carrot' | 'potato' | 'beetroot';
    seed: 'wheat_seeds' | 'carrot' | 'potato' | 'beetroot_seeds';
    growing: '1' | '3' | '5' | '7';
    ripe: '2' | '4' | '6' | '8';
    ripeAge: number;
}

/** CROP_INFO: the crops in laya-go's order. */
export const CROP_INFO: readonly CropInfo[] = [
    { crop: 'wheat', block: 'wheat', name: 'wheat', seed: 'wheat_seeds', growing: '1', ripe: '2', ripeAge: 7 },
    { crop: 'carrots', block: 'carrots', name: 'carrot', seed: 'carrot', growing: '3', ripe: '4', ripeAge: 7 },
    { crop: 'potatoes', block: 'potatoes', name: 'potato', seed: 'potato', growing: '5', ripe: '6', ripeAge: 7 },
    { crop: 'beetroot', block: 'beetroots', name: 'beetroot', seed: 'beetroot_seeds', growing: '7', ripe: '8', ripeAge: 3 },
];
/** CROP_OF: a crop's entry. */
export const CROP_OF: Readonly<Record<Crop, CropInfo>> = {
    wheat: CROP_INFO[0]!, carrots: CROP_INFO[1]!, potatoes: CROP_INFO[2]!, beetroot: CROP_INFO[3]!,
};
/** The crop blocks (andy never walks on them or on farmland). */
export const CROP_BLOCKS = CROP_INFO.map(c => c.block);
export const FARM_BLOCKS = ['farmland', ...CROP_BLOCKS] as const;
/** SEEDS: what each crop is planted from (carrots and potatoes are their own seed). */
export const SEEDS: readonly string[] = CROP_INFO.map(c => c.seed);
export const isSeed = (item: string): boolean => SEEDS.includes(item);

/** The farm crop goal: a crop, or any. */
export type FarmCrop = Crop | 'any';
/** PRODUCE: the items each crop goal counts as harvested. */
export const PRODUCE: Readonly<Record<FarmCrop, readonly string[]>> = {
    wheat: ['wheat'], carrots: ['carrot'], potatoes: ['potato'], beetroot: ['beetroot'],
    any: ['wheat', 'carrot', 'potato', 'beetroot'],
};

/** A view cell: G/L grass or dirt with/without water near, X solid, O fence, W water, F/D wet/dry farmland, 1–8 crops. */
export type CellCode = 'G' | 'L' | 'X' | 'O' | 'W' | 'F' | 'D' | CropInfo['growing'] | CropInfo['ripe'];

/** FARM_ITEMS: the items the prompt counts (any hoe counts as hoe), in laya-go's order. */
export const FARM_ITEMS = ['hoe', 'water_bucket', 'bone_meal', 'wheat_seeds', 'wheat', 'carrot', 'potato', 'beetroot_seeds', 'beetroot'] as const;
export type FarmItem = (typeof FARM_ITEMS)[number];
export const isFarmItem = (s: string): s is FarmItem => (FARM_ITEMS as readonly string[]).includes(s);

/** KINDS: the animals the prompt counts, in laya-go's order. */
export const KINDS = ['cow', 'sheep', 'pig', 'chicken'] as const;
export type AnimalKind = (typeof KINDS)[number];
export const isKind = (s: string): s is AnimalKind => (KINDS as readonly string[]).includes(s);

/** The actions: v1's, and v2's (pond and find_water added). */
export const ACTIONS = ['harvest', 'plant', 'till', 'water', 'bone_meal', 'breed', 'wait'] as const;
export const ACTIONS_V2 = ['harvest', 'plant', 'till', 'water', 'pond', 'bone_meal', 'breed', 'find_water', 'wait'] as const;
export type FarmAction = (typeof ACTIONS_V2)[number];
export const isFarmAction = (s: string): s is FarmAction => (ACTIONS_V2 as readonly string[]).includes(s);
/** The actions done on a cell. */
export type CellAction = Exclude<FarmAction, 'breed' | 'wait' | 'find_water'>;

/** FOODS: the foods each kind breeds with (laya-go rules.Foods). */
export const FOODS: Readonly<Record<AnimalKind, readonly string[]>> = {
    cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'beetroot_seeds'],
};

/** NEEDS: the item each action uses when the answer names none. */
export const NEEDS: Partial<Readonly<Record<FarmAction, FarmItem>>> = { till: 'hoe', water: 'water_bucket', bone_meal: 'bone_meal', pond: 'water_bucket' };

/** STARTER: what farming needs before the first step: a hoe and some seeds (any seed will do). */
export interface StarterNeed { item: string; count: number; any?: readonly string[] }
export function starterKit(crop: FarmCrop): StarterNeed[] {
    const seed = crop === 'any' || crop === 'wheat' ? 'wheat_seeds' : CROP_OF[crop].seed;
    return [{ item: 'hoe', count: 1 }, { item: seed, count: 4, any: SEEDS }];
}

/**
 * resolveCrop (6.2b): the crop a farm of "any" grows, decided before the loop: the crop andy carries the most seed
 * for (ties in CROP_INFO order), else wheat (its seeds come from grass). The goal's produce still counts any crop.
 */
export function resolveCrop(crop: FarmCrop, inv: Inv): Crop {
    if (crop !== 'any') return crop;
    let best: CropInfo | null = null;
    for (const c of CROP_INFO) if ((inv[c.seed] || 0) > 0 && (!best || (inv[c.seed] || 0) > (inv[best.seed] || 0))) best = c;
    return best?.crop ?? 'wheat';
}

/** The text andy says when no seed can be had and nothing grows to harvest (6.2b). */
export const NO_SEEDS = "I couldn't find any grass for wheat seeds within 96 blocks — give me seeds or take me to some grass.";
export const noSeedsSay = (seed: string): string =>
    seed === 'wheat_seeds' ? NO_SEEDS : `I have no ${seed.replace(/_/g, ' ')} to plant and couldn't get any — give me some.`;

/** The text andy says when the same answer comes 3 times on the same state and nothing changes (6.2b dead end). */
export function deadEndSay(action: FarmAction): string {
    return action === 'find_water'
        ? 'I keep going for water and nothing changes, so I\'m stopping. Give me seeds or take me to farmland.'
        : `I keep trying to ${action.replace(/_/g, ' ')} here and nothing changes; stopping.`;
}
/** The same answer on the same state this many times with no progress ends the farm (6.2b; the 6.2 gate's dead end). */
export const DEAD_END_REPEATS = 3;

/** The text andy says when there is no water to farm with. */
export const NO_WATER = 'No water near here — take me to water or give me a water bucket.';

/** Item counts by Minecraft name. */
export type Inv = Readonly<Record<string, number>>;
