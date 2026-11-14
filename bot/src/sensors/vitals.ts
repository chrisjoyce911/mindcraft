// Vitals: health, hunger, saturation, the best weapon kind and the armour bar (director.js armedOf,
// armorPoints; defend_state.js's per-piece ARMOR table is the same numbers, turtle helmet included).
import type { Armed } from '../types/index.js';

const WEAPON: Record<Exclude<Armed, 'none'>, RegExp> = { sword: /_sword$/, axe: /_axe$/, other: /^(trident|bow|crossbow|mace)$/ };
/** armedOf: the best weapon kind among item names. */
export function armedOf(names: readonly string[]): Armed {
    for (const k of ['sword', 'axe', 'other'] as const) if (names.some(n => WEAPON[k].test(n))) return k;
    return 'none';
}

const ARMOR: Record<string, readonly [number, number, number, number]> = {
    leather: [1, 3, 2, 1], golden: [2, 5, 3, 1], chainmail: [2, 5, 4, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3], netherite: [3, 8, 6, 3],
};
const PIECES = ['helmet', 'chestplate', 'leggings', 'boots'] as const;
/** armorPoints: the armour bar (0–20) for worn item names (Java 1.21). */
export function armorPoints(worn: readonly string[]): number {
    let n = 0;
    for (const name of worn) {
        if (name === 'turtle_helmet') { n += 2; continue; }
        const m = /^(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(name || '');
        const t = m ? ARMOR[m[1]!] : undefined;
        if (m && t) n += t[PIECES.indexOf(m[2] as (typeof PIECES)[number])]!;
    }
    return Math.min(20, n);
}

/** saturation rounded to one decimal (eat_state.js). */
export const roundSaturation = (s: number | null | undefined): number => Math.round((s ?? 0) * 10) / 10;
