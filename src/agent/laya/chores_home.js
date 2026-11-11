// The chores centre (home) and areas: facts computed from the spec
// (openspec/changes/laya-chores, "Home and base centre", "Areas", "The home
// bed is the base"). Pure (no mineflayer): the agent passes what it sees.
//
// The centre, in order:
//   1. the home bed (home_bed: the bed he placed for himself, or last slept in)
//   2. the saved home (home_chest, or home_table when the home is a table)
//   3. a chest or table a player placed (the most recent) → saved as home
//   4. the nearest chest, barrel or table within the 49×49 columns → saved
//   5. the player who last spoke, within 32, on the surface → chores_centre
//   6. his own position → chores_centre
// A saved chores_centre (5, 6) is kept until a home exists; the first chest
// or table he places then becomes the home.

export const BASE = 21;   // base area: 21×21 columns around the centre
export const WORK = 49;   // work area
export const SEARCHES = [49, 97, 193]; // a resource's search grows 49 → 97 → 193 and shrinks back
export const BASE_HEIGHT = 16; // the base area's blocks: within ±16 of the centre's height
export const PLAYER_REACH = 32; // a player's position as the centre: within 32
export const PLACED_NEAR = 5;  // a block a player placed: within 5 of that player

export const TABLES = ['crafting_table'];
export const CHESTS = ['chest', 'trapped_chest', 'barrel'];
export const isBed = name => /_bed$/.test(name || '');
export const isHomeBlock = name => TABLES.includes(name) || CHESTS.includes(name);

const half = size => Math.floor(size / 2);

// inColumns: pos is in the size×size columns around centre (any height).
export function inColumns(centre, pos, size) {
    return Math.abs(Math.floor(pos.x) - Math.floor(centre.x)) <= half(size)
        && Math.abs(Math.floor(pos.z) - Math.floor(centre.z)) <= half(size);
}

// inBase: pos is in the base area (21×21 columns, ±16 high).
export const inBase = (centre, pos) => inColumns(centre, pos, BASE) && Math.abs(Math.floor(pos.y) - Math.floor(centre.y)) <= BASE_HEIGHT;

// searchOf: the smallest search (49, 97, 193) that holds one of the
// positions, or null.
export function searchOf(centre, positions) {
    for (const size of SEARCHES) if (positions.some(p => inColumns(centre, p, size))) return size;
    return null;
}

// reach: the findBlocks distance that covers size×size columns.
export const reach = size => Math.ceil(half(size) * Math.SQRT2) + 1;

const d2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
const at = p => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });

// surfaceOk: the player's position can be the centre: overworld, on solid
// ground, not in water or lava, open sky above.
export const surfaceOk = p => !!p && p.dimension === 'overworld' && p.onGround && !p.inFluid && p.openSky;

// placedBy: who placed a block that just appeared at pos — the nearest
// player within 5 of it when no one else (the bot included) is nearer,
// else null. players: [{name, x, y, z}]; bot: {x, y, z}.
export function placedBy(pos, players, bot) {
    const dist = p => Math.hypot(p.x - pos.x - 0.5, p.y - pos.y, p.z - pos.z - 0.5);
    let best = null;
    for (const p of players) if (dist(p) <= PLACED_NEAR && (!best || dist(p) < dist(best))) best = p;
    if (!best) return null;
    if (bot && dist(bot) < dist(best)) return null;
    return best.name;
}

