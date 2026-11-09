// The follow task's state: the 9×9 columns around the bot read from the world
// and written as laya-go's follow prompt v1 (games/follow/prompt in laya-go).
// The text must match laya-go byte for byte: test/laya_follow_state.test.js
// checks it against laya-go's golden request.
//
// Each cell is one character: its surface and its height relative to the bot,
// clamped to ±8:
//
//   ground   H G F E D C B A  0  1 2 3 4 5 6 7 8   (−8 … −1, level, +1 … +8)
//   water    P O N M L K J I  W  Q R S T U V X Y
//   harmful  !   (lava, fire, magma, cactus, …: stepping onto it hurts)
//   unknown  ?   (not loaded)

export const WINDOW = 9;
export const MAX_HEIGHT = 8;
export const VERSION = 'v1';

const GROUND = 'HGFEDCBA012345678';
const WATER = 'PONMLKJIWQRSTUVXY';
const HARMFUL = '!';
const UNKNOWN = '?';

// The two questions every follow request asks (laya-go prompt v1).
export const MOVES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'wait'];
export const QUESTIONS = {
    Hazard: { criteria: null, instructions: 'A hazard is next to me.', type: 'noul' },
    Move: { criteria: MOVES.slice(), instructions: 'Which way should I step?', type: 'choice' },
};

// Offsets of the moves: X east, Z south (north is −Z), as in Minecraft.
export const OFFSETS = {
    N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1], wait: [0, 0],
};

// Blocks that hurt to stand on or in.
const HARMFUL_BLOCKS = new Set(['lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire',
    'cactus', 'sweet_berry_bush', 'powder_snow', 'wither_rose']);
// Blocks that count as water.
const WATER_BLOCKS = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

const isWall = name => name.endsWith('_fence') || name.endsWith('_wall') || name.endsWith('_fence_gate') || name === 'iron_bars';
const isClosedDoor = block => block.name.endsWith('_door') && !block.getProperties?.()?.open;

// standable: a block the bot can stand on (solid) or in (water, lava).
function standable(block) {
    return WATER_BLOCKS.has(block.name) || block.name === 'lava' || block.boundingBox === 'block' || isClosedDoor(block);
}

// passable: a block the bot's body can be in. Water and lava are not.
function passable(block) {
    return block.boundingBox === 'empty' && !WATER_BLOCKS.has(block.name) && block.name !== 'lava' && !isClosedDoor(block);
}

// readColumn reads one column. blockAt(x, y, z) returns a block
// ({name, boundingBox}) or null when not loaded. Between base − 8 and base + 8
// it finds the places a bot could stand: a standable block with two passable
// blocks above. It takes the one nearest the bot's level (the lower on a tie),
// so a floor wins over a roof or canopy above it, and returns
// {surface: 'ground'|'water'|'harmful'|'unknown', height} with height the
// stand block's Y. With nowhere to stand, an open column is a deep drop and a
// filled one is a wall.
export function readColumn(blockAt, x, z, base) {
    const top = base + MAX_HEIGHT, bottom = base - MAX_HEIGHT;
    const blocks = new Map();
    const at = y => {
        if (!blocks.has(y)) blocks.set(y, blockAt(x, y, z));
        return blocks.get(y);
    };
    let best = null, sawSpace = false, sawSolid = false;
    for (let y = top; y >= bottom; y--) {
        const b = at(y), up1 = at(y + 1), up2 = at(y + 2);
        if (!b || !up1 || !up2) return { surface: 'unknown', height: base };
        if (passable(b)) sawSpace = true; else sawSolid = true;
        if (!standable(b) || !passable(up1) || !passable(up2)) continue;
        let height = y;
        if (isWall(b.name) || isClosedDoor(b)) height += 1; // 1.5 blocks high or more: a wall
        let surface = 'ground';
        if (WATER_BLOCKS.has(b.name)) surface = 'water';
        if (HARMFUL_BLOCKS.has(b.name) || HARMFUL_BLOCKS.has(up1.name) || HARMFUL_BLOCKS.has(up2.name)) surface = 'harmful';
        if (!best || Math.abs(y - base) <= Math.abs(best.y - base)) best = { surface, height, y };
    }
    if (best) return { surface: best.surface, height: best.height };
    if (sawSpace && !sawSolid) return { surface: 'ground', height: bottom }; // a deep drop
    return { surface: 'ground', height: top }; // solid, or no headroom: a wall
}

// cellChar writes a column relative to the bot's height.
export function cellChar(col, base) {
    if (col.surface === 'unknown') return UNKNOWN;
    if (col.surface === 'harmful') return HARMFUL;
    const h = Math.max(-MAX_HEIGHT, Math.min(MAX_HEIGHT, col.height - base)) + MAX_HEIGHT;
    return (col.surface === 'water' ? WATER : GROUND)[h];
}

// parseCell reads a cell character back to {surface, height} relative to the
// bot, or null.
export function parseCell(ch) {
    if (ch === UNKNOWN) return { surface: 'unknown', height: 0 };
    if (ch === HARMFUL) return { surface: 'harmful', height: 0 };
    let i = GROUND.indexOf(ch);
    if (i >= 0) return { surface: 'ground', height: i - MAX_HEIGHT };
    i = WATER.indexOf(ch);
    if (i >= 0) return { surface: 'water', height: i - MAX_HEIGHT };
    return null;
}

// playerLine writes the player's offset: "Player E12 N3".
export function playerLine(dx, dz) {
    const x = dx < 0 ? 'W' + -dx : 'E' + dx;
    const z = dz < 0 ? 'N' + -dz : 'S' + dz;
    return `Player ${x} ${z}`;
}

// readWindow reads the 9×9 window around the bot's column (bx, bz) with feet
// at Y feetY, and the player's column offset. It returns the state text, the
// columns (rows north to south, each west to east, absolute heights) and the
// bot's base height.
export function readWindow(blockAt, bx, feetY, bz, playerDx, playerDz) {
    const half = (WINDOW - 1) / 2;
    const scanBase = feetY - 1;
    const centre = readColumn(blockAt, bx, bz, scanBase);
    const base = centre.surface === 'unknown' ? scanBase : centre.height;
    const columns = [];
    const rows = [];
    for (let dz = -half; dz <= half; dz++) {
        const row = [];
        let text = '';
        for (let dx = -half; dx <= half; dx++) {
            const col = dx === 0 && dz === 0 ? centre : readColumn(blockAt, bx + dx, bz + dz, scanBase);
            row.push(col);
            text += cellChar(col, base);
        }
        columns.push(row);
        rows.push(text);
    }
    const state = ['Follow.', playerLine(playerDx, playerDz), ...rows].join('\n');
    return { state, columns, base };
}

// parseGrid reads a state's nine rows back to cells relative to the bot.
export function parseGrid(state) {
    const lines = state.split('\n');
    if (lines.length !== 2 + WINDOW || lines[0] !== 'Follow.') return null;
    const grid = [];
    for (const row of lines.slice(2)) {
        if (row.length !== WINDOW) return null;
        const cells = [...row].map(parseCell);
        if (cells.includes(null)) return null;
        grid.push(cells);
    }
    return grid;
}
