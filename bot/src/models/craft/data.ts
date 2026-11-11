// laya-go's craft item table, the pickaxes, the fuels and the stack and tag of each food (games/craft/items,
// games/eat/food): a typed copy of the old bot's src/agent/laya/craft_data.js. Keep in step with laya-go:
// test/craft.state.test.ts checks states against laya-go's, and test/craft.data.test.ts checks every crafted item
// against minecraft-data's recipes.

export type ItemKind = 'gathered' | 'crafted' | 'smelted';
export interface GatheredDef { readonly kind: 'gathered'; readonly tier?: 1 | 2 | 3 }
export interface CraftedDef { readonly kind: 'crafted'; readonly result: number; readonly table?: true; readonly needs: readonly (readonly [string, number])[] }
export interface SmeltedDef { readonly kind: 'smelted'; readonly source: string }
export type ItemDef = GatheredDef | CraftedDef | SmeltedDef;

export const ITEMS = {
    bone: { kind: 'gathered' },
    bone_meal: { kind: 'crafted', result: 3, needs: [['bone', 1]] },
    bowl: { kind: 'crafted', result: 4, table: true, needs: [['planks', 3]] },
    bread: { kind: 'crafted', result: 1, table: true, needs: [['wheat', 3]] },
    bucket: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 3]] },
    charcoal: { kind: 'smelted', source: 'log' },
    chest: { kind: 'crafted', result: 1, table: true, needs: [['planks', 8]] },
    coal: { kind: 'gathered', tier: 1 },
    cobblestone: { kind: 'gathered', tier: 1 },
    crafting_table: { kind: 'crafted', result: 1, needs: [['planks', 4]] },
    diamond: { kind: 'gathered', tier: 3 },
    diamond_axe: { kind: 'crafted', result: 1, table: true, needs: [['diamond', 3], ['stick', 2]] },
    diamond_hoe: { kind: 'crafted', result: 1, table: true, needs: [['diamond', 2], ['stick', 2]] },
    diamond_pickaxe: { kind: 'crafted', result: 1, table: true, needs: [['diamond', 3], ['stick', 2]] },
    diamond_shovel: { kind: 'crafted', result: 1, table: true, needs: [['diamond', 1], ['stick', 2]] },
    diamond_sword: { kind: 'crafted', result: 1, table: true, needs: [['diamond', 2], ['stick', 1]] },
    furnace: { kind: 'crafted', result: 1, table: true, needs: [['cobblestone', 8]] },
    glass: { kind: 'smelted', source: 'sand' },
    iron_axe: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 3], ['stick', 2]] },
    iron_boots: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 4]] },
    iron_chestplate: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 8]] },
    iron_helmet: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 5]] },
    iron_hoe: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 2], ['stick', 2]] },
    iron_ingot: { kind: 'smelted', source: 'raw_iron' },
    iron_leggings: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 7]] },
    iron_pickaxe: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 3], ['stick', 2]] },
    iron_shovel: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 1], ['stick', 2]] },
    iron_sword: { kind: 'crafted', result: 1, table: true, needs: [['iron_ingot', 2], ['stick', 1]] },
    ladder: { kind: 'crafted', result: 3, table: true, needs: [['stick', 7]] },
    log: { kind: 'gathered' },
    planks: { kind: 'crafted', result: 4, needs: [['log', 1]] },
    raw_iron: { kind: 'gathered', tier: 2 },
    sand: { kind: 'gathered' },
    shears: { kind: 'crafted', result: 1, needs: [['iron_ingot', 2]] },
    shield: { kind: 'crafted', result: 1, table: true, needs: [['planks', 6], ['iron_ingot', 1]] },
    stick: { kind: 'crafted', result: 4, needs: [['planks', 2]] },
    stone: { kind: 'smelted', source: 'cobblestone' },
    stone_axe: { kind: 'crafted', result: 1, table: true, needs: [['cobblestone', 3], ['stick', 2]] },
    stone_hoe: { kind: 'crafted', result: 1, table: true, needs: [['cobblestone', 2], ['stick', 2]] },
    stone_pickaxe: { kind: 'crafted', result: 1, table: true, needs: [['cobblestone', 3], ['stick', 2]] },
    stone_shovel: { kind: 'crafted', result: 1, table: true, needs: [['cobblestone', 1], ['stick', 2]] },
    stone_sword: { kind: 'crafted', result: 1, table: true, needs: [['cobblestone', 2], ['stick', 1]] },
    torch: { kind: 'crafted', result: 4, needs: [['coal', 1], ['stick', 1]] },
    wheat: { kind: 'gathered' },
    wheat_seeds: { kind: 'gathered' },
    wooden_axe: { kind: 'crafted', result: 1, table: true, needs: [['planks', 3], ['stick', 2]] },
    wooden_hoe: { kind: 'crafted', result: 1, table: true, needs: [['planks', 2], ['stick', 2]] },
    wooden_pickaxe: { kind: 'crafted', result: 1, table: true, needs: [['planks', 3], ['stick', 2]] },
    wooden_shovel: { kind: 'crafted', result: 1, table: true, needs: [['planks', 1], ['stick', 2]] },
    wooden_sword: { kind: 'crafted', result: 1, table: true, needs: [['planks', 2], ['stick', 1]] },
} as const satisfies Record<string, ItemDef>;

