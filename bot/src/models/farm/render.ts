// The farm state: laya-go's farm prompt v1, or v2 with the crop and the pack line (games/farm/prompt). A typed port
// of the old farm_state.js state/stateV2 and pack.js pack/packLine. The text must match laya-go byte for byte:
// test/farm.state.test.ts checks it against laya-go's golden requests and 400 generated situations.
//
//   Farm.
//   Crop carrots                                                     (v2)
//   Pack 5 Home 12 Health 20 Food 18 Hostiles 0 Valuables 6          (v2)
//   Carry hoe x1 bone_meal x3 ...
//   Animals cow 2 pig 3
//   GGGGGXGGL   (nine rows, north to south)
import type { FarmCrop } from './data.js';
import type { FarmView } from './view.js';

export const MAX_FREE = 36;
export const HOME_CAP = 999;
export const HOSTILES_CAP = 9;
export const VALUABLES_CAP = 999;

/** The pack line's fields (prompt v2). */
export interface Pack {
    /** Empty inventory slots (0–36). */
    free: number;
    /** The home chest's distance (1–999), or null when none is known. */
    home: number | null;
    health: number;
    food: number;
    /** Hostile mobs within 16 blocks (0–9). */
    hostiles: number;
    valuables: number;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** pack builds a pack with every number in range (the old pack.js pack). */
export function pack({ free = MAX_FREE, home = null, health = 20, food = 20, hostiles = 0, valuables = 0 }: Partial<Pack> = {}): Pack {
    return {
        free: clamp(free, 0, MAX_FREE), home: home == null ? null : clamp(home, 1, HOME_CAP),
        health: clamp(health, 0, 20), food: clamp(food, 0, 20),
        hostiles: clamp(hostiles, 0, HOSTILES_CAP), valuables: clamp(valuables, 0, VALUABLES_CAP),
    };
}

export function packLine(p: Pack): string {
    return `Pack ${p.free} Home ${p.home == null ? 'none' : p.home} Health ${p.health} Food ${p.food} Hostiles ${p.hostiles} Valuables ${p.valuables}`;
}

/** A farm situation: the view, and with prompt v2 the crop being farmed and the pack. */
export interface FarmSituation extends FarmView {
    crop?: FarmCrop;
    pack?: Pack;
}

/** state writes the situation as prompt v1's state text. */
export function state(s: FarmView): string {
    const carry = s.carry.length ? s.carry.map(c => ` ${c.item} x${c.count}`).join('') : ' none';
    const animals = s.animals.length ? s.animals.map(h => ` ${h.kind} ${h.count}`).join('') : ' none';
    return ['Farm.', 'Carry' + carry, 'Animals' + animals, ...s.grid.map(r => r.join(''))].join('\n');
}

/** stateV2 writes a situation with a crop and a pack as prompt v2: v1 with the Crop and Pack lines after "Farm.". */
export function stateV2(s: FarmSituation & { crop: FarmCrop; pack: Pack }): string {
    const lines = state(s).split('\n');
    lines.splice(1, 0, `Crop ${s.crop}`, packLine(s.pack));
    return lines.join('\n');
}