// chooseCentre picks the centre. w:
//   homeBed, homeChest, homeTable: [x, y, z] (still standing) | null
//   playerPlaced: [{kind: 'chest'|'table', pos, player, at}] (most recent last)
//   nearby: [{kind: 'chest'|'table', pos}] placed blocks within 49×49 of the bot
//   speaker: {name, x, y, z, dimension, onGround, inFluid, openSky, dist} | null
//   saved: {kind: 'player'|'self', pos} | null (chores_centre)
//   self: {x, y, z}
// It returns {home: 'bed'|'chest'|'table'|'player'|'self', pos, save?:
// {place, pos, kind, say}}: save tells the agent what to remember (and
// announce).
export function chooseCentre(w) {
    if (w.homeBed) return { home: 'bed', pos: xyz(w.homeBed) };
    if (w.homeChest && !w.homeTable) return { home: 'chest', pos: xyz(w.homeChest) };
    if (w.homeTable) return { home: 'table', pos: xyz(w.homeTable) };
    const placed = (w.playerPlaced || []).at(-1);
    if (placed) {
        const p = at(placed.pos);
        return { home: placed.kind, pos: p, save: { place: placed.kind === 'table' ? 'home_table' : 'home_chest', pos: p,
            say: `I'll use your ${placed.kind === 'table' ? 'crafting table' : 'chest'} at ${p.x} ${p.y} ${p.z} as home.` } };
    }
    const self = at(w.self);
    const near = (w.nearby || []).filter(b => inColumns(self, b.pos, WORK)).sort((a, b) => d2(a.pos, self) - d2(b.pos, self))[0];
    if (near) {
        const p = at(near.pos);
        return { home: near.kind, pos: p, save: { place: near.kind === 'table' ? 'home_table' : 'home_chest', pos: p,
            say: `I'll use the ${near.kind === 'table' ? 'crafting table' : 'chest'} at ${p.x} ${p.y} ${p.z} as home.` } };
    }
    if (w.saved) return { home: w.saved.kind, pos: at(w.saved.pos) };
    const sp = w.speaker;
    if (sp && sp.dist <= PLAYER_REACH && surfaceOk(sp)) {
        const p = at(sp);
        return { home: 'player', pos: p, save: { place: 'chores_centre', kind: 'player', pos: p } };
    }
    return { home: 'self', pos: self, save: { place: 'chores_centre', kind: 'self', pos: self } };
}

const xyz = a => (Array.isArray(a) ? { x: Math.floor(a[0]), y: Math.floor(a[1]), z: Math.floor(a[2]) } : at(a));

// homeOnPlace: what a block placed by the bot (or by a player) changes.
// kind: 'chest'|'table'|'bed'; by: 'me'|'player'; w: {homeBed, homeChest,
// homeTable, centre {home, pos}}. Returns a list of {place, pos, say?} to
// remember (and forget: pos null).
//   - a bed he placed for himself is the home bed (his first bed placed in
//     make_beds is his: the caller says which); a bed when the home bed is
//     gone, by anyone, becomes the home bed ("My home is now at x y z.")
//   - the first chest or table he places with no home becomes the home
//   - with a table home (or a bed home), the first chest placed in the base
//     area becomes the home chest
export function homeOnPlace(kind, pos, by, w, mine = false) {
    const p = at(pos);
    const out = [];
    if (kind === 'bed') {
        if (!w.homeBed && (mine || by === 'player')) out.push({ place: 'home_bed', pos: p, say: `My home is now at ${p.x} ${p.y} ${p.z}.` });
        return out;
    }
    const noHome = !w.homeBed && !w.homeChest && !w.homeTable;
    if (noHome && by === 'me') {
        out.push({ place: kind === 'table' ? 'home_table' : 'home_chest', pos: p });
        out.push({ place: 'chores_centre', pos: null });
        return out;
    }
    if (kind === 'chest' && w.centre && inBase(w.centre.pos, p) && !(w.homeChest && inBase(w.centre.pos, xyz(w.homeChest))))
        out.push({ place: 'home_chest', pos: p });
    return out;
}

// chestToAdopt: with the home table or a (moved) home bed as the centre, a
// chest found in the base area becomes the home chest when the home chest
// isn't in the base area (nothing is moved out of the old one). chests:
// [{x, y, z}] in the base area. Returns its position or null.
export function chestToAdopt(centre, homeChest, chests) {
    if (!centre || (centre.home !== 'table' && centre.home !== 'bed')) return null;
    if (homeChest && inBase(centre.pos, xyz(homeChest))) return null;
    const c = chests.filter(p => inBase(centre.pos, p)).sort((a, b) => d2(a, centre.pos) - d2(b, centre.pos))[0];
    return c ? at(c) : null;
}
