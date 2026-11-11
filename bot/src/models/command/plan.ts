// The command plan: the model's answer → what andy does, as typed Commands. A port of the old bot's
// src/agent/laya/command.js plan() with every command present (the new bot has all 18): the same thresholds,
// defaults, item choices and replies. Each Command equals what parseLegacy gives for the old plan's line
// (bot/test/command.test.ts checks it through log/legacyLine).

import type { Command } from '../../types/commands.js';
import type { Carried } from '../../types/facts.js';
import { CROPS, type Crop, type Ore } from '../../types/jobs.js';
import type { CommandAsked } from './answer.js';
import { huntFor, resolve } from './resolve.js';
import { FOODS, NONE, type CommandPrompt } from './vocab.js';

/** The old DEFAULTS (decision_models.tasks.command overrides them). */
export interface CommandOptions {
    /** Command's top probability to act on it. */
    min_confidence: number;
    /** Below this the message may not be for me: the canned reply. */
    addressed_min: number;
    /** Below this it's for someone else: ignored. */
    ignore_below: number;
    follow_distance: number;
    come_distance: number;
    /** Counts when the message says none. */
    gather_count: number;
    mine_count: number;
    craft_count: number;
    /** The most a farm count asks for. */
    farm_max: number;
}
export const COMMAND_DEFAULTS: Readonly<CommandOptions> = {
    min_confidence: 0.6, addressed_min: 0.5, ignore_below: 0.15, follow_distance: 3, come_distance: 2,
    gather_count: 8, mine_count: 4, craft_count: 1, farm_max: 640,
};

/** Why the model's answer isn't acted on (the old plan's `llm` reasons; the bot answers with the canned line). */
export const CANNED_WHYS = ['no-answer', 'not-sure-addressed', 'chat', 'low-confidence', 'malformed', 'unknown-command'] as const;
export type CannedWhy = (typeof CANNED_WHYS)[number];

export type CommandPlan =
    /** Say `say` (when set), then run the commands in order. doneSay: what to say when the job ends done (home). */
    | { kind: 'run'; commands: Command[]; say?: string; doneSay?: string }
    | { kind: 'reply'; text: string }
    | { kind: 'canned'; why: CannedWhy }
    | { kind: 'ignore' };

export interface CommandContext {
    speaker: string;
    message: string;
    /** What andy carries, the same items merged, in slot order (mergeCarry). */
    carry: readonly Carried[];
    /** The nearest hostile's name within 16, or null. */
    nearestHostile: string | null;
    prompt: CommandPrompt;
    opts?: Partial<CommandOptions>;
}

/** mergeCarry: inventory stacks with the same items merged, in slot order (the old carried()). */
export function mergeCarry(items: readonly Carried[]): Carried[] {
    const out: Carried[] = [];
    for (const it of items) {
        const s = out.find(x => x.name === it.name);
        if (s) s.count += it.count; else out.push({ name: it.name, count: it.count });
    }
    return out;
}

/** MINE_ORE: the ore the mine job takes for the item mine gets; other items aren't ores and are gathered. */
const MINE_ORE: Readonly<Record<string, Ore>> = {
    coal: 'coal', raw_copper: 'copper', raw_iron: 'iron', lapis_lazuli: 'lapis', raw_gold: 'gold', redstone: 'redstone', diamond: 'diamond',
};

/** Foods eaten when "eat" names none, best first; bad foods aren't chosen. */
export const GOOD_FOODS = ['golden_carrot', 'cooked_beef', 'cooked_porkchop', 'cooked_mutton', 'cooked_salmon', 'baked_potato', 'bread',
    'cooked_chicken', 'cooked_cod', 'pumpkin_pie', 'mushroom_stew', 'carrot', 'apple', 'beetroot', 'melon_slice', 'sweet_berries', 'cookie',
    'dried_kelp', 'potato'] as const;

/** Items "store everything" keeps: tools, weapons, armour, food, and the coal, charcoal, torches and sticks the mine needs. */
const KEEP_NAMES = new Set(['shield', 'shears', 'flint_and_steel', 'fishing_rod', 'bow', 'crossbow', 'trident', 'mace',
    'turtle_helmet', 'elytra', 'coal', 'charcoal', 'torch', 'stick']);
export const keepWhenStoring = (n: string): boolean =>
    /_(pickaxe|axe|sword|shovel|hoe|helmet|chestplate|leggings|boots)$/.test(n) || KEEP_NAMES.has(n) || FOODS.includes(n);

