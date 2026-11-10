// The mine task's state: the 5×5×5 blocks around the bot read from the world
// and written as laya-go's mine prompt v1 or v2 (games/mine/prompt in laya-go;
// v2 adds the mine plan's next step and the pack and home chest lines),
// plus a port of laya-go's mine rules (games/mine/rules): which steps are
// unsafe (the veto) and the best step (the fallback when the model isn't
// sure). The text must match laya-go byte for byte:
// test/laya_mine_state.test.js checks it against laya-go's golden request.
//
// The view has five layers, from just above the bot's head (y+2) to under its
// floor (y−2), each 5×5 with north up; the bot is the centre of the head and
// feet layers. Cells: S solid, A air, W water, L lava, O target ore, B bedrock.

export const SIZE = 5;
const C = 2;
export const ABOVE = 0, HEAD = 1, FEET = 2, FLOOR = 3, BELOW = 4;
export const TORCH_EVERY = 8;
export const SEEN_RANGE = 16;
export const MIN_Y = -59;
// COLLECT_RANGE: with a plan, ore seen further than this is left (laya-go
// rules.CollectRange, the bot's collect_range); LOW_HEALTH: with a plan, a
// step down at this health or less is a stop (rule low-health).
export const COLLECT_RANGE = 12, LOW_HEALTH = 8;

export const TIERS = ['none', 'wooden', 'stone', 'iron', 'diamond'];

// ORES: laya-go's rules.Ores: pickaxe tier, best band of feet heights, the
// ore's blocks and the item mining it drops; best is the level the mine
// plan's staircase goes down to first (mine_plan.js; BEST_LEVEL).
export const BEST_LEVEL = { coal: 45, copper: 48, iron: 16, lapis: 0, gold: -16, redstone: -58, diamond: -58, emerald: 16 };
export const ORES = {
    coal: { tier: 1, lo: 8, hi: 96, blocks: ['coal_ore', 'deepslate_coal_ore'], drop: 'coal', best: BEST_LEVEL.coal },
    copper: { tier: 2, lo: 32, hi: 64, blocks: ['copper_ore', 'deepslate_copper_ore'], drop: 'raw_copper', best: BEST_LEVEL.copper },
    iron: { tier: 2, lo: 8, hi: 24, blocks: ['iron_ore', 'deepslate_iron_ore'], drop: 'raw_iron', best: BEST_LEVEL.iron },
    lapis: { tier: 2, lo: -8, hi: 8, blocks: ['lapis_ore', 'deepslate_lapis_ore'], drop: 'lapis_lazuli', best: BEST_LEVEL.lapis },
    gold: { tier: 3, lo: -24, hi: -8, blocks: ['gold_ore', 'deepslate_gold_ore'], drop: 'raw_gold', best: BEST_LEVEL.gold },
    redstone: { tier: 3, lo: -58, hi: -50, blocks: ['redstone_ore', 'deepslate_redstone_ore'], drop: 'redstone', best: BEST_LEVEL.redstone },
    diamond: { tier: 3, lo: -58, hi: -52, blocks: ['diamond_ore', 'deepslate_diamond_ore'], drop: 'diamond', best: BEST_LEVEL.diamond },
};

// PICKAXES maps a pickaxe to its tier (gold mines like wood, netherite like
// diamond); TIER_PICKAXE is the pickaxe to craft for a tier.
export const PICKAXES = { wooden_pickaxe: 1, golden_pickaxe: 1, stone_pickaxe: 2, iron_pickaxe: 3, diamond_pickaxe: 4, netherite_pickaxe: 4 };
export const TIER_PICKAXE = [null, 'wooden_pickaxe', 'stone_pickaxe', 'iron_pickaxe', 'diamond_pickaxe'];

// THROWAWAY blocks fill lava and water ("block").
export const THROWAWAY = ['cobblestone', 'cobbled_deepslate', 'dirt', 'stone', 'deepslate', 'netherrack', 'andesite', 'diorite', 'granite', 'tuff'];

