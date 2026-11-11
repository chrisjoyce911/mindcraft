// The craft task's state: laya-go's craft prompt v2 (games/craft/prompt), from andy's inventory, the nearby
// stations and chest, and a goal. A typed port of the old bot's src/agent/laya/craft_state.js. The text must
// match laya-go byte for byte: test/craft.state.test.ts checks it against laya-go's golden request and 300 of
// its generated situations.
//
//   Craft.
//   Goal iron_pickaxe x1
//   Have planks x3 stick x2 wooden_pickaxe x1
//   Other dirt x12
//   Chest raw_iron x5
//   Near crafting_table yes furnace no chest no
//   Inventory 4/36
//
// Situations use laya-go's generic names: "log" and "planks" stand for every wood; everything else keeps its
// Minecraft name.
import { FOOD_STACKS, FUELS, PICKAXES, isCraftItem, itemDef, type CraftItem } from './data.js';

export const VERSION = 'v2';
export const SLOTS = 36;
export const MAX_OTHERS = 4;
export const NONE = 'none';

/** Item counts by generic name. */
export type Counts = Record<string, number>;

/** What andy has and sees, for a goal (the old situation object). */
export interface CraftSituation {
    goal: CraftItem;
    /** The count to have carried (the job's target). */
    count: number;
    have: Counts;
    /** The nearby chest's known contents ({} when unknown or none). */
    chest: Counts;
    tableNear: boolean;
    furnaceNear: boolean;
    chestNear: boolean;
    /** Slots the generic counts don't show (several woods, part stacks). */
    hidden: number;
    /** The chest's contents were read (a take of something it doesn't hold is refused). */
    chestKnown?: boolean;
}

/** Stations close enough to use. */
export interface Near { table: boolean; furnace: boolean; chest: boolean }

/** byteSort: sort by UTF-16 code units, as Go's sort.Strings (never localeCompare). */
export const byteSort = (arr: string[]): string[] => arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/** closure returns every item resolving goal could touch, sorted. */
export function closure(goal: CraftItem): CraftItem[] {
    const seen = new Set<CraftItem>();
    const walk = (name: CraftItem): void => {
        if (seen.has(name)) return;
        seen.add(name);
        const it = itemDef(name);
        if (it.kind === 'gathered') {
            if (it.tier) walk(PICKAXES[it.tier - 1]!);
        } else if (it.kind === 'smelted') {
            walk(it.source as CraftItem); walk('furnace'); walk('planks');
        } else {
            for (const [n] of it.needs) walk(n as CraftItem);
            if (it.table) walk('crafting_table');
            if (name === 'torch') walk('charcoal');
        }
    };
    walk(goal);
    return byteSort([...seen]) as CraftItem[];
}

/** relevant returns the items that can change the plan for goal: its closure, the chest's, every pickaxe and every fuel, sorted. */
export function relevant(goal: CraftItem): string[] {
    return byteSort([...new Set<string>([...closure(goal), ...closure('chest'), ...PICKAXES, ...FUELS])]);
}

const UNSTACKABLE = new Set(['shears', 'shield', 'bow', 'crossbow', 'trident', 'flint_and_steel', 'fishing_rod']);
const SIXTEEN = new Set(['bucket', 'egg', 'snowball', 'ender_pearl', 'oak_sign']);
const TOOL_SUFFIXES = ['_pickaxe', '_axe', '_shovel', '_hoe', '_sword', '_helmet', '_chestplate', '_leggings', '_boots'];

/** stack is an item's stack size, as laya-go's plan.Stack. */
export function stack(name: string): number {
    const f = FOOD_STACKS[name];
    if (f) return f[0];
    if (SIXTEEN.has(name)) return 16;
    if (UNSTACKABLE.has(name)) return 1;
    if (TOOL_SUFFIXES.some(s => name.endsWith(s))) return 1;
    return 64;
}