/** A laya-go craft item (its generic name: log and planks stand for every wood). */
export type CraftItem = keyof typeof ITEMS;
export const CRAFT_ITEMS = Object.keys(ITEMS) as CraftItem[];
export const isCraftItem = (n: string): n is CraftItem => Object.hasOwn(ITEMS, n);
/** itemDef: the item's entry (typed as the union, so kind narrows it). */
export const itemDef = (n: CraftItem): ItemDef => ITEMS[n];

export const PICKAXES = ['wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'] as const satisfies readonly CraftItem[];
export const FUELS = ['coal', 'charcoal', 'log', 'planks'] as const satisfies readonly CraftItem[];

export type FoodTag = 'normal' | 'bad' | 'rare';
/** FOOD_STACKS: [stack size, tag] per food. */
export const FOOD_STACKS: Readonly<Record<string, readonly [number, FoodTag]>> = {
    apple: [64, 'normal'],
    baked_potato: [64, 'normal'],
    beef: [64, 'normal'],
    beetroot: [64, 'normal'],
    beetroot_soup: [1, 'normal'],
    bread: [64, 'normal'],
    carrot: [64, 'normal'],
    chicken: [64, 'bad'],
    chorus_fruit: [64, 'bad'],
    cod: [64, 'normal'],
    cooked_beef: [64, 'normal'],
    cooked_chicken: [64, 'normal'],
    cooked_cod: [64, 'normal'],
    cooked_mutton: [64, 'normal'],
    cooked_porkchop: [64, 'normal'],
    cooked_rabbit: [64, 'normal'],
    cooked_salmon: [64, 'normal'],
    cookie: [64, 'normal'],
    dried_kelp: [64, 'normal'],
    enchanted_golden_apple: [64, 'rare'],
    glow_berries: [64, 'normal'],
    golden_apple: [64, 'rare'],
    golden_carrot: [64, 'normal'],
    honey_bottle: [16, 'normal'],
    melon_slice: [64, 'normal'],
    mushroom_stew: [1, 'normal'],
    mutton: [64, 'normal'],
    poisonous_potato: [64, 'bad'],
    porkchop: [64, 'normal'],
    potato: [64, 'normal'],
    pufferfish: [64, 'bad'],
    pumpkin_pie: [64, 'normal'],
    rabbit: [64, 'normal'],
    rabbit_stew: [1, 'normal'],
    rotten_flesh: [64, 'bad'],
    salmon: [64, 'normal'],
    spider_eye: [64, 'bad'],
    suspicious_stew: [1, 'bad'],
    sweet_berries: [64, 'normal'],
    tropical_fish: [64, 'normal'],
};