const WATER_BLOCKS = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);
const HARD_BLOCKS = new Set(['bedrock', 'barrier', 'obsidian', 'crying_obsidian', 'reinforced_deepslate', 'end_portal_frame']);

export const DIRS = ['N', 'E', 'S', 'W'];
export const OFFSET = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

// ACTIONS: the Action question's options, in laya-go's order.
export const ACTIONS = ['collect',
    ...['tunnel', 'down', 'up'].flatMap(k => DIRS.map(d => `${k} ${d}`)),
    'torch', 'block', 'stop'];

export const QUESTIONS = {
    Action: { criteria: ACTIONS.slice(), instructions: 'Which step should I take?', type: 'choice' },
    Hazard: { criteria: null, instructions: 'Lava or water is next to me.', type: 'noul' },
};

// QUESTIONS_V2 adds Unload: whether to empty the pack into the home chest.
export const QUESTIONS_V2 = {
    ...QUESTIONS,
    Unload: { criteria: null, instructions: 'I should go and empty my pack into the home chest now.', type: 'noul' },
};

// MOVE_KINDS are the move steps' kinds, in laya-go's order.
export const MOVE_KINDS = ['tunnel', 'down', 'up'];

// HOME_CAP caps the home chest distance in prompt v2.
export const HOME_CAP = 999;

// homeDistance is the straight-line distance to the home chest as prompt v2
// writes it: rounded up and capped, or null when no home chest is known.
export function homeDistance(from, home) {
    if (!home) return null;
    return Math.min(HOME_CAP, Math.max(1, Math.ceil(Math.hypot(home.x - from.x, home.y - from.y, home.z - from.z))));
}

// cellOf classifies a block (null when not loaded) for an ore's blocks.
export function cellOf(block, oreBlocks) {
    if (!block) return 'S';
    if (block.name === 'lava') return 'L';
    if (WATER_BLOCKS.has(block.name)) return 'W';
    if (oreBlocks.includes(block.name)) return 'O';
    if (HARD_BLOCKS.has(block.name)) return 'B';
    if (block.boundingBox === 'empty') return 'A';
    return 'S';
}

// readView reads the view around feet (bx, by, bz): view[layer][z][x].
export function readView(blockAt, bx, by, bz, oreBlocks) {
    const view = [];
    for (let l = 0; l < SIZE; l++) {
        const layer = [];
        for (let dz = -C; dz <= C; dz++) {
            const row = [];
            for (let dx = -C; dx <= C; dx++) row.push(cellOf(blockAt(bx + dx, by + FEET - l, bz + dz), oreBlocks));
            layer.push(row);
        }
        view.push(layer);
    }
    return view;
}

// at returns the cell at layer l, offset (dx, dz), or S outside the view.
export function at(view, l, dx, dz) {
    if (l < 0 || l >= SIZE || dx < -C || dx > C || dz < -C || dz > C) return 'S';
    return view[l][C + dz][C + dx];
}

// pickTier is the best pickaxe tier in an inventory ({name: count}).
export function pickTier(inv) {
    let t = 0;
    for (const [name, tier] of Object.entries(PICKAXES)) if (inv[name] > 0) t = Math.max(t, tier);
    return t;
}

export function countOf(inv, names) {
    return names.reduce((n, name) => n + (inv[name] || 0), 0);
}

