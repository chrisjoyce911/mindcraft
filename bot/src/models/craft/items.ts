// Item names for the craft task: the names people and the command model use for things to make or gather, as
// laya-go's craft items (layaItem), and back from a generic name to the Minecraft name andy uses (realName).
import { isCraftItem, type CraftItem } from './data.js';
import { generic } from './render.js';

/** Names people use for things to gather, as laya-go's craft items (the old skills.js LAYA_ALIASES). */
export const LAYA_ALIASES: Readonly<Record<string, CraftItem>> = {
    iron_ore: 'raw_iron', deepslate_iron_ore: 'raw_iron', coal_ore: 'coal', deepslate_coal_ore: 'coal',
    diamond_ore: 'diamond', deepslate_diamond_ore: 'diamond', stone: 'cobblestone', seeds: 'wheat_seeds', wood: 'log', logs: 'log',
};

/** layaItem maps a Minecraft or everyday item name to laya-go's craft item, or null if the craft model doesn't know it. */
export function layaItem(name: string): CraftItem | null {
    const n = Object.hasOwn(LAYA_ALIASES, name) ? LAYA_ALIASES[name]! : generic(name);
    return isCraftItem(n) ? n : null;
}

/**
 * realName picks a Minecraft name for a generic one from what's carried (the most carried first); planks with none
 * carried follow the most carried log (planksFor reads the log's planks from minecraft-data), else oak_planks.
 */
export function realName(items: readonly { name: string; count: number }[], g: string, planksFor: (log: string) => string | null): string {
    const most = (want: string) => items.filter(i => generic(i.name) === want).sort((a, b) => b.count - a.count)[0];
    const carried = most(g);
    if (carried) return carried.name;
    if (g === 'planks') {
        const log = most('log');
        return (log && planksFor(log.name)) || 'oak_planks';
    }
    return g;
}
