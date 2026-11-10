// The home chest: the remembered place "home_chest" (the chest block's exact
// position) that the Laya tasks unload into. Pure (no mineflayer), so it is
// tested with fakes; pack_actions.js is the game side.
//
// Three ways to set it: !setHomeChest (the chest nearest the player who spoke
// last), the chat command game's "home" command (which runs !setHomeChest),
// and a sign: a sign within SIGN_RANGE whose text has the bot's name, on or
// next to a chest, is adopted when no home chest is saved yet.

export const CHESTS = ['chest', 'trapped_chest', 'barrel'];
export const SET_RANGE = 8;
export const SIGN_RANGE = 32;

export const isChest = b => !!b && CHESTS.includes(b.name);
export const isSign = b => !!b && /_(wall_|hanging_|wall_hanging_)?sign$/.test(b.name);

const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

// nearestChest returns the position of the chest nearest to `at` within
// range, from chest positions [{x, y, z}], or null.
export function nearestChest(chests, at, range = SET_RANGE) {
    let best = null;
    for (const c of chests) if (dist2(c, at) <= range * range && (!best || dist2(c, at) < dist2(best, at))) best = c;
    return best ? { x: best.x, y: best.y, z: best.z } : null;
}

// signText joins a sign's lines (front and back) into one string.
export function signText(block) {
    try {
        const t = block.getSignText?.();
        if (Array.isArray(t)) return t.join('\n');
        if (typeof t === 'string') return t;
    } catch { /* not a sign entity */ }
    return block.signText || '';
}

// signedChest finds a chest marked with the bot's name: signs [{x, y, z,
// text}] (nearest first is best) whose text contains name (any case), with a
// chest within 1 block (any of the 26 neighbours). blockAt(x, y, z) → block.
// It returns the chest's position or null.
export function signedChest(signs, blockAt, name, from = null) {
    const want = String(name).toLowerCase();
    const ordered = from ? [...signs].sort((a, b) => dist2(a, from) - dist2(b, from)) : signs;
    for (const s of ordered) {
        if (!String(s.text || '').toLowerCase().includes(want)) continue;
        let best = null;
        for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy && !dz) continue;
            const p = { x: s.x + dx, y: s.y + dy, z: s.z + dz };
            // a chest straight next to the sign (it's attached to it) wins
            // over a diagonal one
            if (isChest(blockAt(p.x, p.y, p.z)) && (!best || Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < best.d))
                best = { ...p, d: Math.abs(dx) + Math.abs(dy) + Math.abs(dz) };
        }
        if (best) return { x: best.x, y: best.y, z: best.z };
    }
    return null;
}

// chestsAt returns the home chest and the chests touching it (the other half
// of a double chest, chests beside it), home first: where unloading tries
// when the home chest is full.
export function chestsAt(home, blockAt) {
    if (!home || !isChest(blockAt(home.x, home.y, home.z))) return [];
    const out = [{ x: home.x, y: home.y, z: home.z }];
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]) {
        const p = { x: home.x + dx, y: home.y + dy, z: home.z + dz };
        if (isChest(blockAt(p.x, p.y, p.z))) out.push(p);
    }
    return out;
}

// depositAll puts items ([{name, count}]) into the chests in order, trying
// the next when one is full. depositInto(chest, items) → the items it
// couldn't put in ([{name, count}]), or throws. It returns what is left.
export async function depositAll(chests, items, depositInto) {
    let left = items.filter(i => i.count > 0);
    for (const c of chests) {
        if (!left.length) break;
        try {
            left = (await depositInto(c, left)).filter(i => i.count > 0);
        } catch { /* this chest won't open: try the next */ }
    }
    return left;
}
