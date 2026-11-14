// The player kit in the home chest (a typed port of the old bot's chores_state.js kitIn/unreserved and
// skills.js chestItemsForUse): one of each kit tool at its best tier, the first KIT_FOOD cooked food and the first
// KIT_TORCHES torches are the player's and never taken by a job (design §11.1). Pure.
import type { Vec3Like } from '../types/index.js';

export const KIT_FOOD = 8;
export const KIT_TORCHES = 16;
export const KIT_TOOLS = ['pickaxe', 'axe', 'shovel', 'sword'] as const;
export const RAW_MEAT = new Set(['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon']);
export const NOT_FOOD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato']);

const TIER_OF: Readonly<Record<string, number>> = { wooden: 1, golden: 1, stone: 2, iron: 3, diamond: 4, netherite: 4 };
/** toolRank: a tool's tier as a number (wooden and golden 1 … diamond and netherite 4; 0: not a tiered tool). */
export function toolRank(name: string): number {
    const m = /^(wooden|golden|stone|iron|diamond|netherite)_/.exec(name);
    return m ? TIER_OF[m[1]!]! : 0;
}

export interface Stack { name: string; count: number }

/** kitReserved: the kit's items ({name: count}) among a chest's items. isFood(name): minecraft-data's foods. */
export function kitReserved(chestItems: readonly Stack[], isFood: (name: string) => boolean): Record<string, number> {
    const reserved: Record<string, number> = {};
    for (const k of KIT_TOOLS) {
        let top: string | null = null;
        for (const i of chestItems) {
            if (!i.name.endsWith(`_${k}`) || (k === 'axe' && i.name.endsWith('pickaxe'))) continue;
            if (!top || toolRank(i.name) > toolRank(top)) top = i.name;
        }
        if (top) reserved[top] = (reserved[top] || 0) + 1;
    }
    let foodLeft = KIT_FOOD, torchLeft = KIT_TORCHES;
    for (const i of chestItems) {
        if (isFood(i.name) && !RAW_MEAT.has(i.name) && !NOT_FOOD.has(i.name)) {
            const r = Math.min(foodLeft, i.count);
            if (r > 0) { reserved[i.name] = (reserved[i.name] || 0) + r; foodLeft -= r; }
        } else if (i.name === 'torch') {
            const r = Math.min(torchLeft, i.count);
            if (r > 0) { reserved.torch = (reserved.torch || 0) + r; torchLeft -= r; }
        }
    }
    return reserved;
}

/** unreserved: chest items less the reserved kit. */
export function unreserved(chestItems: readonly Stack[], reserved: Readonly<Record<string, number>>): Stack[] {
    const left = { ...reserved };
    const out: Stack[] = [];
    for (const i of chestItems) {
        const r = Math.min(left[i.name] || 0, i.count);
        if (r) left[i.name]! -= r;
        if (i.count - r > 0) out.push({ name: i.name, count: i.count - r });
    }
    return out;
}

/** isHomeChest: the chest at p is the saved home chest (the place's floored position). */
export function isHomeChest(p: Vec3Like, home: readonly [number, number, number] | null | undefined): boolean {
    return !!home && p.x === Math.floor(home[0]) && p.y === Math.floor(home[1]) && p.z === Math.floor(home[2]);
}

/** chestItemsForUse: a chest's items less the player kit when it is the home chest: what a job may take. */
export function chestItemsForUse(items: readonly Stack[], home: boolean, isFood: (name: string) => boolean): Stack[] {
    const all = items.map(i => ({ name: i.name, count: i.count }));
    return home ? unreserved(all, kitReserved(all, isFood)) : all;
}
