// Craft a recipe (the old skills.craftRecipe): recipes come from bot.recipesFor (minecraft-data through the
// registry). A recipe that needs a table uses one within 16, else places the carried one (and picks it up again
// after), else fails. One craft at a time, each followed by a wait for the inventory to show it: mineflayer's
// multi-count craft dropped one of three (3 logs gave 8 planks) and left a stale inventory, and the next craft
// could stall on its updateSlot timeout. bot.craft can't be cancelled: on an abort the wait ends at once and the
// craft in flight finishes by itself.
import { race, withTimeout } from '../core/abort.js';
import type { Vec3Like } from '../types/index.js';
import type { Act, ActRecipe } from './bot.js';
import { goNear } from './approach.js';
import { placeStation, takeBack } from './place.js';
import { settle } from './settle.js';

export const TABLE_RANGE = 16;
export const CRAFT_TIMEOUT_MS = 5000;
const TABLE_REACH = 4;

export interface CraftResult { ok: boolean; message: string; cancelled?: boolean }

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const countOf = (a: Act, name: string) => a.bot.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

/** nearestBlock: the nearest block named name within range of andy, or null. */
export function nearestBlock(a: Act, names: readonly string[], range: number): Vec3Like | null {
    const me = a.bot.entity.position;
    return a.bot.findBlocks(names, me, range, 64).sort((p, q) => dist(me, p) - dist(me, q))[0] ?? null;
}

/** limitOf: how many times the recipe can be crafted from what andy carries, and the ingredient that limits it. */
function limitOf(a: Act, r: ActRecipe): { times: number; by: string } {
    let times = Infinity, by = '';
    for (const n of r.needs) {
        const t = Math.floor(countOf(a, n.name) / n.count);
        if (t < times) { times = t; by = n.name; }
    }
    return { times: Number.isFinite(times) ? times : 0, by };
}

/** craftRecipe crafts itemName's recipe num times (at most what the ingredients allow). */
export async function craftRecipe(a: Act, itemName: string, num: number, signal: AbortSignal): Promise<CraftResult> {
    if (!a.bot.hasRecipe(itemName)) return { ok: false, message: `${itemName} is either not an item, or it does not have a crafting recipe!` };
    let recipes = a.bot.recipesFor(itemName, null);
    let table: Vec3Like | null = null;
    let placed: Vec3Like | null = null;
    if (!recipes.length && a.bot.recipesFor(itemName, 'any').length) {
        table = nearestBlock(a, ['crafting_table'], TABLE_RANGE);
        if (!table) {
            if (!a.bot.items().some(i => i.name === 'crafting_table')) return { ok: false, message: `Crafting ${itemName} requires a crafting table.` };
            const p = await placeStation(a, 'crafting_table', signal);
            if (signal.aborted) return { ok: false, message: 'cancelled', cancelled: true };
            if (!p.ok) return { ok: false, message: `Crafting ${itemName} requires a crafting table: I couldn't place mine.` };
            table = placed = p.at;
        }
        recipes = a.bot.recipesFor(itemName, table);
    }
    const putBack = async () => { if (placed && !signal.aborted) await takeBack(a, placed, 'crafting_table', signal); };
    const recipe = recipes[0];
    if (!recipe) {
        await putBack();
        return { ok: false, message: `You do not have the resources to craft a ${itemName}.` };
    }
    if (table && dist(a.bot.entity.position, table) > TABLE_REACH) {
        const o = await goNear(a, table, 3, signal);
        if (signal.aborted) return { ok: false, message: 'cancelled', cancelled: true };
        if (!o.ok) { await putBack(); return { ok: false, message: `Could not reach the crafting table (${o.reason}).` }; }
    }
    const start = countOf(a, itemName);
    const limit = limitOf(a, recipe);
    const times = Math.min(limit.times, num);
    let error: string | null = null;
    for (let i = 0; i < times && !signal.aborted; i++) {
        const before = countOf(a, itemName);
        const t = withTimeout(CRAFT_TIMEOUT_MS, signal);
        try {
            await race(a.bot.craft(recipe, table), t.signal);
        } catch (e) {
            if (signal.aborted) break;
            error = e instanceof Error ? e.message : String(e);
            break;
        } finally { t.dispose(); }
        await settle(() => countOf(a, itemName) >= before + recipe.result, { ms: 2000, quiet: 50, signal });
    }
    if (signal.aborted) return { ok: countOf(a, itemName) > start, message: 'cancelled', cancelled: true };
    await putBack();
    const now = countOf(a, itemName);
    if (error) return { ok: now > start, message: `Failed to craft ${itemName}: ${error}. You now have ${now} ${itemName}.` };
    if (limit.times < num) return { ok: now > start, message: `Not enough ${limit.by} to craft ${num}, crafted ${limit.times}. You now have ${now} ${itemName}.` };
    return { ok: true, message: `Successfully crafted ${itemName}, you now have ${now} ${itemName}.` };
}
