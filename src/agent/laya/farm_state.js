// The farm task's state: the 9×9 cells around the bot read from the world,
// what it carries and the adult animals nearby, written as laya-go's farm
// prompt v1 (games/farm/prompt in laya-go). The text must match laya-go byte
// for byte: test/laya_farm.test.js checks it against laya-go's golden request.
//
// Cells, one character each (rows north to south, each west to east, the bot
// in the middle):
//
//   G grass or dirt with water within 4 blocks   L the same with no water near
//   X path, stone, wood: walkable, not tillable  O fence or wall
//   W water   F empty wet farmland   D empty dry farmland
//   crops growing/ripe: wheat 1/2, carrot 3/4, potato 5/6, beetroot 7/8

import { packLine } from './pack.js';

export const SIZE = 9;
export const C = (SIZE - 1) / 2;

// CROPS: the crop blocks, their seed item, cell codes and ripe age.
export const CROPS = [
    { block: 'wheat', name: 'wheat', seed: 'wheat_seeds', growing: '1', ripe: '2', ripeAge: 7 },
    { block: 'carrots', name: 'carrot', seed: 'carrot', growing: '3', ripe: '4', ripeAge: 7 },
    { block: 'potatoes', name: 'potato', seed: 'potato', growing: '5', ripe: '6', ripeAge: 7 },
    { block: 'beetroots', name: 'beetroot', seed: 'beetroot_seeds', growing: '7', ripe: '8', ripeAge: 3 },
];
export const ITEMS = ['hoe', 'water_bucket', 'bone_meal', 'wheat_seeds', 'wheat', 'carrot', 'potato', 'beetroot_seeds', 'beetroot'];
export const KINDS = ['cow', 'sheep', 'pig', 'chicken'];
export const ACTIONS = ['harvest', 'plant', 'till', 'water', 'bone_meal', 'breed', 'wait'];
export const NONE = 'none';
export const MAX_CELLS = 6;
export const ANIMAL_RANGE = 16;

// The three questions (laya-go farm prompt v1).
export function questions(s) {
    return {
        Action: { criteria: ACTIONS.slice(), instructions: 'What should I do next on the farm?', type: 'choice' },
        Item: { criteria: itemOptions(s), instructions: 'Which item should I use?', type: 'choice' },
        Target: { criteria: targetOptions(s), instructions: 'Which cell or animals?', type: 'choice' },
    };
}

const TILLABLE = new Set(['grass_block', 'dirt', 'dirt_path']);
const isFence = n => n.endsWith('_fence') || n.endsWith('_wall') || n.endsWith('_fence_gate');

// cropOf returns the crop for a block, its age and whether it's ripe.
export function cropOf(block) {
    const crop = CROPS.find(c => c.block === block?.name);
    if (!crop) return null;
    const age = block.getProperties?.().age ?? block.metadata ?? 0;
    return { crop, age, ripe: age >= crop.ripeAge };
}

// waterNear reports whether water lies within 4 blocks (Chebyshev) of the
// column, at the ground's level or one above, as Minecraft hydrates farmland.
function waterNear(blockAt, x, y, z) {
    for (let dz = -4; dz <= 4; dz++)
        for (let dx = -4; dx <= 4; dx++)
            for (const yy of [y, y + 1])
                if (blockAt(x + dx, yy, z + dz)?.name === 'water') return true;
    return false;
}

// readCell reads one column: it scans down from feetY + 1 to feetY − 3 for
// the first block that isn't an empty plant (grass, flowers), and returns
// {code, y} with y the ground block's height (the crop's farmland for crops).
export function readCell(blockAt, x, z, feetY) {
    for (let y = feetY + 1; y >= feetY - 3; y--) {
        const b = blockAt(x, y, z);
        if (!b) return { code: 'X', y: feetY - 1 };
        const c = cropOf(b);
        if (c) return { code: c.ripe ? c.crop.ripe : c.crop.growing, y: y - 1 };
        if (b.name === 'water') return { code: 'W', y };
        if (isFence(b.name)) return { code: 'O', y };
        if (b.name === 'farmland') return { code: waterNear(blockAt, x, y, z) ? 'F' : 'D', y };
        if (TILLABLE.has(b.name)) return { code: waterNear(blockAt, x, y, z) ? 'G' : 'L', y };
        if (b.boundingBox === 'block') return { code: 'X', y };
    }
    return { code: 'X', y: feetY - 1 };
}

