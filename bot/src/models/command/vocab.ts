// The command model's words (laya-go games/command, prompts v1, v2, v2.1, v2.2): a port of the old bot's
// src/agent/laya/command_state.js lists. test/fixtures/laya-command-v*/ pin them (bot/test/command.test.ts).

export const NONE = 'none';

/** The prompt versions the bot can write. v2 adds farm and home, v2.1 animal drops, v2.2 chores_on/off. */
export const COMMAND_PROMPTS = ['v1', 'v2', 'v2.1', 'v2.2'] as const;
export type CommandPrompt = (typeof COMMAND_PROMPTS)[number];

/** promptOf turns the served (or configured) prompt version into one the bot writes: v1 unless v2, v2.1 or v2.2 (the old questionsFor). */
export function promptOf(version: string | null | undefined): CommandPrompt {
    return (COMMAND_PROMPTS as readonly string[]).includes(version ?? '') ? (version as CommandPrompt) : 'v1';
}

export const COMMANDS = ['follow', 'come', 'stop', 'stay', 'gather', 'craft', 'mine', 'give', 'attack', 'store', 'eat', 'inventory', 'chat'] as const;
/** v2's: v1's with farm after mine and home after store. */
export const COMMANDS_V2 = ['follow', 'come', 'stop', 'stay', 'gather', 'craft', 'mine', 'farm', 'give', 'attack', 'store', 'home', 'eat', 'inventory', 'chat'] as const;
/** v2.2's: v2's with chores_on and chores_off before chat. */
export const COMMANDS_V22 = ['follow', 'come', 'stop', 'stay', 'gather', 'craft', 'mine', 'farm', 'give', 'attack', 'store', 'home', 'eat', 'inventory',
    'chores_on', 'chores_off', 'chat'] as const;
/** Every Command answer word of any prompt. */
export type CommandWord = (typeof COMMANDS_V22)[number];

export const TIERS = ['wooden', 'stone', 'iron', 'diamond', NONE] as const;
export type Tier = (typeof TIERS)[number];
export const COUNTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '16', '20', '24', '32', '48', '64', 'all', 'any'] as const;
export type CountWord = (typeof COUNTS)[number];
/** The Item question's crops: the job's crops (one source of truth, types/jobs.ts). */
export { CROPS } from '../../types/jobs.js';
export const TOOLS = ['pickaxe', 'axe', 'sword', 'shovel', 'hoe'] as const;
export const ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
/** The Item question's mobs (attack targets). */
export const MOBS = ['zombie', 'skeleton', 'spider', 'creeper', 'witch', 'husk', 'cave_spider', 'stray', 'drowned', 'enderman', 'slime',
    'cow', 'pig', 'sheep', 'chicken'] as const;

export const FOODS: readonly string[] = ['bread', 'apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_cod',
    'cooked_salmon', 'baked_potato', 'carrot', 'potato', 'golden_apple', 'golden_carrot', 'rotten_flesh', 'chicken', 'beef', 'porkchop', 'mutton',
    'cookie', 'melon_slice', 'sweet_berries', 'pumpkin_pie', 'mushroom_stew', 'beetroot', 'dried_kelp'];

type Match = (name: string) => boolean;
const is = (...names: string[]): Match => n => names.includes(n);
const suffix = (s: string): Match => n => n.endsWith(s);

/** An item kind (laya-go generate.Kinds): the item gather and mine get, the item craft makes, which carried items match. */
export interface Kind { key: string; gather: string; craft: string; carried: Match; hunt?: string }

