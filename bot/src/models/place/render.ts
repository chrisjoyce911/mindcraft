// The place state (laya-go games/place State, prompt v1; skills-spec v1 §4), byte for byte: the item, the grid's
// size and step, and the grid (north row first, west to east) centred on the base centre "@":
//
//   Place.
//   Item furnace
//   Grid 9 step 1
//   #########
//   #..,,...#
//   ...
//
// Cells: "." grass/dirt floor, lit; ":" other floor, lit; "," grass/dirt floor, dark; ";" other floor, dark; "#" not
// standable; "~" water; "f" farmland or crop; "=" path; "C" chest; "T" crafting table; "F" furnace; "B" bed; "t"
// torch; "s" sapling or tree trunk; "@" the centre. Torches use the lit sample grid (7×7, step 3: the chores lit
// points), the rest 9×9 at step 1.
export const VERSION = 'v1';
import { PLACE_ITEMS, type PlaceItem } from '../../types/jobs.js';
export { PLACE_ITEMS, type PlaceItem };
export const isPlaceItem = (s: string): s is PlaceItem => (PLACE_ITEMS as readonly string[]).includes(s);

import { CELLS, gridSize, type Cell } from '../../types/skills.js';
export { CELLS, gridSize, type Cell };

export interface PlaceSituation {
    item: PlaceItem;
    /** n rows of n cells, north first. */
    grid: readonly string[];
}


export function placeState(s: PlaceSituation): string {
    if (!isPlaceItem(s.item)) throw new Error(`bad place state: item ${JSON.stringify(s.item)}`);
    const { n, step } = gridSize(s.item);
    if (s.grid.length !== n) throw new Error(`bad place state: ${s.grid.length} rows, want ${n}`);
    for (const [y, row] of s.grid.entries()) {
        if (row.length !== n) throw new Error(`bad place state: row ${y} is ${JSON.stringify(row)}`);
        for (let x = 0; x < n; x++) {
            const c = row[x]!;
            if (!CELLS.includes(c) || (c === '@') !== (x === (n >> 1) && y === (n >> 1))) {
                throw new Error(`bad place state: cell ${JSON.stringify(c)} at ${x},${y}`);
            }
        }
    }
    return `Place.\nItem ${s.item}\nGrid ${n} step ${step}\n${s.grid.join('\n')}`;
}