// carried sums the inventory into the game's items, in ITEMS order (any hoe
// counts as hoe).
export function carried(items) {
    const counts = {};
    for (const it of items) {
        const name = it.name.endsWith('_hoe') ? 'hoe' : it.name;
        if (ITEMS.includes(name)) counts[name] = (counts[name] || 0) + it.count;
    }
    return ITEMS.filter(n => counts[n] > 0).map(n => ({ item: n, count: counts[n] }));
}

// herds counts adult animals ({kind, x, z, baby}) within ANIMAL_RANGE of the
// bot, in KINDS order.
export function herds(animals, bx, bz) {
    const counts = {};
    for (const a of animals) {
        if (!KINDS.includes(a.kind) || a.baby || Math.hypot(a.x - bx, a.z - bz) > ANIMAL_RANGE) continue;
        counts[a.kind] = (counts[a.kind] || 0) + 1;
    }
    return KINDS.filter(k => counts[k] > 0).map(k => ({ kind: k, count: counts[k] }));
}

// readFarm reads the situation around a bot at column (bx, bz) with feet at
// feetY: {grid (rows of codes), ys (ground heights), carry, animals}.
export function readFarm(blockAt, bx, feetY, bz, items, animals) {
    const grid = [], ys = [];
    for (let z = 0; z < SIZE; z++) {
        const row = [], yrow = [];
        for (let x = 0; x < SIZE; x++) {
            const cell = readCell(blockAt, bx + x - C, bz + z - C, feetY);
            row.push(cell.code);
            yrow.push(cell.y);
        }
        grid.push(row);
        ys.push(yrow);
    }
    if (grid[C][C] === 'W' || grid[C][C] === 'O') grid[C][C] = 'X';
    return { grid, ys, carry: carried(items), animals: herds(animals, bx, bz) };
}

// state writes the situation as prompt v1's state text.
export function state(s) {
    const carry = s.carry.length ? s.carry.map(c => ` ${c.item} x${c.count}`).join('') : ' none';
    const animals = s.animals.length ? s.animals.map(h => ` ${h.kind} ${h.count}`).join('') : ' none';
    return ['Farm.', 'Carry' + carry, 'Animals' + animals, ...s.grid.map(r => r.join(''))].join('\n');
}

// cellName writes a cell (column x, row z of the grid) as its offset from
// the bot: "E2 N1", "W3 S0".
export function cellName(x, z) {
    const dx = x - C, dz = z - C;
    return `${dx < 0 ? 'W' + -dx : 'E' + dx} ${dz < 0 ? 'N' + -dz : 'S' + dz}`;
}

// parseCellName reads an offset name back to grid {x, z}, or null.
export function parseCellName(name) {
    const m = /^([EW])(\d+) ([NS])(\d+)$/.exec(name);
    if (!m) return null;
    const x = C + (m[1] === 'W' ? -1 : 1) * Number(m[2]), z = C + (m[3] === 'N' ? -1 : 1) * Number(m[4]);
    return x >= 0 && z >= 0 && x < SIZE && z < SIZE ? { x, z } : null;
}

// BY_DISTANCE: every cell nearest first, ties to the north, then the west
// (laya-go rules.ByDistance).
export const BY_DISTANCE = (() => {
    const ps = [];
    for (let z = 0; z < SIZE; z++) for (let x = 0; x < SIZE; x++) ps.push({ x, z });
    const d = p => (p.x - C) ** 2 + (p.z - C) ** 2;
    return ps.map((p, i) => [p, i]).sort((a, b) => d(a[0]) - d(b[0]) || a[1] - b[1]).map(([p]) => p);
})();

const isRipe = c => CROPS.some(cr => cr.ripe === c);
const isGrowing = c => CROPS.some(cr => cr.growing === c);
const interesting = c => isRipe(c) || isGrowing(c) || c === 'F' || c === 'D' || c === 'G';

function nearest(grid, match) {
    return BY_DISTANCE.find(p => match(grid[p.z][p.x])) || null;
}