const slotsFor = (name: string, n: number): number => (n <= 0 ? 0 : Math.ceil(n / stack(name)));

/** used is the slots carried items take. */
export function used(have: Counts): number {
    return Object.entries(have).reduce((u, [n, c]) => u + slotsFor(n, c), 0);
}

export const usedSlots = (s: Pick<CraftSituation, 'have' | 'hidden'>): number => used(s.have) + (s.hidden || 0);

/** keep reports whether an item is never stored: unstackables and food that isn't bad. */
export function keep(name: string): boolean {
    const f = FOOD_STACKS[name];
    if (f) return f[1] !== 'bad';
    return stack(name) === 1;
}

/** others lists the storable items carried that aren't relevant, largest first (slots, then count, then name). */
export function others(s: Pick<CraftSituation, 'goal' | 'have'>): string[] {
    const rel = new Set(relevant(s.goal));
    const have = s.have;
    const out = Object.keys(have).filter(n => (have[n] ?? 0) > 0 && !rel.has(n) && !keep(n));
    return out.sort((a, b) => slotsFor(b, have[b]!) - slotsFor(a, have[a]!)
        || have[b]! - have[a]! || (a < b ? -1 : a > b ? 1 : 0));
}

export const listedOthers = (s: Pick<CraftSituation, 'goal' | 'have'>): string[] => others(s).slice(0, MAX_OTHERS);

function list(word: string, empty: string, counts: Counts, names: readonly string[]): string {
    const parts = names.filter(n => (counts[n] || 0) > 0).map(n => `${n} x${counts[n]}`);
    return `${word} ${parts.length ? parts.join(' ') : empty}`;
}

const yesNo = (b: boolean) => (b ? 'yes' : 'no');

/** state writes a situation (laya-go v2). */
export function craftState(s: CraftSituation): string {
    if (!isCraftItem(s.goal) || !(s.count >= 1)) throw new Error(`bad craft goal ${s.goal} x${s.count}`);
    const rel = relevant(s.goal);
    return [
        'Craft.',
        `Goal ${s.goal} x${s.count}`,
        list('Have', 'nothing', s.have, rel),
        list('Other', 'none', s.have, listedOthers(s)),
        list('Chest', 'none', s.chest || {}, rel),
        `Near crafting_table ${yesNo(s.tableNear)} furnace ${yesNo(s.furnaceNear)} chest ${yesNo(s.chestNear)}`,
        `Inventory ${usedSlots(s)}/${SLOTS}`,
    ].join('\n');
}

/** generic maps a Minecraft item name to laya-go's: every log or stem is "log", every planks "planks". */
export function generic(name: string): string {
    if (name.endsWith('_log') || name.endsWith('_stem')) return 'log';
    if (name.endsWith('_planks')) return 'planks';
    return name;
}

/** counts totals items ({name, count}) by generic name. */
export function counts(items: readonly { name: string; count: number }[]): Counts {
    const out: Counts = {};
    for (const it of items) {
        const g = generic(it.name);
        out[g] = (out[g] || 0) + it.count;
    }
    return out;
}

/** carriedOf: how many of a generic item the items hold. */
export const carriedOf = (items: readonly { name: string; count: number }[], g: string): number =>
    items.reduce((n, i) => (generic(i.name) === g ? n + i.count : n), 0);

/**
 * situation builds a situation from andy's inventory items (main inventory and hotbar, {name, count}), the goal,
 * what's near, and the chest's known contents (generic counts). The Inventory line is the slots really used when
 * that's more than the generic count says (several woods, part stacks).
 */
export function situation(items: readonly { name: string; count: number }[], goal: CraftItem, count: number,
    near: Partial<Near>, chest: Counts = {}): CraftSituation {
    const have = counts(items);
    return {
        goal, count, have, chest, tableNear: !!near.table, furnaceNear: !!near.furnace, chestNear: !!near.chest,
        hidden: Math.max(0, Math.min(SLOTS, items.length) - used(have)),
    };
}

