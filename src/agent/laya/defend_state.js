// The defend task's state: laya-go's defend prompt v1 (games/defend/prompt in
// laya-go), written from the bot's health, hunger, armour, gear, the time of
// day, a nearby player and the hostile mobs around it.
// test/laya_defend.test.js checks it against laya-go's golden request.
//
//   Defend.
//   Health 14 Food 12 Armor 8 Night yes Player no
//   Weapons iron_sword bow
//   Arrows 12 Shield yes Apples 1
//   Mobs zombie E2 N2 H20 skeleton W12 S4 H20

export const NONE = 'none';
export const MAX_MOBS = 4;
export const MOB_RANGE = 16;
export const MAX_WEAPONS = 3;
export const PLAYER_NEAR = 8;

// KINDS are laya-go's defend mobs (games/defend/rules.Kinds): full health,
// notice range, ranged, and neutral by day.
export const KINDS = {
    zombie: { health: 20, notice: 8 },
    husk: { health: 20, notice: 8 },
    spider: { health: 16, notice: 8, dayCalm: true },
    cave_spider: { health: 12, notice: 8, dayCalm: true },
    creeper: { health: 20, notice: 8 },
    skeleton: { health: 20, notice: 15, ranged: true },
    stray: { health: 20, notice: 15, ranged: true },
    witch: { health: 26, notice: 12, ranged: true },
};

// WEAPONS are laya-go's weapons in its order: damage × attacks per second.
export const WEAPONS = {
    wooden_sword: 6.4, stone_sword: 8, iron_sword: 9.6, diamond_sword: 11.2, netherite_sword: 12.8,
    wooden_axe: 5.6, stone_axe: 7.2, iron_axe: 8.1, diamond_axe: 9, netherite_axe: 10,
    bow: 0,
};
export const WEAPON_NAMES = Object.keys(WEAPONS);

export const ACTIONS = ['fight', 'flee', 'shield', 'backoff', 'eat', 'ignore'];

// ARMOR is each armour piece's defence points (Java 1.21).
const ARMOR = {
    leather_helmet: 1, leather_chestplate: 3, leather_leggings: 2, leather_boots: 1,
    golden_helmet: 2, golden_chestplate: 5, golden_leggings: 3, golden_boots: 1,
    chainmail_helmet: 2, chainmail_chestplate: 5, chainmail_leggings: 4, chainmail_boots: 1,
    iron_helmet: 2, iron_chestplate: 6, iron_leggings: 5, iron_boots: 2,
    diamond_helmet: 3, diamond_chestplate: 8, diamond_leggings: 6, diamond_boots: 3,
    netherite_helmet: 3, netherite_chestplate: 8, netherite_leggings: 6, netherite_boots: 3,
    turtle_helmet: 2,
};
const ARMOR_SLOTS = [5, 6, 7, 8];
const OFFHAND_SLOT = 45;

// offset writes an offset as laya-go does: "E3 N2".
export function offset(dx, dz) {
    return `${dx < 0 ? 'W' + -dx : 'E' + dx} ${dz < 0 ? 'N' + -dz : 'S' + dz}`;
}

const dist = m => Math.hypot(m.dx, m.dz);

// sortMobs orders mobs nearest first, ties by kind, then dz, then dx
// (laya-go's generate.SortMobs).
export function sortMobs(mobs) {
    return mobs.sort((a, b) => dist(a) - dist(b) || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0) || a.dz - b.dz || a.dx - b.dx);
}

// nearMobs returns the hostile mobs ({kind, x, z, health?} block columns)
// within MOB_RANGE of the bot's column (bx, bz), nearest first, at most
// MAX_MOBS, as {kind, dx, dz, health} with health clamped to 1…full.
export function nearMobs(mobs, bx, bz) {
    const rel = mobs
        .filter(m => KINDS[m.kind])
        .map(m => {
            const full = KINDS[m.kind].health;
            const h = Number.isFinite(m.health) && m.health > 0 ? Math.min(full, Math.max(1, Math.ceil(m.health))) : full;
            return { kind: m.kind, dx: m.x - bx, dz: m.z - bz, health: h, entity: m.entity };
        })
        .filter(m => dist(m) <= MOB_RANGE);
    return sortMobs(rel).slice(0, MAX_MOBS);
}