// nearestDry: the nearest dry ground cell other than the bot's own (where a
// pond goes; laya-go nearestDry).
function nearestDry(grid) {
    return BY_DISTANCE.slice(1).find(p => grid[p.z][p.x] === 'L') || null;
}

// targetOptions are the Target question's options (laya-go
// rules.TargetOptions).
export function targetOptions(s) {
    const pick = new Set();
    const key = p => p.z * SIZE + p.x;
    for (const m of [isRipe, c => c === 'F', c => c === 'D', c => c === 'G', isGrowing]) {
        const p = nearest(s.grid, m);
        if (p) pick.add(key(p));
    }
    // v2 (a crop is set): the nearest dry ground, a pond's place
    if (s.crop) {
        const p = nearestDry(s.grid);
        if (p) pick.add(key(p));
    }
    for (const p of BY_DISTANCE) {
        if (pick.size >= MAX_CELLS) break;
        if (interesting(s.grid[p.z][p.x])) pick.add(key(p));
    }
    const out = BY_DISTANCE.filter(p => pick.has(key(p))).map(p => cellName(p.x, p.z));
    return [...out, ...s.animals.map(h => h.kind), NONE];
}

// itemOptions are the Item question's options: the carried items, then none.
export function itemOptions(s) {
    return [...s.carry.map(c => c.item), NONE];
}

// ---- Prompt v2 (laya-go farm-v2): the crop being farmed, the pack line and
// the Unload question; actions for a dry place.

// FARM_CROPS: the Crop line's values, and the produce item each counts.
export const FARM_CROPS = ['wheat', 'carrots', 'potatoes', 'beetroot', 'any'];
export const PRODUCE = { wheat: ['wheat'], carrots: ['carrot'], potatoes: ['potato'], beetroot: ['beetroot'] };
PRODUCE.any = [...PRODUCE.wheat, ...PRODUCE.carrots, ...PRODUCE.potatoes, ...PRODUCE.beetroot];
// CROP_OF: a FARM_CROPS name to its CROPS entry.
export const CROP_OF = { wheat: CROPS[0], carrots: CROPS[1], potatoes: CROPS[2], beetroot: CROPS[3] };

export const POND = 'pond';
export const FIND_WATER = 'find_water';
export const ACTIONS_V2 = ['harvest', 'plant', 'till', 'water', POND, 'bone_meal', 'breed', FIND_WATER, 'wait'];

const UNLOAD_TEXT = 'I should go and empty my pack into the home chest now.';

// questionsV2: v1's questions with the v2 actions, and Unload.
export function questionsV2(s) {
    return {
        ...questions(s),
        Action: { criteria: ACTIONS_V2.slice(), instructions: 'What should I do next on the farm?', type: 'choice' },
        Unload: { criteria: null, instructions: UNLOAD_TEXT, type: 'noul' },
    };
}

// farmValuables: prompt v2's Valuables for an inventory ({name: count}): the
// harvested crops carried beyond the seeds and food kept (keep is the unload
// keep rule, farm.js farmKeep).
export function farmValuables(inv, keep) {
    let n = 0;
    for (const name of PRODUCE.any) {
        const c = inv[name] || 0;
        n += c - Math.min(c, keep(name, c));
    }
    return n;
}

// stateV2 writes a situation with s.crop and s.pack (pack.js) as prompt v2:
// v1 with the Crop and Pack lines after "Farm.".
export function stateV2(s) {
    const lines = state(s).split('\n');
    lines.splice(1, 0, `Crop ${s.crop}`, packLine(s.pack));
    return lines.join('\n');
}

// ---- Rules: a port of laya-go's games/farm/rules Decide, the answer used
// when the model isn't sure (prompt v2).

const KEEP = 4; // seeds kept back from breeding
const BREED_FOODS = { cow: ['wheat'], sheep: ['wheat'], pig: ['carrot', 'potato', 'beetroot'], chicken: ['wheat_seeds', 'beetroot_seeds'] };
const count = (s, item) => s.carry.find(c => c.item === item)?.count || 0;
const isSeed = item => CROPS.some(c => c.seed === item);

