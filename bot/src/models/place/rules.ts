// Place rules v1, the options and Harmful (laya-go games/place candidates, Options, qualifies, Decide, Harmful).
// The answer is the best qualifying option, or none:
//   - stations (crafting_table, furnace, chest): no water, farm or path 4-adjacent, and a floor cell 4-adjacent to
//     stand on; best 4-adjacent to a station (C T F), then nearest the centre.
//   - bed: the east neighbour is floor too (the head), neither next to water or farm; best north or south of a bed,
//     then nearest.
//   - torch: a dark floor cell, nearest.
//   - saplings: grass/dirt, at least 3 from the centre, nothing planted, built, wet or farmed within 2; nearest.
// "Nearest" is Chebyshev, then Manhattan distance to the centre, then reading order.
import type { Words } from '../skill/index.js';
import { gridSize, type PlaceSituation } from './render.js';

export const PLACE_RULES = ['station-by-station', 'station', 'bed-by-bed', 'bed', 'torch', 'saplings', 'no-spot'] as const;
export type PlaceRule = (typeof PLACE_RULES)[number];
export const MAX_OPTIONS = 24;
export const NONE = 'none';

/** A grid cell: x east, y south, from the north-west corner. */
export interface GridCell { x: number; y: number }

const centre = (s: PlaceSituation): GridCell => ({ x: s.grid.length >> 1, y: s.grid.length >> 1 });
const at = (s: PlaceSituation, c: GridCell): string =>
    c.y < 0 || c.y >= s.grid.length || c.x < 0 || c.x >= s.grid[c.y]!.length ? '#' : s.grid[c.y]![c.x]!;
const isFloor = (b: string) => '.:,;'.includes(b);
const same = (a: GridCell, b: GridCell) => a.x === b.x && a.y === b.y;

/** label: a cell's option text, blocks east/west and north/south of the centre ("E1 N2"; 0 is E and N). */
export function label(s: PlaceSituation, c: GridCell): string {
    const { step } = gridSize(s.item);
    const o = centre(s);
    const dx = (c.x - o.x) * step, dy = (o.y - c.y) * step;
    return `${dx < 0 ? 'W' : 'E'}${Math.abs(dx)} ${dy < 0 ? 'S' : 'N'}${Math.abs(dy)}`;
}

function surface(s: PlaceSituation, b: string): boolean {
    switch (s.item) {
        case 'saplings': return b === '.' || b === ',';
        case 'torch': return b === ',' || b === ';';
        default: return isFloor(b);
    }
}

const ring = (s: PlaceSituation, c: GridCell) => { const o = centre(s); return Math.max(Math.abs(c.x - o.x), Math.abs(c.y - o.y)); };

/** less: Chebyshev, then Manhattan distance to the centre, then reading order. */
function less(s: PlaceSituation, a: GridCell, b: GridCell): boolean {
    const o = centre(s);
    const ca = ring(s, a), cb = ring(s, b);
    if (ca !== cb) return ca < cb;
    const ma = Math.abs(a.x - o.x) + Math.abs(a.y - o.y), mb = Math.abs(b.x - o.x) + Math.abs(b.y - o.y);
    if (ma !== mb) return ma < mb;
    return a.y < b.y || (a.y === b.y && a.x < b.x);
}
const cmp = (s: PlaceSituation) => (a: GridCell, b: GridCell) => (less(s, a, b) ? -1 : less(s, b, a) ? 1 : 0);
const reading = (a: GridCell, b: GridCell) => a.y - b.y || a.x - b.x;

/** candidates: the offered cells: the surface fits, at most the 24 nearest, in reading order. */
export function candidates(s: PlaceSituation): GridCell[] {
    const cs: GridCell[] = [];
    const o = centre(s);
    for (let y = 0; y < s.grid.length; y++) {
        for (let x = 0; x < s.grid[y]!.length; x++) {
            const c = { x, y };
            if (!same(c, o) && surface(s, at(s, c)) && (s.item !== 'saplings' || ring(s, c) >= 3)) cs.push(c);
        }
    }
    cs.sort(cmp(s));
    return cs.slice(0, MAX_OPTIONS).sort(reading);
}

/** placeOptions: the Target question's options. */
export const placeOptions = (s: PlaceSituation): string[] => [...candidates(s).map(c => label(s, c)), NONE];

const N4: readonly GridCell[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];
const next4 = (s: PlaceSituation, c: GridCell, chars: string) => N4.some(d => chars.includes(at(s, { x: c.x + d.x, y: c.y + d.y })));
function within2(s: PlaceSituation, c: GridCell, chars: string): boolean {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        if ((dx !== 0 || dy !== 0) && chars.includes(at(s, { x: c.x + dx, y: c.y + dy }))) return true;
    }
    return false;
}

/** qualifies: c may take the item; preferred: next to a station or bed. */
export function qualifies(s: PlaceSituation, c: GridCell): { ok: boolean; preferred: boolean } {
    const no = { ok: false, preferred: false };
    if (same(c, centre(s)) || !surface(s, at(s, c))) return no;
    switch (s.item) {
        case 'crafting_table': case 'furnace': case 'chest':
            if (next4(s, c, '~f=') || !next4(s, c, '.:,;@')) return no;
            return { ok: true, preferred: next4(s, c, 'CTF') };
        case 'bed': {
            const head = { x: c.x + 1, y: c.y };
            if (!isFloor(at(s, head)) || same(head, centre(s)) || next4(s, c, '~f') || next4(s, head, '~f')) return no;
            return { ok: true, preferred: at(s, { x: c.x, y: c.y - 1 }) === 'B' || at(s, { x: c.x, y: c.y + 1 }) === 'B' };
        }
        case 'torch': return { ok: true, preferred: false };
        case 'saplings':
            if (ring(s, c) < 3 || within2(s, c, 'stCTFB~f=')) return no;
            return { ok: true, preferred: false };
    }
}

export function placeRules(s: PlaceSituation): { words: Words; rule: PlaceRule } {
    let best: GridCell | null = null, pref = false;
    for (const c of candidates(s)) {
        const q = qualifies(s, c);
        if (!q.ok) continue;
        if (best === null || (q.preferred && !pref) || (q.preferred === pref && less(s, c, best))) { best = c; pref = q.preferred; }
    }
    if (best === null) return { words: { Target: NONE }, rule: 'no-spot' };
    let rule: PlaceRule;
    switch (s.item) {
        case 'crafting_table': case 'furnace': case 'chest': rule = pref ? 'station-by-station' : 'station'; break;
        case 'bed': rule = pref ? 'bed-by-bed' : 'bed'; break;
        default: rule = s.item;
    }
    return { words: { Target: label(s, best) }, rule };
}

/** placeHarmful: an offered cell that doesn't qualify (none is never harmful: nothing is placed). */
export function placeHarmful(s: PlaceSituation, got: Words): boolean {
    for (const c of candidates(s)) if (label(s, c) === got.Target) return !qualifies(s, c).ok;
    return false;
}
