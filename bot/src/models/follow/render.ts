// The follow task's state (a typed port of the old bot's src/agent/laya/follow_state.js): the 9×9 columns
// around the bot written as laya-go's follow prompt v1, or v2 with the Mobs line. The text must match
// laya-go byte for byte (bot/test/follow.test.ts checks it against laya-go's golden requests).
//
// Each cell is one character: its surface and its height relative to the bot, clamped to ±8:
//
//   ground   H G F E D C B A  0  1 2 3 4 5 6 7 8   (−8 … −1, level, +1 … +8)
//   water    P O N M L K J I  W  Q R S T U V X Y
//   harmful  !   (lava, fire, magma, cactus, …: stepping onto it hurts)
//   unknown  ?   (not loaded)

export const WINDOW = 9;
export const MAX_HEIGHT = 8;
/** The follow prompt versions the bot can write (v2 adds the Mobs line, laya-go follow-mobs). */
export const FOLLOW_PROMPTS = ['v1', 'v2'] as const;
export type FollowPrompt = (typeof FOLLOW_PROMPTS)[number];
export const isFollowPrompt = (p: string | undefined): p is FollowPrompt => (FOLLOW_PROMPTS as readonly (string | undefined)[]).includes(p);

/** Hostile mobs the follow model knows (laya-go world.MobKinds): harm is the radius it can hit. */
export const MOB_KINDS = {
    zombie: { harm: 1.5 }, husk: { harm: 1.5 },
    spider: { harm: 1.5 }, cave_spider: { harm: 1.5 },
    creeper: { harm: 2.5 },
    skeleton: { harm: 1.5 }, stray: { harm: 1.5 },
    witch: { harm: 1.5 },
} as const;
export type FollowMobKind = keyof typeof MOB_KINDS;
export const isFollowMob = (k: string): k is FollowMobKind => Object.prototype.hasOwnProperty.call(MOB_KINDS, k);
export const MAX_MOBS = 4;
export const MOB_RANGE = 16;

/** A mob's block column (any entity name; nearMobs keeps the known kinds). */
export interface MobColumn { kind: string; x: number; z: number }
/** A known mob as an offset from the bot. */
export interface RelMob { kind: FollowMobKind; dx: number; dz: number }

export type Surface = 'ground' | 'water' | 'harmful' | 'unknown';
export interface Column { surface: Surface; height: number }

/** A block as the follow state reads it (a mineflayer Block fits). */
export interface FollowBlock { name: string; boundingBox?: string; getProperties?: () => Record<string, unknown> }
export type BlockAt = (x: number, y: number, z: number) => FollowBlock | null;

/** The moves: X east, Z south (north is −Z), as in Minecraft. */
export const MOVES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'wait'] as const;
export type Move = (typeof MOVES)[number];
export const isMove = (m: string): m is Move => (MOVES as readonly string[]).includes(m);
export const OFFSETS: Readonly<Record<Move, readonly [number, number]>> = {
    N: [0, -1], NE: [1, -1], E: [1, 0], SE: [1, 1], S: [0, 1], SW: [-1, 1], W: [-1, 0], NW: [-1, -1], wait: [0, 0],
};

/**
 * nearMobs: the known mobs within MOB_RANGE of the bot's column, nearest first (ties by kind, then z, then x, as
 * laya-go's world.Near), at most MAX_MOBS, as offsets from the bot.
 */
