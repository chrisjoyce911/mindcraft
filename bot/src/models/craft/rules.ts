// The craft rules (the old bot's craft.js check, plan and ingredientFromChest): whether a step is possible, and
// the next step toward the goal by the recipe rules (the oracle laya-go trains the model on, simplified). Pure.
import { FUELS, PICKAXES, isCraftItem, itemDef } from './data.js';
import { keep, NONE, type Counts, type CraftSituation } from './render.js';
import { itemOptions, type CraftAction } from './questions.js';

/** One step: what to do, to which item (a generic name or a listed Other item; none), how many. */
export interface CraftStep { action: CraftAction; item: string; count: number }

/** Why a step can't be done in a situation (check). */
export type CheckWhy =
    | 'goal-not-carried' | 'bad-item' | 'goal-carried' | 'not-gatherable' | 'needs-pickaxe' | 'not-craftable'
    | 'needs-table' | 'not-smeltable' | 'needs-fuel' | 'needs-furnace' | 'not-placeable' | 'not-carried'
    | 'no-chest' | 'not-in-chest' | 'not-storable' | 'unknown-action' | `needs-${string}`;

export const STATIONS = new Set<string>(['crafting_table', 'furnace', 'chest']);

const tierCarried = (have: Counts): number => PICKAXES.reduce((t, p, i) => ((have[p] || 0) > 0 ? i + 1 : t), 0);

/** check returns null when step is possible in situation s, or why not. */
export function check(s: CraftSituation, step: CraftStep): CheckWhy | null {
    const { action, item } = step;
    const have = s.have;
    if (action === 'done') return (have[s.goal] || 0) >= s.count ? null : 'goal-not-carried';
    if (!itemOptions(s).includes(item) || item === NONE) return 'bad-item';
    // the goal is carried: no more of it (a second stone_pickaxe for a goal of 1)
    if (item === s.goal && action !== 'store' && (have[s.goal] || 0) >= s.count) return 'goal-carried';
    const it = isCraftItem(item) ? itemDef(item) : null;
    switch (action) {
        case 'gather':
            if (!it || it.kind !== 'gathered') return 'not-gatherable';
            if ((it.tier || 0) > tierCarried(have)) return 'needs-pickaxe';
            return null;
        case 'craft': {
            if (!it || it.kind !== 'crafted') return 'not-craftable';
            if (it.table && !s.tableNear && !((have.crafting_table ?? 0) > 0)) return 'needs-table';
            for (const [n, c] of it.needs) {
                const name = item === 'torch' && n === 'coal' ? ((have.charcoal || 0) > 0 ? 'charcoal' : 'coal') : n;
                if ((have[name] || 0) < c) return `needs-${name}`;
            }
            return null;
        }
        case 'smelt':
            if (!it || it.kind !== 'smelted') return 'not-smeltable';
            if (!((have[it.source] || 0) > 0)) return `needs-${it.source}`;
            if (!FUELS.some(f => (have[f] || 0) > 0)) return 'needs-fuel';
            if (!s.furnaceNear && !((have.furnace ?? 0) > 0)) return 'needs-furnace';
            return null;
        case 'place':
            if (!STATIONS.has(item)) return 'not-placeable';
            return (have[item] || 0) > 0 ? null : 'not-carried';
        case 'take':
            if (!s.chestNear) return 'no-chest';
            return s.chestKnown && !((s.chest[item] || 0) > 0) ? 'not-in-chest' : null;
        case 'store':
            if (!s.chestNear) return 'no-chest';
            if (keep(item) || !((have[item] || 0) > 0)) return 'not-storable';
            return null;
        default:
            return 'unknown-action';
    }
    // count is checked by the actions themselves (they do at most what's possible)
}

/**
 * plan returns the next step toward the goal by the recipe rules: take it from the chest, gather it (making the
 * pickaxe first), craft it (its ingredients and a table first) or smelt it (source, fuel and furnace first). The
 * runner uses it when the model's step is refused, unsure, or "done" before the goal is carried. null when the
 * goal is carried, or when it can't help.
 */
export function plan(s: CraftSituation): CraftStep | null {
    const have = { ...s.have };
    const seen = new Set<string>();
    const next = (item: string, need: number): CraftStep | null | undefined => {
        if ((have[item] || 0) >= need) return null;
        if (seen.has(item)) return undefined; // a loop: give up
        seen.add(item);
        try {
            const missing = need - (have[item] || 0);
            if (s.chestNear && (s.chest[item] || 0) > 0) return { action: 'take', item, count: Math.min(missing, s.chest[item]!) };
            if (!isCraftItem(item)) return undefined;
            const it = itemDef(item);
            if (it.kind === 'gathered') {
                const tier = it.tier || 0;
                if (tier > tierCarried(have)) return next(PICKAXES[tier - 1]!, 1);
                return { action: 'gather', item, count: Math.min(64, missing) };
            }
            if (it.kind === 'crafted') {
                const times = Math.ceil(missing / it.result);
                for (const [n, c] of it.needs) {
                    const name = item === 'torch' && n === 'coal' && (have.charcoal || 0) > 0 ? 'charcoal' : n;
                    const sub = next(name, c * times);
                    if (sub !== null) return sub;
                }
                if (it.table && !s.tableNear && !((have.crafting_table ?? 0) > 0)) return next('crafting_table', 1);
                return { action: 'craft', item, count: times };
            }
            const sub = next(it.source, missing);
            if (sub !== null) return sub;
            if (!FUELS.some(f => (have[f] || 0) > 0)) return next('coal', 1);
            if (!s.furnaceNear && !((have.furnace ?? 0) > 0)) return next('furnace', 1);
            return { action: 'smelt', item, count: missing };
        } finally { seen.delete(item); }
    };
    return next(s.goal, s.count) || null;
}

/**
 * ingredientFromChest: a craft refused for a missing ingredient (why "needs-<ingredient>") that the nearby chest
 * is known to hold becomes a take of what's missing (torch with coal in the chest: take the coal, then craft).
 */
export function ingredientFromChest(s: CraftSituation, step: CraftStep, why: string | null): CraftStep | null {
    const m = /^needs-(.+)$/.exec(why || '');
    if (!m || step.action !== 'craft' || !s.chestNear) return null;
    const name = m[1]!;
    const inChest = s.chest?.[name] || 0;
    if (inChest <= 0) return null;
    const def = isCraftItem(step.item) ? itemDef(step.item) : null;
    const needs = def && def.kind === 'crafted' ? def.needs : [];
    const need = needs.find(([n]) => n === name || (name === 'charcoal' && n === 'coal'));
    const want = need ? need[1] * Math.max(1, step.count || 1) - (s.have[name] || 0) : 1;
    return { action: 'take', item: name, count: Math.max(1, Math.min(inChest, want)) };
}