export const KINDS: readonly Kind[] = [
    { key: 'wood', gather: 'log', craft: 'planks', carried: suffix('_log') },
    { key: 'planks', gather: 'planks', craft: 'planks', carried: suffix('_planks') },
    { key: 'stick', gather: 'stick', craft: 'stick', carried: is('stick') },
    { key: 'stone', gather: 'cobblestone', craft: 'stone', carried: is('cobblestone', 'stone') },
    { key: 'coal', gather: 'coal', craft: 'charcoal', carried: is('coal', 'charcoal') },
    { key: 'charcoal', gather: '', craft: 'charcoal', carried: is('charcoal') },
    { key: 'iron', gather: 'raw_iron', craft: 'iron_ingot', carried: is('iron_ingot', 'raw_iron') },
    { key: 'gold', gather: 'raw_gold', craft: 'gold_ingot', carried: is('gold_ingot', 'raw_gold') },
    { key: 'copper', gather: 'raw_copper', craft: 'copper_ingot', carried: is('copper_ingot', 'raw_copper') },
    { key: 'diamond', gather: 'diamond', craft: '', carried: is('diamond') },
    { key: 'emerald', gather: 'emerald', craft: '', carried: is('emerald') },
    { key: 'redstone', gather: 'redstone', craft: '', carried: is('redstone') },
    { key: 'lapis', gather: 'lapis_lazuli', craft: '', carried: is('lapis_lazuli') },
    { key: 'sand', gather: 'sand', craft: '', carried: is('sand') },
    { key: 'glass', gather: '', craft: 'glass', carried: is('glass') },
    { key: 'dirt', gather: 'dirt', craft: '', carried: is('dirt') },
    { key: 'gravel', gather: 'gravel', craft: '', carried: is('gravel') },
    { key: 'flint', gather: 'flint', craft: '', carried: is('flint') },
    { key: 'torch', gather: '', craft: 'torch', carried: is('torch') },
    { key: 'table', gather: '', craft: 'crafting_table', carried: is('crafting_table') },
    { key: 'furnace', gather: '', craft: 'furnace', carried: is('furnace') },
    { key: 'chest', gather: '', craft: 'chest', carried: is('chest') },
    { key: 'ladder', gather: '', craft: 'ladder', carried: is('ladder') },
    { key: 'bucket', gather: '', craft: 'bucket', carried: is('bucket') },
    { key: 'shield', gather: '', craft: 'shield', carried: is('shield') },
    { key: 'shears', gather: '', craft: 'shears', carried: is('shears') },
    { key: 'bowl', gather: '', craft: 'bowl', carried: is('bowl') },
    { key: 'food', gather: '', craft: '', carried: is(...FOODS) },
    { key: 'bread', gather: '', craft: '', carried: is('bread') },
    { key: 'apple', gather: '', craft: '', carried: is('apple', 'golden_apple') },
    { key: 'meat', gather: '', craft: '', carried: is('cooked_beef', 'beef', 'cooked_porkchop', 'porkchop', 'cooked_mutton', 'mutton', 'cooked_chicken') },
    { key: 'string', gather: 'string', craft: '', carried: is('string') },
    { key: 'arrow', gather: '', craft: '', carried: is('arrow') },
    { key: 'bone', gather: '', craft: '', carried: is('bone') },
    { key: 'wheat', gather: 'wheat', craft: '', carried: is('wheat') },
    { key: 'seeds', gather: 'wheat_seeds', craft: '', carried: is('wheat_seeds') },
    { key: 'wool', gather: 'white_wool', craft: '', carried: suffix('_wool') },
];

/** v2's kinds: v1's and the three new crops. */
export const KINDS_V2: readonly Kind[] = [...KINDS,
    { key: 'carrots', gather: 'carrot', craft: '', carried: is('carrot') },
    { key: 'potatoes', gather: 'potato', craft: '', carried: is('potato') },
    { key: 'beetroot', gather: 'beetroot', craft: '', carried: is('beetroot') },
];

/** v2.1's new kinds, what animals drop (laya-go generate.Drops), each with the mob a gather of it hunts. */
export const DROPS: readonly (Kind & { hunt: string })[] = [
    { key: 'beef', gather: 'beef', craft: '', hunt: 'cow', carried: is('beef', 'cooked_beef') },
    { key: 'pork', gather: 'porkchop', craft: '', hunt: 'pig', carried: is('porkchop', 'cooked_porkchop') },
    { key: 'mutton', gather: 'mutton', craft: '', hunt: 'sheep', carried: is('mutton', 'cooked_mutton') },
    { key: 'chicken', gather: 'chicken', craft: '', hunt: 'chicken', carried: is('chicken', 'cooked_chicken') },
    { key: 'leather', gather: 'leather', craft: '', hunt: 'cow', carried: is('leather') },
    { key: 'feather', gather: 'feather', craft: '', hunt: 'chicken', carried: is('feather') },
    { key: 'egg', gather: 'egg', craft: '', hunt: 'chicken', carried: is('egg') },
];

/** v2.1's kinds: v2's and the drops. */
export const KINDS_V21: readonly Kind[] = [...KINDS_V2, ...DROPS];

function itemOptions(kinds: readonly Kind[]): string[] {
    const o: string[] = [...kinds.map(k => k.key), ...TOOLS, ...ARMOR];
    for (const m of MOBS) if (!o.includes(m)) o.push(m);
    return [...o, NONE];
}

/** The Item question's options (laya-go generate.ItemOptions), per prompt. */
export const ITEMS: readonly string[] = itemOptions(KINDS);
export const ITEMS_V2: readonly string[] = itemOptions(KINDS_V2);
/** v2's in the same order, then the drops not already there (chicken is a mob in v2), then none. */
export const ITEMS_V21: readonly string[] = [...ITEMS_V2.slice(0, -1), ...DROPS.map(k => k.key).filter(k => !ITEMS_V2.includes(k)), NONE];

/** An Item answer word of any prompt (a kind key, tool, armour piece, mob or none). */
export type ItemKey = string;

/** The command, item and count options for a prompt version. */
export function commandWords(v: CommandPrompt): readonly CommandWord[] {
    return v === 'v2.2' ? COMMANDS_V22 : v === 'v1' ? COMMANDS : COMMANDS_V2;
}
export function itemWords(v: CommandPrompt): readonly string[] {
    return v === 'v2.1' || v === 'v2.2' ? ITEMS_V21 : v === 'v2' ? ITEMS_V2 : ITEMS;
}
