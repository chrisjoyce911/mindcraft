// What andy holds: equip an item, and the best weapon carried (a port of the old bot's hand.js and
// defend_actions.js hold).
import type { ActBot, Hand } from './bot.js';

const TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel|fishing_rod|bow|crossbow|shield|trident|mace)$/;

const tierOf = (name: string): number => { const i = TIERS.indexOf(name.split('_')[0] ?? ''); return i < 0 ? TIERS.length : i; };

/** bestOf: the best-tier name matching re, or null. */
function bestOf(names: readonly string[], re: RegExp): string | null {
    return names.filter(n => re.test(n)).sort((a, b) => tierOf(a) - tierOf(b))[0] ?? null;
}

/** bestWeapon: the best sword, else the best axe (not a pickaxe), or null. */
export function bestWeapon(names: readonly string[]): string | null {
    return bestOf(names, /_sword$/) ?? bestOf(names, /(^|_)axe$/);
}

/**
 * handChoice: what to hold when nothing runs: {equip} an item, {empty} to clear the hand, or null to leave
 * it (the best weapon, else the tool in hand, else the best pickaxe, else nothing).
 */
export function handChoice(items: readonly string[], held: string | null): { equip: string } | { empty: true } | null {
    const weapon = bestWeapon(items);
    if (weapon) return held === weapon ? null : { equip: weapon };
    if (!held || TOOL.test(held)) return null;
    const pick = bestOf(items, /_pickaxe$/);
    return pick ? { equip: pick } : { empty: true };
}

/** hold equips name in hand (no-op when already held or name is none); false when not carried or it failed. */
export async function hold(bot: ActBot, name: string | null, hand: Hand = 'hand'): Promise<boolean> {
    if (!name || name === 'none') return true;
    if (hand === 'hand' && bot.heldItem?.name === name) return true;
    const item = bot.items().find(i => i.name === name);
    if (!item) return false;
    try { await bot.equip(item, hand); return true; } catch { return false; }
}