// state writes a situation ({ore, y, pick, torches, blocks, dark, heading,
// seen, view}) as prompt v1; with a plan step (s.plan, e.g. 'down N') it
// writes prompt v2, which adds `Plan <kind> <dir>` and `Pack <free> Home
// <dist|none> Health <h> Food <f> Hostiles <n> Valuables <v>` after the
// status line (s.free empty slots, s.home the home chest distance or null,
// s.health and s.food 0–20, s.hostiles within 16 blocks capped at 9,
// s.valuables from valuables()).
export function state(s) {
    const lines = ['Mine.',
        `Ore ${s.ore} Y ${s.y} Pick ${TIERS[s.pick]} Torches ${s.torches} Blocks ${s.blocks} Dark ${s.dark} Heading ${s.heading}`];
    if (s.plan) lines.push(`Plan ${s.plan}`,
        `Pack ${s.free} Home ${s.home == null ? 'none' : Math.min(s.home, HOME_CAP)} Health ${s.health} Food ${s.food} ` +
        `Hostiles ${Math.min(s.hostiles, HOSTILES_CAP)} Valuables ${Math.min(s.valuables, VALUABLES_CAP)}`);
    lines.push(s.seen > 0 ? `Seen ${s.seen}` : 'Seen none');
    for (let z = 0; z < SIZE; z++) lines.push(s.view.map(layer => layer[z].join('')).join(' '));
    return lines.join('\n');
}

const fluid = c => c === 'W' || c === 'L';
const firm = c => c === 'S' || c === 'O' || c === 'B';

// dug returns the cells a move digs ([layer, dx, dz]) and its new floor.
export function dug(action) {
    const [kind, dir] = action.split(' ');
    if (!dir) return null;
    const [dx, dz] = OFFSET[dir];
    switch (kind) {
    case 'tunnel': return { cells: [[HEAD, dx, dz], [FEET, dx, dz]], floor: [FLOOR, dx, dz] };
    case 'down': return { cells: [[HEAD, dx, dz], [FEET, dx, dz], [FLOOR, dx, dz]], floor: [BELOW, dx, dz] };
    case 'up': return { cells: [[ABOVE, 0, 0], [HEAD, dx, dz], [ABOVE, dx, dz]], floor: [FEET, dx, dz] };
    }
    return null;
}

// unsafe returns why a move is unsafe in a view (laya-go rules.Unsafe), or
// '' when it is safe or isn't a move.
export function unsafe(view, action) {
    const d = dug(action);
    if (!d) return '';
    const key = c => c.join(',');
    const inside = new Set([...d.cells.map(key), key([HEAD, 0, 0]), key([FEET, 0, 0])]);
    for (const [l, dx, dz] of d.cells) {
        const c = at(view, l, dx, dz);
        if (fluid(c)) return 'fluid';
        if (c === 'B') return 'bedrock';
        for (const n of [[l - 1, dx, dz], [l + 1, dx, dz], [l, dx + 1, dz], [l, dx - 1, dz], [l, dx, dz + 1], [l, dx, dz - 1]]) {
            if (!inside.has(key(n)) && fluid(at(view, ...n))) return 'fluid behind';
        }
    }
    if (!firm(at(view, ...d.floor))) return 'no floor';
    return '';
}

// TOUCHING: the cells fluid could flow into the bot from, in laya-go's order.
export const TOUCHING = [[ABOVE, 0, 0], [FLOOR, 0, 0],
    ...[HEAD, FEET].flatMap(l => DIRS.map(d => [l, ...OFFSET[d]]))];

// touching returns the touching cells holding lava or water.
export function touching(view) {
    return TOUCHING.filter(c => fluid(at(view, ...c)));
}

// hazard is laya-go's Hazard truth: fluid within one block of feet or head.
export function hazard(view) {
    for (let l = ABOVE; l <= FLOOR; l++)
        for (let dz = -1; dz <= 1; dz++)
            for (let dx = -1; dx <= 1; dx++)
                if (fluid(at(view, l, dx, dz))) return true;
    return false;
}

// VALUABLES count fully in prompt v2's Valuables; coal counts half.
export const VALUABLES = ['diamond', 'emerald', 'raw_iron', 'iron_ingot', 'raw_gold', 'gold_ingot', 'raw_copper', 'redstone', 'lapis_lazuli'];
export const HOSTILES_CAP = 9, VALUABLES_CAP = 999;

