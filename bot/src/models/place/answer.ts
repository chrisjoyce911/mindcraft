// The place answer: the Target word → a typed step: a cell as blocks from the centre (dx east, dz south: Minecraft
// x and z, so "E1 N2" is {dx: 1, dz: -2}), or none.
import type { Words } from '../skill/index.js';

export type PlaceStep = { kind: 'cell'; dx: number; dz: number } | { kind: 'none' };

const LABEL = /^([EW])(\d+) ([NS])(\d+)$/;

export function readPlace(w: Words): PlaceStep | null {
    const t = w.Target ?? '';
    if (t === 'none') return { kind: 'none' };
    const m = LABEL.exec(t);
    if (!m) return null;
    const dx = Number(m[2]) * (m[1] === 'W' ? -1 : 1), dz = Number(m[4]) * (m[3] === 'N' ? -1 : 1);
    return { kind: 'cell', dx: dx === 0 ? 0 : dx, dz: dz === 0 ? 0 : dz };
}