// chooseWeapons keeps at most MAX_WEAPONS carried weapons, in laya-go's order:
// the bow (when carried) and the best melee weapons by damage per second.
export function chooseWeapons(names) {
    const carried = WEAPON_NAMES.filter(w => names.includes(w));
    if (carried.length <= MAX_WEAPONS) return carried;
    const melee = carried.filter(w => w !== 'bow').sort((a, b) => WEAPONS[b] - WEAPONS[a] || WEAPON_NAMES.indexOf(a) - WEAPON_NAMES.indexOf(b));
    const keep = new Set(melee.slice(0, carried.includes('bow') ? MAX_WEAPONS - 1 : MAX_WEAPONS));
    if (carried.includes('bow')) keep.add('bow');
    return WEAPON_NAMES.filter(w => keep.has(w));
}

// situation reads the bot. mobs are the hostile mobs' block columns
// ({kind, x, z, health?, entity}); playerNear is whether a player to protect
// is within PLAYER_NEAR.
export function situation(bot, mobs, playerNear) {
    const items = bot.inventory.items();
    const slots = bot.inventory.slots || [];
    const count = name => items.filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
    const armor = ARMOR_SLOTS.reduce((n, s) => n + (ARMOR[slots[s]?.name] || 0), 0);
    const bx = Math.floor(bot.entity.position.x), bz = Math.floor(bot.entity.position.z);
    return {
        health: Math.max(1, Math.min(20, Math.floor(bot.health))),
        food: bot.food,
        armor: Math.min(20, armor),
        night: !!bot.time && bot.time.isDay === false,
        playerNear: !!playerNear,
        weapons: chooseWeapons(items.map(i => i.name)),
        arrows: count('arrow'),
        shield: count('shield') > 0 || slots[OFFHAND_SLOT]?.name === 'shield',
        apples: count('golden_apple') + count('enchanted_golden_apple'),
        mobs: nearMobs(mobs, bx, bz),
    };
}

// state writes a situation as defend prompt v1.
export function state(s) {
    const yn = b => (b ? 'yes' : 'no');
    const mobs = s.mobs.length ? s.mobs.map(m => `${m.kind} ${offset(m.dx, m.dz)} H${m.health}`).join(' ') : NONE;
    return [
        'Defend.',
        `Health ${s.health} Food ${s.food} Armor ${s.armor} Night ${yn(s.night)} Player ${yn(s.playerNear)}`,
        `Weapons ${s.weapons.length ? s.weapons.join(' ') : NONE}`,
        `Arrows ${s.arrows} Shield ${yn(s.shield)} Apples ${s.apples}`,
        `Mobs ${mobs}`,
    ].join('\n');
}

// targetOptions are the Target options: "<kind> <n>", then none.
export const targetOptions = s => [...s.mobs.map((m, i) => `${m.kind} ${i + 1}`), NONE];

// questions returns the four defend questions for a situation.
export function questions(s) {
    return {
        Action: { criteria: ACTIONS.slice(), instructions: 'What should I do about the mobs?', type: 'choice' },
        Danger: { criteria: null, instructions: 'I am in danger.', type: 'noul' },
        Target: { criteria: targetOptions(s), instructions: 'Which mob is it about?', type: 'choice' },
        Weapon: { criteria: [...s.weapons, NONE], instructions: 'Which weapon should I hold?', type: 'choice' },
    };
}

// active reports whether a mob is a threat now (laya-go's Situation.Active).
export function active(s, m) {
    const k = KINDS[m.kind];
    if (k.dayCalm && !s.night) return false;
    return dist(m) <= k.notice;
}

export { dist };