export function nearMobs(mobs: readonly MobColumn[], bx: number, bz: number): RelMob[] {
    const d = (m: MobColumn) => Math.hypot(m.x - bx, m.z - bz);
    return mobs
        .filter((m): m is MobColumn & { kind: FollowMobKind } => isFollowMob(m.kind) && d(m) <= MOB_RANGE)
        .sort((a, b) => d(a) - d(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.z - b.z || a.x - b.x)
        .slice(0, MAX_MOBS)
        .map(m => ({ kind: m.kind, dx: m.x - bx, dz: m.z - bz }));
}

/** playerLine writes the player's offset: "Player E12 N3". */
export function playerLine(dx: number, dz: number): string {
    const x = dx < 0 ? 'W' + -dx : 'E' + dx;
    const z = dz < 0 ? 'N' + -dz : 'S' + dz;
    return `Player ${x} ${z}`;
}

/** mobsLine writes the v2 Mobs line. */
export function mobsLine(rel: readonly RelMob[]): string {
    if (!rel.length) return 'Mobs none';
    return 'Mobs ' + rel.map(m => `${m.kind} ${playerLine(m.dx, m.dz).slice('Player '.length)}`).join(' ');
}

const GROUND = 'HGFEDCBA012345678';
const WATER = 'PONMLKJIWQRSTUVXY';
const HARMFUL = '!';
const UNKNOWN = '?';

const HARMFUL_BLOCKS: ReadonlySet<string> = new Set(['lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'soul_campfire',
    'cactus', 'sweet_berry_bush', 'powder_snow', 'wither_rose']);
const WATER_BLOCKS: ReadonlySet<string> = new Set(['water', 'bubble_column', 'kelp', 'kelp_plant', 'seagrass', 'tall_seagrass']);

const isWall = (name: string) => name.endsWith('_fence') || name.endsWith('_wall') || name.endsWith('_fence_gate') || name === 'iron_bars';
const isClosedDoor = (b: FollowBlock) => b.name.endsWith('_door') && !b.getProperties?.()?.open;
/** standable: a block the bot can stand on (solid) or in (water, lava). */
const standable = (b: FollowBlock) => WATER_BLOCKS.has(b.name) || b.name === 'lava' || b.boundingBox === 'block' || isClosedDoor(b);
/** passable: a block the bot's body can be in. Water and lava are not. */
const passable = (b: FollowBlock) => b.boundingBox === 'empty' && !WATER_BLOCKS.has(b.name) && b.name !== 'lava' && !isClosedDoor(b);

/**
 * readColumn reads one column. Between base − 8 and base + 8 it finds the places a bot could stand (a standable
 * block with two passable blocks above) and takes the one nearest the bot's level (the lower on a tie). With
 * nowhere to stand, an open column is a deep drop and a filled one is a wall. height is the stand block's Y.
 */
export function readColumn(blockAt: BlockAt, x: number, z: number, base: number): Column {
    const top = base + MAX_HEIGHT, bottom = base - MAX_HEIGHT;
    const blocks = new Map<number, FollowBlock | null>();
    const at = (y: number): FollowBlock | null => {
        if (!blocks.has(y)) blocks.set(y, blockAt(x, y, z));
        return blocks.get(y) ?? null;
    };
    let best: (Column & { y: number }) | null = null;
    let sawSpace = false, sawSolid = false;
    for (let y = top; y >= bottom; y--) {
        const b = at(y), up1 = at(y + 1), up2 = at(y + 2);
        if (!b || !up1 || !up2) return { surface: 'unknown', height: base };
        if (passable(b)) sawSpace = true; else sawSolid = true;
        if (!standable(b) || !passable(up1) || !passable(up2)) continue;
        let height = y;
        if (isWall(b.name) || isClosedDoor(b)) height += 1; // 1.5 blocks high or more: a wall
        let surface: Surface = 'ground';
        if (WATER_BLOCKS.has(b.name)) surface = 'water';
        if (HARMFUL_BLOCKS.has(b.name) || HARMFUL_BLOCKS.has(up1.name) || HARMFUL_BLOCKS.has(up2.name)) surface = 'harmful';
        if (!best || Math.abs(y - base) <= Math.abs(best.y - base)) best = { surface, height, y };
    }
    if (best) return { surface: best.surface, height: best.height };
    if (sawSpace && !sawSolid) return { surface: 'ground', height: bottom }; // a deep drop
    return { surface: 'ground', height: top }; // solid, or no headroom: a wall
}

/** cellChar writes a column relative to the bot's height. */
export function cellChar(col: Column, base: number): string {
    if (col.surface === 'unknown') return UNKNOWN;
    if (col.surface === 'harmful') return HARMFUL;
    const h = Math.max(-MAX_HEIGHT, Math.min(MAX_HEIGHT, col.height - base)) + MAX_HEIGHT;
    return (col.surface === 'water' ? WATER : GROUND)[h] ?? UNKNOWN;
}

/** parseCell reads a cell character back to a column relative to the bot, or null. */
export function parseCell(ch: string): Column | null {
    if (ch === UNKNOWN) return { surface: 'unknown', height: 0 };
    if (ch === HARMFUL) return { surface: 'harmful', height: 0 };
    let i = GROUND.indexOf(ch);
    if (i >= 0) return { surface: 'ground', height: i - MAX_HEIGHT };
    i = WATER.indexOf(ch);
    if (i >= 0) return { surface: 'water', height: i - MAX_HEIGHT };
    return null;
}

export interface FollowWindow {
    state: string;
    /** Rows north to south, each west to east, absolute heights. */
    columns: Column[][];
    /** The bot's base height. */
    base: number;
    /** The known mobs written (v2), [] for v1. */
    mobs: RelMob[];
}

/**
 * readWindow reads the 9×9 window around the bot's column (bx, bz) with feet at Y feetY, and the player's
 * column offset. mobs null writes prompt v1 (no Mobs line); a list writes v2.
 */
export function readWindow(blockAt: BlockAt, bx: number, feetY: number, bz: number, playerDx: number, playerDz: number,
    mobs: readonly MobColumn[] | null = null): FollowWindow {
    const half = (WINDOW - 1) / 2;
    const scanBase = feetY - 1;
    const centre = readColumn(blockAt, bx, bz, scanBase);
    const base = centre.surface === 'unknown' ? scanBase : centre.height;
    const columns: Column[][] = [];
    const rows: string[] = [];
    for (let dz = -half; dz <= half; dz++) {
        const row: Column[] = [];
        let text = '';
        for (let dx = -half; dx <= half; dx++) {
            const col = dx === 0 && dz === 0 ? centre : readColumn(blockAt, bx + dx, bz + dz, scanBase);
            row.push(col);
            text += cellChar(col, base);
        }
        columns.push(row);
        rows.push(text);
    }
    const rel = mobs === null ? null : nearMobs(mobs, bx, bz);
    const head = ['Follow.', playerLine(playerDx, playerDz)];
    if (rel) head.push(mobsLine(rel));
    return { state: [...head, ...rows].join('\n'), columns, base, mobs: rel ?? [] };
}

/** A grid of cells relative to the bot (rows north to south). */
export type Grid = Column[][];

/** parseGrid reads a state's nine rows back to cells relative to the bot, or null. */
export function parseGrid(state: string): Grid | null {
    const lines = state.split('\n');
    const skip = lines[2]?.startsWith('Mobs ') ? 3 : 2;
    if (lines.length !== skip + WINDOW || lines[0] !== 'Follow.') return null;
    const grid: Grid = [];
    for (const row of lines.slice(skip)) {
        if (row.length !== WINDOW) return null;
        const cells = [...row].map(parseCell);
        if (cells.some(c => c === null)) return null;
        grid.push(cells as Column[]);
    }
    return grid;
}
