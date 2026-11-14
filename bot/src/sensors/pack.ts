// The pack: free slots, items, worn armour and off-hand, valuables (mine_state.js), food items
// (director: minecraft-data foods minus HARMFUL), and the pure pack-line helpers (pack.js).
import type { Carried, Vec3Like } from '../types/index.js';
import type { SensorBot, SensorEntity } from './bot.js';
import { dist3 } from './bot.js';
import { isHostile } from './mobs.js';

/** VALUABLES count fully in Valuables; coal counts half (mine prompt v2). */
export const VALUABLES = ['diamond', 'emerald', 'raw_iron', 'iron_ingot', 'raw_gold', 'gold_ingot', 'raw_copper', 'redstone', 'lapis_lazuli'] as const;
export const VALUABLES_CAP = 999;
export const HOME_CAP = 999;
export const HOSTILES_CAP = 9;
/** HARMFUL foods aren't counted or eaten (director.js). */
export const HARMFUL: ReadonlySet<string> = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'suspicious_stew']);
export const ARMOR_SLOTS = [5, 6, 7, 8] as const;
export const OFFHAND_SLOT = 45;

/** counts: item name → count over every inventory slot (world.js getInventoryCounts). */
export function counts(slots: readonly (Carried | null | undefined)[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const it of slots) if (it?.name) out[it.name] = (out[it.name] ?? 0) + it.count;
    return out;
}

/** valuables: Valuables for an inventory's counts (coal ÷ 2, capped at 999). */
export function valuables(inv: Readonly<Record<string, number>>): number {
    let n = 0;
    for (const v of VALUABLES) n += inv[v] ?? 0;
    return Math.min(VALUABLES_CAP, n + Math.floor((inv.coal ?? 0) / 2));
}

/** homeDistance: the distance to the home chest as the pack line writes it (1…999), or null. */
export function homeDistance(from: Vec3Like | null | undefined, home: Vec3Like | null | undefined): number | null {
    if (!home || !from) return null;
    return Math.max(1, Math.min(HOME_CAP, Math.ceil(dist3(home, from))));
}

/** countHostiles: hostile entities within range of me. */
export function countHostiles(entities: readonly (SensorEntity | null | undefined)[], me: SensorEntity, hostile: (e: SensorEntity) => boolean = isHostile, range = 16): number {
    let n = 0;
    for (const e of entities) if (e && e !== me && e.position && hostile(e) && dist3(e.position, me.position) <= range) n++;
    return n;
}

export interface PackFacts { free: number; items: Carried[]; worn: string[]; offhand: string | null; valuables: number; foodItems: number }

export function packFacts(bot: SensorBot): PackFacts {
    const items = bot.inventory.items().map(i => ({ name: i.name, count: i.count }));
    const slots = bot.inventory.slots;
    const worn: string[] = [];
    for (const s of ARMOR_SLOTS) { const n = slots[s]?.name; if (n) worn.push(n); }
    return {
        free: bot.inventory.emptySlotCount(),
        items,
        worn,
        offhand: slots[OFFHAND_SLOT]?.name ?? null,
        valuables: valuables(counts(slots)),
        foodItems: items.filter(i => bot.isFood(i.name) && !HARMFUL.has(i.name)).reduce((n, i) => n + i.count, 0),
    };
}
