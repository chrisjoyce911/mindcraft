// The craft job's world (the old skills.js layaCraftDeps): what's near, the chest's usable contents, and the six
// actions on generic items through the actuators (gather, craft, smelt, place, take, store).
import { carriedOf, counts, generic, itemDef, isCraftItem, realName } from '../models/craft/index.js';
import type { Act } from '../actuators/bot.js';
import { craftRecipe, nearestBlock, TABLE_RANGE } from '../actuators/craft.js';
import { gatherItem } from '../actuators/gather.js';
import { smeltItem, FURNACE_RANGE } from '../actuators/smelt.js';
import { placeStation } from '../actuators/place.js';
import { deposit, readChest, withdraw } from '../actuators/chest.js';
import { settle } from '../actuators/settle.js';
import { chestItemsForUse, isHomeChest } from '../home/kit.js';
import { HOME_PLACE } from '../home/chest.js';
import type { Vec3Like } from '../types/index.js';
import type { JobDeps } from './deps.js';
import type { CraftWorld } from './craft.js';

export const CHEST_RANGE = 32;
/** Materials a take takes at least TAKE_MIN of at once (not planks x1 four times). */
export const TAKE_IN_BULK = new Set(['planks', 'log', 'stick', 'coal', 'charcoal', 'cobblestone']);
export const TAKE_MIN = 8;

export function craftWorld(a: Act, deps: JobDeps): CraftWorld {
    const items = () => a.bot.items();
    const count = (g: string) => carriedOf(items(), g);
    const chestAt = () => nearestBlock(a, ['chest'], CHEST_RANGE);
    const home = (p: Vec3Like) => isHomeChest(p, deps.places.recall(HOME_PLACE));
    const note = (m: string) => deps.note(`craft: ${m}`);
    const usable = (p: Vec3Like, list: readonly { name: string; count: number }[]) => chestItemsForUse(list, home(p), n => a.bot.isFood(n));
    return {
        items,
        near: () => ({
            table: !!nearestBlock(a, ['crafting_table'], TABLE_RANGE),
            furnace: !!nearestBlock(a, ['furnace'], FURNACE_RANGE),
            chest: !!chestAt(),
        }),
        readChest: async signal => {
            const p = chestAt();
            if (!p) return null;
            const r = await readChest(a, p, signal);
            // the player kit in the home chest isn't there for the taking
            return r.ok ? counts(usable(p, r.items)) : null;
        },
        act: {
            gather: async (g, n, signal) => {
                const r = await gatherItem(a, g, n, signal);
                if (r.message) note(r.message);
                return r.ok;
            },
            craft: async (g, times, signal) => {
                const before = count(g);
                const r = await craftRecipe(a, realName(items(), g, l => a.bot.planksFor(l)), times, signal);
                note(r.message);
                // the inventory can show the craft late ("craft stick failed" with the sticks made): wait for it
                // before calling it failed
                return count(g) > before || await settle(() => count(g) > before, { ms: 3000, quiet: 0, signal });
            },
            smelt: async (g, n, signal) => {
                if (!isCraftItem(g)) return false;
                const def = itemDef(g);
                if (def.kind !== 'smelted') return false;
                const before = count(g);
                const r = await smeltItem(a, realName(items(), def.source, l => a.bot.planksFor(l)), n, signal);
                note(r.message);
                return count(g) > before;
            },
            place: async (g, _n, signal) => {
                const r = await placeStation(a, g, signal);
                if (!r.ok) note(`place ${g}: ${r.outcome.ok ? '' : r.outcome.reason}`);
                return r.ok;
            },
            take: async (g, n, signal) => {
                const p = chestAt();
                if (!p) return false;
                // materials in one withdrawal, not one at a time (planks x1 ×4)
                const bulk = TAKE_IN_BULK.has(g) ? Math.max(n, TAKE_MIN) : n;
                const r = await withdraw(a, p, list => {
                    const use = usable(p, list);
                    // logs and planks: the name the chest really holds
                    const name = g === 'log' || g === 'planks' ? use.find(i => generic(i.name) === g)?.name ?? g : g;
                    const avail = use.filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                    if (!avail) {
                        const any = list.some(i => i.name === name);
                        return { why: any ? `The ${name} in the home chest is the player's kit; I'm leaving it.` : `Could not find any ${name} in the chest.` };
                    }
                    return { name, count: Math.min(bulk, avail) };
                }, signal);
                note(r.ok ? `took ${r.took} ${r.name} from the chest` : r.why ?? `take ${g}: ${r.outcome.ok ? '' : r.outcome.reason}`);
                return r.ok;
            },
            store: async (g, n, signal) => {
                const p = chestAt();
                if (!p) return false;
                const total = count(g);
                if (!total) return false;
                let left = n === -1 ? total : Math.min(n, total);
                // every carried Minecraft name of the generic item (oak and birch logs alike)
                const names = [...new Set(items().filter(i => generic(i.name) === g).map(i => i.name))];
                let stored = 0;
                for (const name of names) {
                    if (left <= 0 || signal.aborted) break;
                    const have = items().filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
                    const k = Math.min(left, have);
                    const o = await deposit(a, p, name, k, signal);
                    if (!o.ok) { note(`store ${name}: ${o.reason}`); break; }
                    left -= k; stored += k;
                }
                if (stored) note(`put ${stored} ${g} in the chest`);
                return stored > 0;
            },
        },
    };
}