/** named: an item as andy says it with its count ("8 logs", "1 wooden sword"). */
const PLURAL: Readonly<Record<string, string>> = { log: 'logs', stick: 'sticks', torch: 'torches', bone: 'bones', arrow: 'arrows', egg: 'eggs' };
export const named = (item: string, n: number): string => (n !== 1 && PLURAL[item] ? PLURAL[item] : item.replace(/_/g, ' '));

/** Mobs and animal drops a message may name when the model answers gather or attack with item none. */
export const MESSAGE_MOBS = ['cow', 'pig', 'sheep', 'chicken', 'rabbit', 'goat', 'horse', 'zombie', 'skeleton', 'spider', 'creeper',
    'enderman', 'witch', 'slime', 'drowned', 'husk', 'stray', 'phantom', 'pillager', 'cave_spider', 'zombie_villager'] as const;
export const DROP_ANIMAL: Readonly<Record<string, string>> = { beef: 'cow', steak: 'cow', leather: 'cow', porkchop: 'pig', pork: 'pig',
    mutton: 'sheep', wool: 'sheep', chicken: 'chicken', feather: 'chicken', feathers: 'chicken', rabbit: 'rabbit' };

/** mobIn: a mob named in a message (longest name first: cave_spider before spider), or null. */
export function mobIn(message: string): string | null {
    const words = String(message || '').toLowerCase().replace(/[^a-z_ ]/g, ' ').split(/\s+/).map(w => w.replace(/s$/, ''));
    const joined = `_${words.join('_')}_`;
    return [...MESSAGE_MOBS].sort((a, b) => b.length - a.length).find(m => joined.includes(`_${m}_`)) ?? null;
}

/** dropIn: an animal drop named in a message and its animal, or null. */
export function dropIn(message: string): { drop: string; animal: string } | null {
    const words = String(message || '').toLowerCase().replace(/[^a-z ]/g, ' ').split(/\s+/);
    for (const w of words) {
        const animal = DROP_ANIMAL[w] ?? DROP_ANIMAL[w.replace(/s$/, '')];
        if (animal) return { drop: w.replace(/s$/, ''), animal };
    }
    return null;
}

/** openEnded: a count that means "keep going" (none said). */
const openEnded = (count: string) => count === 'any' || count === 'all';

function countOf(answer: string, fallback: number): number {
    const n = Number.parseInt(answer, 10);
    return Number.isFinite(n) ? n : fallback;
}