// valuables is prompt v2's Valuables for an inventory ({name: count}).
export function valuables(inv) {
    return Math.min(VALUABLES_CAP, countOf(inv, VALUABLES) + Math.floor((inv.coal || 0) / 2));
}

// unload is laya-go's v2 Unload truth: a home chest is known and no lava or
// water touches the bot, and the pack is full, or nearly full with home
// close, or it carries valuables while in danger (hurt, hungry or mobs).
export function unload(s) {
    if (s.home == null || touching(s.view).length) return false;
    if (s.free <= 2) return true;
    if (s.free <= 6 && s.home <= 24) return true;
    return s.valuables >= 4 && (s.health <= 8 || s.hostiles >= 2 || s.food <= 6);
}

const RIGHT = d => DIRS[(DIRS.indexOf(d) + 1) % 4];
const LEFT = d => DIRS[(DIRS.indexOf(d) + 3) % 4];
const BACK = d => DIRS[(DIRS.indexOf(d) + 2) % 4];
export { RIGHT as rightOf, LEFT as leftOf, BACK as backOf };

// decide is laya-go's rules.Decide: the best step and its rule. With a plan
// step (prompt v2) rule 5 follows the plan when it is safe, else detours.
export function decide(s) {
    const ore = ORES[s.ore];
    if (!ore || s.pick < ore.tier) return { action: 'stop', rule: 'need-pickaxe' };
    if (touching(s.view).length && s.blocks > 0) return { action: 'block', rule: 'block-fluid' };
    if (s.seen > 0 && !(s.plan && s.seen > COLLECT_RANGE)) return { action: 'collect', rule: 'collect' };
    if (s.dark >= TORCH_EVERY && s.torches > 0) return { action: 'torch', rule: 'torch' };
    if (s.plan) {
        const d = followPlan(s);
        if (d.action.startsWith('down') && s.health > 0 && s.health <= LOW_HEALTH) return { action: 'stop', rule: 'low-health' };
        return d;
    }
    let want = 'tunnel', rule = 'branch-mine', order = ['tunnel', 'down', 'up'];
    if (s.y > ore.hi) [want, rule, order] = ['down', 'go-down', ['down', 'tunnel', 'up']];
    else if (s.y < ore.lo) [want, rule, order] = ['up', 'go-up', ['up', 'tunnel', 'down']];
    const h = DIRS.indexOf(s.heading);
    const pref = [h, (h + 1) % 4, (h + 3) % 4, (h + 2) % 4].map(i => DIRS[i]);
    for (const k of order) {
        if (k === 'down' && s.y - 1 < MIN_Y) continue;
        for (const d of pref) {
            const a = `${k} ${d}`;
            if (unsafe(s.view, a) === '') return { action: a, rule: k === want ? rule : 'detour' };
        }
    }
    return { action: 'stop', rule: 'trapped' };
}

// followPlan is laya-go's v2 rule 5: the plan step when it is safe; else the
// plan's kind to the right, left and back of the plan's direction, then the
// other kinds ahead, right, left and back; never down below MIN_Y.
function followPlan(s) {
    const [kind, dir] = s.plan.split(' ');
    const ok = a => !(a.startsWith('down') && s.y - 1 < MIN_Y) && unsafe(s.view, a) === '';
    if (ok(s.plan)) return { action: s.plan, rule: 'follow-plan' };
    const around = [RIGHT(dir), LEFT(dir), BACK(dir)];
    const tries = [...around.map(d => `${kind} ${d}`),
        ...MOVE_KINDS.filter(k => k !== kind).flatMap(k => [dir, ...around].map(d => `${k} ${d}`))];
    for (const a of tries) if (ok(a)) return { action: a, rule: 'detour' };
    return { action: 'stop', rule: 'trapped' };
}

// headingOf turns a mineflayer yaw (0 faces north, increasing anticlockwise)
// into a compass letter.
export function headingOf(yaw) {
    const turns = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
    return ['N', 'W', 'S', 'E'][turns];
}