function seedFor(s, p) {
    const want = CROP_OF[s.crop];
    if (want && count(s, want.seed) > 0) return { seed: want.seed, rule: 'plant-crop' };
    const counts = {};
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const x = p.x + dx, z = p.z + dz;
        if ((dx === 0 && dz === 0) || x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
        const cr = CROPS.find(c => c.growing === s.grid[z][x] || c.ripe === s.grid[z][x]);
        if (cr && count(s, cr.seed) > 0) counts[cr.seed] = (counts[cr.seed] || 0) + 1;
    }
    let best = '', n = 0;
    for (const cr of CROPS) if ((counts[cr.seed] || 0) > n) { best = cr.seed; n = counts[cr.seed]; }
    if (best) return { seed: best, rule: 'replant' };
    for (const cr of CROPS) if (count(s, cr.seed) > 0 && (!best || count(s, cr.seed) > count(s, best))) best = cr.seed;
    return { seed: best, rule: 'plant' };
}

function breedFood(s, kind) {
    const spare = f => count(s, f) - (isSeed(f) ? KEEP : 0);
    let best = '';
    for (const f of BREED_FOODS[kind]) if (spare(f) >= 2 && (!best || spare(f) > spare(best))) best = f;
    return best || null;
}

// farmCell: part of a farm, or one without needing water (laya-go farmCell).
const farmCell = c => isRipe(c) || isGrowing(c) || c === 'G' || c === 'F' || c === 'D';

// hasWater reports whether the view has water or anything hydrated by it.
export function hasWater(grid) {
    return grid.some(r => r.some(c => c === 'W' || c === 'G' || c === 'F'));
}

// growing reports whether any crop in the view is still growing.
export function growing(grid) {
    return grid.some(r => r.some(isGrowing));
}

// decide returns the rules' answer {action, target, item, rule}; prompt v2
// rules when the situation has a crop (s.crop).
export function decide(s) {
    const g = s.grid, near = m => nearest(g, m);
    const d = (action, p, item, rule) => ({ action, target: typeof p === 'string' ? p : cellName(p.x, p.z), item, rule });
    let p = near(isRipe);
    if (p) return d('harvest', p, NONE, 'harvest');
    const bucket = count(s, 'water_bucket') > 0;
    if (bucket && (p = near(c => c === 'D'))) return d('water', p, 'water_bucket', 'water');
    if (CROPS.some(c => count(s, c.seed) > 0)) {
        if ((p = near(c => c === 'F' || (!bucket && c === 'D')))) {
            const { seed, rule } = seedFor(s, p);
            return d('plant', p, seed, rule);
        }
        if (count(s, 'hoe') > 0 && (p = near(c => c === 'G'))) return d('till', p, 'hoe', 'till');
    }
    if (s.crop) { // v2
        if (bucket && count(s, 'hoe') > 0 && CROPS.some(c => count(s, c.seed) > 0) && (p = nearestDry(g)))
            return d(POND, p, 'water_bucket', 'pond');
        if (!bucket && !near(farmCell)) return d(FIND_WATER, NONE, NONE, 'find_water');
    }
    for (const h of s.animals) {
        if (h.count < 2) continue;
        const f = breedFood(s, h.kind);
        if (f) return d('breed', h.kind, f, 'breed');
    }
    if (count(s, 'bone_meal') > 0 && (p = near(isGrowing))) return d('bone_meal', p, 'bone_meal', 'bone_meal');
    return d('wait', NONE, NONE, 'wait');
}

// pondCell names the nearest dry ground cell other than the bot's own (and
// not skipped: skip(cellName) → bool), or null.
export function pondCell(grid, skip = () => false) {
    const p = BY_DISTANCE.slice(1).find(q => grid[q.z][q.x] === 'L' && !skip(cellName(q.x, q.z)));
    return p ? cellName(p.x, p.z) : null;
}

// besideHole reports whether water poured at a cell ({x, z}) could run off:
// a side cell holds water or its ground is lower (a hole, a drop).
export function besideHole(s, cell) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = cell.x + dx, z = cell.z + dz;
        if (x < 0 || z < 0 || x >= SIZE || z >= SIZE) continue;
        if (s.grid[z][x] === 'W') return true;
        if (s.ys && s.ys[z][x] < s.ys[cell.z][cell.x]) return true;
    }
    return false;
}