/** plan turns the model's answer (null: none to act on) into what to do. */
export function plan(a: CommandAsked | null, ctx: CommandContext): CommandPlan {
    const o: CommandOptions = { ...COMMAND_DEFAULTS, ...(ctx.opts ?? {}) };
    if (!a) return { kind: 'canned', why: 'no-answer' };
    if (a.addressed < o.ignore_below) return { kind: 'ignore' };
    if (a.addressed < o.addressed_min) return { kind: 'canned', why: 'not-sure-addressed' };
    const command = a.command;
    if (command === 'chat') return { kind: 'canned', why: 'chat' };
    if (a.p < o.min_confidence) return { kind: 'canned', why: 'low-confidence' };
    const key = a.item, tier = a.tier, count = a.count;
    const carry = ctx.carry;
    const item = resolve(command, key, tier, carry, ctx.prompt);
    const held = (name: string) => carry.filter(s => s.name === name).reduce((n, s) => n + s.count, 0);
    const job = (j: Extract<Command, { kind: 'job' }>['job']): Command => ({ kind: 'job', job: j });
    const run = (commands: Command[], say?: string): CommandPlan => (say === undefined ? { kind: 'run', commands } : { kind: 'run', commands, say });
    const reply = (text: string): CommandPlan => ({ kind: 'reply', text });
    const player = ctx.speaker;

    switch (command) {
        case 'follow':
            return run([job({ kind: 'follow', player, distance: o.follow_distance })], 'Following you.');
        case 'come':
            return run([job({ kind: 'come', player, distance: o.come_distance })], 'On my way.');
        case 'stop':
            return run([{ kind: 'stop' }]);
        case 'stay':
            return run([job({ kind: 'stay', seconds: -1 })], "I'll stay here.");
        case 'inventory':
            return run([{ kind: 'inventory' }]);
        case 'chores_on': // v2.2: "andy do your chores"
            return run([{ kind: 'chores', on: true }]);
        case 'chores_off': // v2.2: "andy take a break"
            return run([{ kind: 'chores', on: false }]);
        case 'gather': {
            if (item === NONE) {
                const d = dropIn(ctx.message);
                if (d) return run([job({ kind: 'hunt', mob: d.animal, item: null, count: 1 })], `Hunting a ${d.animal} for ${d.drop}.`);
                return reply('What should I gather?');
            }
            const n = Math.min(64, countOf(count, o.gather_count));
            // a drop (v2.1: beef, leather, ...; wool, string): hunt its mob until the count
            const mob = huntFor(item);
            if (mob) return run([job({ kind: 'hunt', mob, item, count: n })], `Hunting ${mob}s for ${n} ${item}.`);
            return run([job({ kind: 'gather', item, count: n })], `Gathering ${n} ${named(item, n)}.`);
        }
        case 'mine': {
            if (item === NONE) return reply('What should I mine for? Iron, coal, diamonds…');
            const ore = MINE_ORE[item];
            // "mine some iron": until stopped
            if (ore && openEnded(count)) return run([job({ kind: 'mine', ore, count: 'forever' })], `Mining ${ore} until you say stop.`);
            const n = Math.min(64, countOf(count, o.mine_count));
            if (ore) return run([job({ kind: 'mine', ore, count: n })], `Mining ${n} ${ore}.`);
            return run([job({ kind: 'gather', item, count: n })], `Mining ${n} ${named(item, n)}.`);
        }
        case 'farm': {
            const crop: Crop | 'any' = (CROPS as readonly string[]).includes(item) ? (item as Crop) : 'any';
            const what = crop === 'any' ? 'crops' : crop;
            if (openEnded(count)) return run([job({ kind: 'farm', crop, goal: 'forever' })], `Farming ${what} until you say stop.`);
            const n = Math.min(o.farm_max, countOf(count, o.farm_max));
            return run([job({ kind: 'farm', crop, goal: { count: n } })], `Farming until I've harvested ${n} ${what}.`);
        }
        case 'home': // "this is your chest": the chest by the speaker
            return { kind: 'run', commands: [job({ kind: 'home' })], doneSay: "That's my chest now." };
        case 'craft': {
            if (item === NONE) return reply("I don't know how to make that.");
            const n = Math.min(64, countOf(count, o.craft_count));
            return run([job({ kind: 'craft', item, count: n })], `Making ${n} ${named(item, n)}.`);
        }
        case 'give': {
            if (key === NONE) {
                if (count !== 'all' || !carry.length) return reply(carry.length ? 'What should I give you?' : "I don't have anything.");
                return run(carry.map(s => job({ kind: 'give', player, item: s.name, count: s.count })), 'Here, take everything.');
            }
            if (item === NONE) return reply(`I don't have any ${key}.`);
            const have = held(item);
            const n = openEnded(count) ? have : Math.min(have, countOf(count, have));
            const say = n < countOf(count, n) ? `I only have ${have} ${item}.` : 'Here you go.';
            return run([job({ kind: 'give', player, item, count: n })], say);
        }
        case 'attack': {
            const mob = item !== NONE ? item : mobIn(ctx.message) ?? dropIn(ctx.message)?.animal ?? ctx.nearestHostile;
            if (!mob) return reply("I don't see anything to fight.");
            return run([job({ kind: 'hunt', mob, item: null, count: 1 })], `Attacking the ${mob.replace(/_/g, ' ')}!`);
        }
        case 'store': {
            if (key === NONE) {
                const stacks = carry.filter(s => !keepWhenStoring(s.name));
                if (!stacks.length) return reply('Nothing to store.');
                return run(stacks.map(s => job({ kind: 'store', item: s.name, count: s.count })), 'Putting my things in the chest.');
            }
            if (item === NONE) return reply(`I don't have any ${key}.`);
            const have = held(item);
            const n = openEnded(count) ? have : Math.min(have, countOf(count, have));
            return run([job({ kind: 'store', item, count: n })], `Storing ${n} ${item}.`);
        }
        case 'eat': {
            const food = item !== NONE ? item : GOOD_FOODS.find(f => held(f) > 0);
            if (!food) return reply(key !== NONE ? `I don't have any ${key}.` : "I don't have any food.");
            return run([job({ kind: 'eat', item: food })]);
        }
    }
    return { kind: 'canned', why: 'unknown-command' };
}
