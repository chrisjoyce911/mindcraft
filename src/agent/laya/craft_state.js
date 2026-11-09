// The craft task's state: laya-go's craft prompt v2 (games/craft/prompt), from
// the bot's inventory, the nearby stations and chest, and a goal. The text must
// match laya-go byte for byte: test/laya_craft_state.test.js checks it against
// laya-go's golden request and 300 of its generated situations.
//
//   Craft.
//   Goal iron_pickaxe x1
//   Have planks x3 stick x2 wooden_pickaxe x1
//   Other dirt x12
//   Chest raw_iron x5
//   Near crafting_table yes furnace no chest no
//   Inventory 4/36
//
// Situations use laya-go's generic names: "log" and "planks" stand for every
// wood; everything else keeps its Minecraft name.

import { ITEMS, PICKAXES, FUELS, FOOD_STACKS } from './craft_data.js';

export const VERSION = 'v2';
export const SLOTS = 36;
export const MAX_OTHERS = 4;
export const NONE = 'none';
export const ACTIONS = ['craft', 'smelt', 'gather', 'take', 'place', 'store', 'done'];
export const COUNT_OPTIONS = ['1', '2', '3', '4', '6', '8', '12', '16', '24', '32', '48', '64'];
export { ITEMS };

const byteSort = arr => arr.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

// closure returns every item resolving goal could touch, sorted.
export function closure(goal) {
    const seen = new Set();
    const walk = name => {
        if (seen.has(name)) return;
        seen.add(name);
        const it = ITEMS[name];
        if (it.kind === 'gathered') {
            if (it.tier) walk(PICKAXES[it.tier - 1]);
        } else if (it.kind === 'smelted') {
            walk(it.source); walk('furnace'); walk('planks');
        } else {
            for (const [n] of it.needs) walk(n);
            if (it.table) walk('crafting_table');
            if (name === 'torch') walk('charcoal');
        }
    };
    walk(goal);
    return byteSort([...seen]);
}

// relevant returns the items that can change the plan for goal: its closure,
// the chest's, every pickaxe and every fuel, sorted.
export function relevant(goal) {
    return byteSort([...new Set([...closure(goal), ...closure('chest'), ...PICKAXES, ...FUELS])]);
}

const UNSTACKABLE = new Set(['shears', 'shield', 'bow', 'crossbow', 'trident', 'flint_and_steel', 'fishing_rod']);
const SIXTEEN = new Set(['bucket', 'egg', 'snowball', 'ender_pearl', 'oak_sign']);
const TOOL_SUFFIXES = ['_pickaxe', '_axe', '_shovel', '_hoe', '_sword', '_helmet', '_chestplate', '_leggings', '_boots'];

// stack is an item's stack size, as laya-go's plan.Stack.
export function stack(name) {
    if (FOOD_STACKS[name]) return FOOD_STACKS[name][0];
    if (SIXTEEN.has(name)) return 16;
    if (UNSTACKABLE.has(name)) return 1;
    if (TOOL_SUFFIXES.some(s => name.endsWith(s))) return 1;
    return 64;
}

const slotsFor = (name, n) => (n <= 0 ? 0 : Math.ceil(n / stack(name)));

// used is the slots carried items take.
export function used(have) {
    return Object.entries(have).reduce((u, [n, c]) => u + slotsFor(n, c), 0);
}

export const usedSlots = s => used(s.have) + (s.hidden || 0);

// keep reports whether an item is never stored: unstackables and food that
// isn't bad.
export function keep(name) {
    if (FOOD_STACKS[name]) return FOOD_STACKS[name][1] !== 'bad';
    return stack(name) === 1;
}

// others lists the storable items carried that aren't relevant, largest
// first (slots, then count, then name).
export function others(s) {
    const rel = new Set(relevant(s.goal));
    const out = Object.keys(s.have).filter(n => s.have[n] > 0 && !rel.has(n) && !keep(n));
    return out.sort((a, b) => slotsFor(b, s.have[b]) - slotsFor(a, s.have[a])
        || s.have[b] - s.have[a] || (a < b ? -1 : a > b ? 1 : 0));
}

export const listedOthers = s => others(s).slice(0, MAX_OTHERS);

function list(word, empty, counts, names) {
    const parts = names.filter(n => (counts[n] || 0) > 0).map(n => `${n} x${counts[n]}`);
    return `${word} ${parts.length ? parts.join(' ') : empty}`;
}

const yesNo = b => (b ? 'yes' : 'no');

// state writes a situation: {goal, count, have, chest, tableNear,
// furnaceNear, chestNear, hidden}.
export function state(s) {
    if (!ITEMS[s.goal] || !(s.count >= 1)) throw new Error(`bad craft goal ${s.goal} x${s.count}`);
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

// itemOptions are the Item question's options: the goal's and the chest's
// closure, the listed Other items, then none.
export function itemOptions(s) {
    const set = byteSort([...new Set([...closure(s.goal), ...closure('chest')])]);
    return [...set, ...listedOthers(s), NONE];
}

export function questions(s) {
    return {
        Action: { criteria: ACTIONS.slice(), instructions: 'What should I do next?', type: 'choice' },
        Count: { criteria: COUNT_OPTIONS.slice(), instructions: 'How many?', type: 'choice' },
        Item: { criteria: itemOptions(s), instructions: 'Which item?', type: 'choice' },
    };
}

// countOption is the smallest option of at least n (64 caps it).
export function countOption(n) {
    return COUNT_OPTIONS.find(o => Number(o) >= n) ?? '64';
}

// generic maps a Minecraft item name to laya-go's: every log or stem is "log",
// every planks "planks".
export function generic(name) {
    if (name.endsWith('_log') || name.endsWith('_stem')) return 'log';
    if (name.endsWith('_planks')) return 'planks';
    return name;
}

// counts totals items ({name, count}) by generic name.
export function counts(items) {
    const out = {};
    for (const it of items) {
        const g = generic(it.name);
        out[g] = (out[g] || 0) + it.count;
    }
    return out;
}

// situation builds a situation from the bot's inventory items (main inventory
// and hotbar, {name, count}), the goal, what's near, and the chest's known
// contents (generic counts). The Inventory line is the slots really used when
// that's more than the generic count says (several woods, part stacks).
export function situation(items, goal, count, near, chest = {}) {
    const have = counts(items);
    const s = { goal, count, have, chest, tableNear: !!near.table, furnaceNear: !!near.furnace, chestNear: !!near.chest, hidden: 0 };
    s.hidden = Math.max(0, Math.min(SLOTS, items.length) - used(have));
    return s;
}
