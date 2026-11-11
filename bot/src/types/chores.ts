// The chores v2 words (skills-spec v1 §1; laya-go games/chores/v2 v2.go): the values of the state lines and the
// answers. Here so the sensors (below the models) and the model (models/chores) use the same types.

export const CHORES_NONE = 'none';

/** The Skill question's options, in order. */
export const CHORE_SKILLS = ['hunt', 'farm', 'gather', 'mine', 'craft', 'place', 'cook', 'store', 'sleep', 'ask', 'rest'] as const;
export type ChoreSkill = (typeof CHORE_SKILLS)[number];

/** The Target question's options, in order. */
export const CHORE_TARGETS = ['food', 'logs', 'seeds', 'wool', 'saplings', 'cobble', 'coal', 'iron', 'start', 'tend',
    'crafting_table', 'furnace', 'chest', 'bed', 'torch',
    'wooden_axe', 'wooden_pickaxe', 'wooden_hoe', 'wooden_shovel', 'wooden_sword',
    'stone_axe', 'stone_pickaxe', 'stone_shovel', 'stone_sword',
    'iron_axe', 'iron_pickaxe', 'iron_shovel', 'iron_sword', 'unload', 'kit', 'none'] as const;
export type ChoreTarget = (typeof CHORE_TARGETS)[number];

/** The craft targets (v2.go Pairs craft). */
export const CHORE_CRAFTS = ['crafting_table', 'furnace', 'chest', 'bed', 'torch', 'wooden_axe', 'wooden_pickaxe', 'wooden_hoe', 'wooden_shovel',
    'wooden_sword', 'stone_axe', 'stone_pickaxe', 'stone_shovel', 'stone_sword', 'iron_axe', 'iron_pickaxe', 'iron_shovel', 'iron_sword'] as const;
export type ChoreCraft = (typeof CHORE_CRAFTS)[number];
export const CHORE_PLACES = ['crafting_table', 'furnace', 'chest', 'bed', 'torch', 'saplings'] as const;
export const CHORE_GATHERS = ['logs', 'seeds', 'wool', 'saplings'] as const;
export const CHORE_MINES = ['cobble', 'coal', 'iron'] as const;
export type ChoreMine = (typeof CHORE_MINES)[number];
export const CHORE_ASKS = ['logs', 'cobble', 'coal', 'wool', 'food'] as const;
export type ChoreAsk = (typeof CHORE_ASKS)[number];

/** The valid (skill, target) pairs, in the Skill and then the Pairs order (v2.go Pairs). */
export const CHORE_PAIRS: Readonly<Record<ChoreSkill, readonly ChoreTarget[]>> = {
    hunt: ['food'],
    farm: ['start', 'tend'],
    gather: CHORE_GATHERS,
    mine: CHORE_MINES,
    craft: CHORE_CRAFTS,
    place: CHORE_PLACES,
    cook: ['none'],
    store: ['unload', 'kit'],
    sleep: ['none'],
    ask: CHORE_ASKS,
    rest: ['none'],
};

export const isChorePair = (skill: string, target: string): boolean =>
    (CHORE_SKILLS as readonly string[]).includes(skill) && (CHORE_PAIRS[skill as ChoreSkill] as readonly string[]).includes(target);

export const TIERS = ['none', 'wooden', 'stone', 'iron', 'diamond'] as const;
export type Tier = (typeof TIERS)[number];
export const HOMES = ['bed', 'chest', 'table', 'player', 'self'] as const;
export type Home = (typeof HOMES)[number];
export const TIMES = ['day', 'dusk', 'night'] as const;
export type TimeWord = (typeof TIMES)[number];
export const BIOMES = ['forest', 'plains', 'snowy', 'desert', 'beach', 'other'] as const;
export type BiomeWord = (typeof BIOMES)[number];
/** A Near or Animals search: the smallest square (49, 97, 193 columns) a thing is in, 0 for none. */
export type ChoreSearch = 0 | 49 | 97 | 193;
export const CHORE_ANIMALS = ['cow', 'pig', 'sheep', 'chicken', 'rabbit'] as const;

/**
 * Why a chore run failed (the Last line's failed:<reason>, v2.go Reasons): a closed list. Nothing outside it may
 * reach Last (the renderer refuses it).
 */
export const CHORE_REASONS = ['no_source', 'missing_logs', 'missing_cobble', 'missing_coal', 'missing_iron', 'missing_wool',
    'missing_food', 'missing_saplings', 'missing_seeds', 'missing_sticks', 'no_spot', 'no_tool', 'full', 'stuck',
    'interrupted', 'timeout'] as const;
export type ChoreReason = (typeof CHORE_REASONS)[number];
export const isChoreReason = (s: string): s is ChoreReason => (CHORE_REASONS as readonly string[]).includes(s);

/** The counted kinds, in the Carry and Chest lines' order (v2.go Have). */
export const HAVE_KINDS = ['wood', 'sticks', 'cobble', 'coal', 'iron', 'torches', 'food', 'raw', 'wool', 'seeds', 'saplings'] as const;
export type HaveKind = (typeof HAVE_KINDS)[number];
export type Counts = Record<HaveKind, number>;
export const zeroCounts = (): Counts => Object.fromEntries(HAVE_KINDS.map(k => [k, 0])) as Counts;

/** The Made line's stations. */
export const STATIONS = ['table', 'furnace', 'chest', 'bed'] as const;
export type Station = (typeof STATIONS)[number];

/** Limits (v2.go). */
export const CHORES_MAX = { count: 999, made: 9, kit: 99, last: 4, age: 9, ground: 9, free: 36 } as const;
/** Minutes a failed run is skipped (v2.go Cooldown). */
export const CHORES_COOLDOWN = 5;
/** An entry leaves the Last line once its age reaches this (minutes). */
export const LAST_WINDOW = 10;

/** One Last entry: the latest result of one (skill, target) run as a chore. */
export interface LastRun { skill: ChoreSkill; target: ChoreTarget; done: boolean; reason?: ChoreReason; age: number }
