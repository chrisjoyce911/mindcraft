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

// targetOptions are the Target question's options (laya-go
// rules.TargetOptions).
export function targetOptions(s) {
    const pick = new Set();
    const key = p => p.z * SIZE + p.x;
    for (const m of [isRipe, c => c === 'F', c => c === 'D', c => c === 'G', isGrowing]) {
        const p = nearest(s.grid, m);
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
