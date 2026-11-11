// The chores sensor and actuators (game side, mineflayer). The sensor
// measures the chores shared spec v1's facts around the centre
// (chores_home.js); each actuator runs one chore with existing Mindcraft
// skills and returns {ok, reason}. No chore is chosen here: the chores model
// (or its rules) chose it; an actuator only does it, or says why it couldn't.
//
// Every wait and loop checks bot.interrupt_code, so a player's command or a
// safety mode stops a chore at once.

import Vec3 from 'vec3';
import * as skills from '../library/skills.js';
import * as world from '../library/world.js';
import { bestTiers, haveCounts, kitIn, unreserved, timeWord, biomeWord, toolTier, tier, RAW_MEAT, NOT_FOOD, isSapling, isLog,
    KIT_FOOD, KIT_TORCHES, KIT_TOOLS, kitTier, ANIMALS } from './chores_state.js';
import { BASE, WORK, SEARCHES, BASE_HEIGHT, inColumns, inBase, searchOf, reach, chooseCentre, homeOnPlace, chestToAdopt, CHESTS,
    isBed } from './chores_home.js';

// CAN: the actuators Mindcraft has for the place and smelt chores
// (placeBlock and smeltItem); the chores task's can_place / can_smelt
// settings can mask them (false).
export const CAN = { place: true, smelt: true };

const CROPS = { wheat: 7, carrots: 7, potatoes: 7, beetroots: 3 };
const SEED_OF = { wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots' };
const ANIMAL_DROP = { cow: 'beef', pig: 'porkchop', sheep: 'mutton', chicken: 'chicken', rabbit: 'rabbit', mooshroom: 'beef' };
const GRASS = ['short_grass', 'grass', 'tall_grass', 'fern', 'large_fern'];
const SOLID_GROUND = /(_block|dirt|stone|sand|gravel|podzol|mycelium|clay|terracotta|deepslate|andesite|diorite|granite|tuff|mud|moss_block|snow_block|coarse_dirt|rooted_dirt)$/;
const OPEN = new Set(['air', 'cave_air', 'short_grass', 'grass', 'tall_grass', 'fern', 'large_fern', 'snow', 'dandelion', 'poppy',
    'azure_bluet', 'oxeye_daisy', 'cornflower', 'dead_bush']);

const stopped = bot => !!bot.interrupt_code;
const v = p => new Vec3(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
const blockAt = (bot, x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)); } catch { return null; } };
const ids = (bot, names) => names.map(n => bot.registry.blocksByName[n]?.id).filter(id => id != null);
const nameIs = re => b => re.test(b?.name || '');

// findIn: block positions of names within size×size columns around centre
// (nearest the centre first), optionally ±dy of its height and filtered.
export function findIn(bot, names, centre, size, { count = 32, dy = null, filter = null } = {}) {
    const matching = ids(bot, names);
    if (!matching.length) return [];
    let found = [];
    try {
        found = bot.findBlocks({ matching, point: v(centre), maxDistance: reach(size), count: filter ? count * 4 : count });
    } catch { return []; }
    return found.filter(p => inColumns(centre, p, size) && (dy == null || Math.abs(p.y - Math.floor(centre.y)) <= dy)
        && (!filter || filter(p))).slice(0, count);
}

// nearOf: the smallest search (49, 97, 193) holding one of names around centre, or null.
function nearOf(bot, names, centre, filter = null) {
    const found = findIn(bot, names, centre, SEARCHES.at(-1), { count: 24, filter });
    return { size: searchOf(centre, found), positions: found };
}

const LOGS = ['oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log', 'mangrove_log', 'cherry_log', 'pale_oak_log'];
const LEAVES = /_leaves$/;
// tree: a log with leaves within 2 blocks above or beside it (a tree, not a house beam)
function isTree(bot, p) {
    for (let dy = 0; dy <= 6; dy++) {
        const up = blockAt(bot, p.x, p.y + dy, p.z);
        if (!up) break;
        if (LEAVES.test(up.name)) return true;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (LEAVES.test(blockAt(bot, p.x + dx, p.y + dy, p.z + dz)?.name || '')) return true;
        if (!/_log$/.test(up.name)) break;
    }
    return false;
}

// surfaceStone: stone or deepslate within 3 of the surface (an open block
// with sky light above it).
function surfaceStone(bot, p) {
    for (let dy = 1; dy <= 4; dy++) {
        const b = blockAt(bot, p.x, p.y + dy, p.z);
        if (!b) return false;
        if (b.boundingBox !== 'block') return (b.skyLight ?? 0) > 0;
    }
    return false;
}

// homeFacts: the saved home places that still stand (a gone one is forgotten).
export function homeFacts(agent) {
    const bot = agent.bot, mem = agent.memory_bank;
    const check = (name, ok) => {
        const h = mem.recallPlace(name);
        if (!h) return null;
        const b = blockAt(bot, Math.floor(h[0]), Math.floor(h[1]), Math.floor(h[2]));
        if (!b || ok(b.name)) return h; // not loaded: keep it
        mem.forgetPlace(name);
        return null;
    };
    return {
        homeBed: check('home_bed', isBed),
        playerBed: check('player_bed', isBed),
        homeTable: check('home_table', n => n === 'crafting_table'),
        homeChest: agent.homeChest() || null,
    };
}

// centre: the chores centre, saving (and announcing) what the spec says to keep.
export function centreOf(agent, cs) {
    const bot = agent.bot;
    const h = homeFacts(agent);
    const self = bot.entity.position;
    const sp = agent.last_speaker && bot.players?.[agent.last_speaker]?.entity;
    let speaker = null;
    if (sp) {
        const feet = blockAt(bot, Math.floor(sp.position.x), Math.floor(sp.position.y), Math.floor(sp.position.z));
        const head = blockAt(bot, Math.floor(sp.position.x), Math.floor(sp.position.y) + 1, Math.floor(sp.position.z));
        speaker = { name: agent.last_speaker, x: sp.position.x, y: sp.position.y, z: sp.position.z, dist: sp.position.distanceTo(self),
            dimension: String(bot.game?.dimension || '').replace(/^minecraft:/, ''), onGround: sp.onGround !== false,
            inFluid: /water|lava/.test(feet?.name || ''), openSky: (head?.skyLight ?? 0) >= 14 };
    }
    const placed = (agent._playerPlaced || []).filter(p => {
        const b = blockAt(bot, p.pos.x, p.pos.y, p.pos.z);
        return !b || (p.kind === 'table' ? b.name === 'crafting_table' : CHESTS.includes(b.name));
    });
    const nearby = h.homeBed || h.homeChest || h.homeTable || placed.length ? [] : [
        ...findIn(bot, ['crafting_table'], self, WORK, { count: 4 }).map(pos => ({ kind: 'table', pos })),
        ...findIn(bot, CHESTS, self, WORK, { count: 4 }).map(pos => ({ kind: 'chest', pos })),
    ];
    const saved = agent.memory_bank.recallPlace('chores_centre');
    const c = chooseCentre({ homeBed: h.homeBed, homeChest: h.homeChest, homeTable: h.homeTable, playerPlaced: placed, nearby, speaker,
        saved: saved ? { kind: cs.centreKind === 'player' ? 'player' : 'self', pos: { x: saved[0], y: saved[1], z: saved[2] } } : null,
        self: { x: self.x, y: self.y, z: self.z } });
    if (c.save) {
        agent.memory_bank.rememberPlace(c.save.place, c.save.pos.x, c.save.pos.y, c.save.pos.z);
        if (c.save.place === 'chores_centre') cs.centreKind = c.save.kind;
        else agent.memory_bank.forgetPlace('chores_centre');
        agent._playerPlaced = [];
        if (c.save.say) agent.openChat(c.save.say);
        agent._saveChores?.();
    }
    // a table or (moved) bed home: a chest found in the base area becomes the home chest
    const chests = findIn(bot, CHESTS, c.pos, BASE, { count: 4, dy: BASE_HEIGHT });
    const adopt = chestToAdopt(c, h.homeChest, chests);
    if (adopt) agent.memory_bank.rememberPlace('home_chest', adopt.x, adopt.y, adopt.z);
    return { ...c, facts: h };
}

// litBase: no surface block within 2 of the centre's height in the base area
// (sampled every 3 columns) has block light below 8. Returns {lit, dark:
// [positions to light]}.
export function litBase(bot, centre) {
    const dark = [];
    const cy = Math.floor(centre.y);
    for (let dx = -10; dx <= 10; dx += 3) for (let dz = -10; dz <= 10; dz += 3) {
        const x = Math.floor(centre.x) + dx, z = Math.floor(centre.z) + dz;
        for (let y = cy + 2; y >= cy - 2; y--) {
            const b = blockAt(bot, x, y, z), below = blockAt(bot, x, y - 1, z);
            if (!b || !below) continue;
            if (b.boundingBox !== 'block' && below.boundingBox === 'block') {
                if ((b.light ?? 15) < 8 && !/water|lava/.test(b.name)) dark.push({ x, y, z });
                break;
            }
        }
    }
    return { lit: dark.length === 0, dark };
}

// farmFacts: crops on farmland with a cell in the work area, and how many are grown.
export function farmFacts(bot, centre) {
    const crops = findIn(bot, Object.keys(CROPS), centre, WORK, { count: 256, dy: 24,
        filter: p => blockAt(bot, p.x, p.y - 1, p.z)?.name === 'farmland' });
    let grown = 0;
    for (const p of crops) {
        const b = blockAt(bot, p.x, p.y, p.z);
        const age = b?.getProperties?.().age ?? b?.metadata;
        if (b && age >= CROPS[b.name]) grown++;
    }
    return { farm: crops.length > 0, ready: crops.length > 0 && (grown >= 8 || grown * 2 >= crops.length), crops };
}

const isFoodOf = bot => name => !!(bot.registry.foodsByName || {})[name];
const adult = e => !(e.metadata?.[16] === true);

// animalsNear: adult animals within 97×97 columns of the centre by kind (capped 9).
export function animalsNear(bot, centre) {
    const out = Object.fromEntries(ANIMALS.map(k => [k, 0]));
    const list = [];
    for (const e of Object.values(bot.entities)) {
        if (!e.position || e === bot.entity) continue;
        const kind = e.name === 'mooshroom' ? 'cow' : e.name;
        if (!(kind in out) || !adult(e) || !inColumns(centre, e.position, 97)) continue;
        out[kind] = Math.min(9, out[kind] + 1);
        list.push(e);
    }
    return { counts: out, list };
}

// groundSaplings: sapling items lying in the base area.
export function groundSaplings(bot, centre) {
    return Object.values(bot.entities).filter(e => e.name === 'item' && e.position && inBase(centre, e.position)
        && isSapling(safeDropped(e)?.name));
}
const safeDropped = e => { try { return e.getDroppedItem?.(); } catch { return null; } };

// sense reads the chores situation (chores_state.js) and the facts the
// actuators reuse (ctx). cs: the saved chores state (chest items, centre kind).
export function sense(agent, cs, can = CAN) {
    const bot = agent.bot;
    const c = centreOf(agent, cs);
    const centre = c.pos;
    const items = bot.inventory.items().map(i => ({ name: i.name, count: i.count }));
    const isFood = isFoodOf(bot);
    const chest = c.facts.homeChest ? cs.chestItems || [] : [];
    const kit = kitIn(chest, isFood);
    const have = haveCounts([...items, ...unreserved(chest, kit.reserved)], isFood);
    const tools = bestTiers(items.map(i => i.name));
    const base = (names, extra) => findIn(bot, names, centre, BASE, { count: 2, dy: BASE_HEIGHT, ...extra }).length > 0;
    const trees = nearOf(bot, LOGS, centre, p => isTree(bot, p));
    const stone = nearOf(bot, ['stone', 'deepslate', 'andesite', 'diorite', 'granite'], centre, p => surfaceStone(bot, p));
    const coal = nearOf(bot, ['coal_ore', 'deepslate_coal_ore'], centre);
    const sand = nearOf(bot, ['sand', 'red_sand'], centre);
    const water = nearOf(bot, ['water'], centre, p => (blockAt(bot, p.x, p.y, p.z)?.metadata ?? 1) === 0);
    const grass = nearOf(bot, GRASS, centre);
    const lit = litBase(bot, centre);
    const farm = farmFacts(bot, centre);
    const animals = animalsNear(bot, centre);
    const ground = groundSaplings(bot, centre);
    const bedOk = h => !!h;
    let biome = 'other';
    try { biome = biomeWord(bot.blockAt(v(centre))?.biome?.name || world.getBiomeName(bot)); } catch { /* unknown */ }
    const s = {
        home: c.home, time: timeWord(bot.time?.timeOfDay ?? 6000), biome,
        table: base(['crafting_table']), furnace: base(['furnace', 'smoker', 'blast_furnace']),
        chest: !!c.facts.homeChest || base(CHESTS), lit: lit.lit,
        bedMine: bedOk(c.facts.homeBed), bedPlayer: bedOk(c.facts.playerBed),
        ...tools, ...have,
        pack: bot.inventory.emptySlotCount(), farm: farm.farm, ready: farm.ready,
        kitPickaxe: kit.pickaxe, kitAxe: kit.axe, kitShovel: kit.shovel, kitSword: kit.sword, kitFood: kit.food, kitTorches: kit.torches,
        near: { trees: trees.size, stone: stone.size, coal: coal.size, sand: sand.size, water: water.size, grass: grass.size },
        animals: animals.counts, ground: Math.min(9, ground.length), canPlace: !!can.place, canSmelt: !!can.smelt, failed: [],
    };
    agent._choreCtx = { centre, home: c.home, facts: c.facts, trees, stone, coal, water, grass, lit, farm, animals, ground, kit, situation: s };
    return s;
}

// ---- actuators ----

const ok = (reason = 'done') => ({ ok: true, reason });
const fail = reason => ({ ok: false, reason });
const count = (bot, name) => world.getInventoryCounts(bot)[name] || 0;
const countWhere = (bot, f) => bot.inventory.items().filter(i => f(i.name)).reduce((n, i) => n + i.count, 0);

// goNear walks to within d of p; false when interrupted or unreachable.
async function goNear(bot, p, d = 3) {
    if (bot.entity.position.distanceTo(new Vec3(p.x + 0.5, p.y, p.z + 0.5)) <= d) return true;
    try { await skills.goToPosition(bot, p.x, p.y, p.z, d); } catch { /* unreachable */ }
    return !stopped(bot) && bot.entity.position.distanceTo(new Vec3(p.x + 0.5, p.y, p.z + 0.5)) <= d + 1.5;
}

// widen: say so when a resource's search is wider than the work area.
function widen(agent, size, what) {
    if (size && size > WORK) agent.openChat(`No ${what} close by: I'm going further (${size}×${size}) for ${what}.`);
}

async function gatherLogs(agent, n) {
    const bot = agent.bot, cx = agent._choreCtx;
    const t = cx.trees;
    if (!t.size) return fail('no trees within 193 blocks');
    widen(agent, t.size, 'wood');
    const before = countWhere(bot, isLog);
    for (const p of t.positions) {
        if (stopped(bot) || countWhere(bot, isLog) - before >= n) break;
        if (bot.entity.position.distanceTo(new Vec3(p.x, p.y, p.z)) > 32 && !await goNear(bot, p, 4)) continue;
        const log = blockAt(bot, p.x, p.y, p.z)?.name;
        if (!log || !isLog(log)) continue;
        await skills.collectBlock(bot, log, n - (countWhere(bot, isLog) - before));
        if (!stopped(bot)) await skills.pickupNearbyItems(bot);
    }
    const got = countWhere(bot, isLog) - before;
    return got > 0 ? ok(`${got} logs`) : fail(stopped(bot) ? 'stopped' : 'no log I could reach');
}

async function gatherCobble(agent, n) {
    const bot = agent.bot, cx = agent._choreCtx;
    if (!cx.stone.size) return fail('no stone near the surface within 193 blocks');
    widen(agent, cx.stone.size, 'stone');
    const before = count(bot, 'cobblestone') + count(bot, 'cobbled_deepslate');
    for (const p of cx.stone.positions) {
        if (stopped(bot)) break;
        const have = count(bot, 'cobblestone') + count(bot, 'cobbled_deepslate') - before;
        if (have >= n) break;
        if (!await goNear(bot, p, 4)) continue;
        await skills.collectBlock(bot, 'cobblestone', n - have);
    }
    const got = count(bot, 'cobblestone') + count(bot, 'cobbled_deepslate') - before;
    return got > 0 ? ok(`${got} cobblestone`) : fail(stopped(bot) ? 'stopped' : 'no stone I could mine');
}

async function craft(bot, item, n = 1) {
    if (stopped(bot)) return false;
    try { return await skills.craftForTask(bot, item, n); } catch { return false; }
}

async function craftTools(agent, tierName, kinds) {
    const bot = agent.bot;
    const made = [];
    for (const k of kinds) {
        if (stopped(bot)) break;
        const have = bestTiers(bot.inventory.items().map(i => i.name))[k];
        if (tier(have) >= tier(tierName)) continue;
        if (await craft(bot, `${tierName}_${k}`, 1)) made.push(k);
        else return fail(`couldn't make a ${tierName} ${k}`);
    }
    return ok(made.length ? `made ${made.join(', ')}` : 'had them');
}

// freeSpot: a place in the base area near the centre for a block: open
// there and above, solid ground below, not where the bot or a player
// stands, not farmland or a path. wide: also room for a bed (a free
// neighbour on each side).
function freeSpot(bot, centre, { wide = false, skip = [] } = {}) {
    const cx = Math.floor(centre.x), cy = Math.floor(centre.y), cz = Math.floor(centre.z);
    const busy = Object.values(bot.entities).filter(e => e.type === 'player' || e === bot.entity).map(e => v(e.position));
    const free = (x, y, z) => {
        const b = blockAt(bot, x, y, z), up = blockAt(bot, x, y + 1, z), below = blockAt(bot, x, y - 1, z);
        return b && up && below && OPEN.has(b.name) && OPEN.has(up.name) && below.boundingBox === 'block'
            && !/farmland|path|leaves|water|lava/.test(below.name) && !busy.some(p => p.x === x && p.z === z && Math.abs(p.y - y) <= 1)
            && !skip.some(p => p.x === x && p.y === y && p.z === z);
    };
    for (let r = 2; r <= 9; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let dy = 2; dy >= -2; dy--) {
            const x = cx + dx, y = cy + dy, z = cz + dz;
            if (!free(x, y, z)) continue;
            if (wide && !(free(x + 1, y, z) && free(x - 1, y, z) && free(x, y, z + 1) && free(x, y, z - 1)
                && free(x + 2, y, z) && free(x, y, z + 2))) continue;
            return { x, y, z };
        }
    }
    return null;
}

// placeAt places item at p from nearby; true when the block is there.
async function placeAt(agent, item, p) {
    const bot = agent.bot;
    if (!await goNear(bot, p, 3)) return false;
    agent._placingAt = { ...p, at: Date.now() };
    try { await skills.placeBlock(bot, item, p.x, p.y, p.z); } catch { /* checked below */ }
    const b = blockAt(bot, p.x, p.y, p.z);
    return !!b && (b.name === item || (isBed(item) && isBed(b.name)) || (item === 'torch' && /torch/.test(b.name)));
}

// remember applies homeOnPlace's saves for a block the bot placed.
function remember(agent, kind, p, mine = false) {
    const cx = agent._choreCtx;
    for (const s of homeOnPlace(kind, p, 'me', { ...homeFacts(agent), centre: { home: cx.home, pos: cx.centre } }, mine)) {
        if (s.pos) agent.memory_bank.rememberPlace(s.place, s.pos.x, s.pos.y, s.pos.z);
        else agent.memory_bank.forgetPlace(s.place);
        if (s.say) agent.openChat(s.say);
        if (s.place === 'home_chest' || s.place === 'home_table') agent.openChat(`My home is the ${kind === 'table' ? 'crafting table' : 'chest'} at ${s.pos.x} ${s.pos.y} ${s.pos.z}.`);
    }
}

async function placeStation(agent, item, kind) {
    const bot = agent.bot;
    if (count(bot, item) < 1 && !await craft(bot, item, 1)) return fail(`couldn't make a ${item}`);
    const p = freeSpot(bot, agent._choreCtx.centre);
    if (!p) return fail('no free spot in the base');
    if (!await placeAt(agent, item, p)) return fail(stopped(bot) ? 'stopped' : `couldn't place the ${item}`);
    if (kind) remember(agent, kind, p);
    return ok(`placed at ${p.x} ${p.y} ${p.z}`);
}

async function huntFood(agent) {
    const bot = agent.bot, cx = agent._choreCtx;
    const pos = bot.entity.position;
    // rabbits in the snow; else the nearest food animal
    const list = cx.animals.list.filter(e => ANIMAL_DROP[e.name]).sort((a, b) => a.position.distanceTo(pos) - b.position.distanceTo(pos));
    const e = (cx.situation.biome === 'snowy' && list.find(x => x.name === 'rabbit')) || list[0];
    if (!e) return fail('no animals near');
    if (e.position.distanceTo(pos) > 48 && !await goNear(bot, v(e.position), 8)) return fail('couldn\'t reach the animals');
    const ok1 = await skills.huntForDrop(bot, e.name === 'mooshroom' ? 'mooshroom' : e.name, ANIMAL_DROP[e.name], 3);
    return ok1 ? ok(`hunted ${e.name}`) : fail(stopped(bot) ? 'stopped' : `couldn't hunt the ${e.name}`);
}

async function cookFood(agent) {
    const bot = agent.bot;
    const raw = bot.inventory.items().find(i => RAW_MEAT.has(i.name));
    if (!raw) return fail('no raw meat carried');
    const f = findIn(bot, ['furnace', 'smoker'], agent._choreCtx.centre, BASE, { count: 1, dy: BASE_HEIGHT })[0];
    if (!f) return fail('no furnace in the base');
    if (!await goNear(bot, f, 3)) return fail('couldn\'t reach the furnace');
    const done = await skills.smeltItem(bot, raw.name, raw.count).catch(() => false);
    return done ? ok(`cooked ${raw.name}`) : fail(stopped(bot) ? 'stopped' : 'smelting failed');
}

async function makeTorches(agent) {
    const bot = agent.bot;
    const want = Math.max(4, KIT_TORCHES - count(bot, 'torch'));
    const before = count(bot, 'torch');
    await craft(bot, 'torch', want);
    return count(bot, 'torch') > before ? ok(`${count(bot, 'torch')} torches`) : fail(stopped(bot) ? 'stopped' : 'couldn\'t make torches');
}

async function lightBase(agent) {
    const bot = agent.bot, cx = agent._choreCtx;
    let placed = 0;
    for (const p of cx.lit.dark.slice(0, 10)) {
        if (stopped(bot) || count(bot, 'torch') < 1) break;
        const b = blockAt(bot, p.x, p.y, p.z);
        if (!b || !OPEN.has(b.name) || (b.light ?? 15) >= 8) continue;
        if (await placeAt(agent, 'torch', p)) placed++;
    }
    return placed ? ok(`${placed} torches placed`) : fail(stopped(bot) ? 'stopped' : 'couldn\'t place a torch');
}

async function getSeeds(agent) {
    const bot = agent.bot;
    const seeds = () => countWhere(bot, n => n in SEED_OF);
    const before = seeds();
    const grass = findIn(bot, GRASS, agent._choreCtx.centre, WORK, { count: 40, dy: 24 });
    if (!grass.length) return fail('no grass in the work area');
    for (const p of grass) {
        if (stopped(bot) || seeds() >= 16) break;
        const b = blockAt(bot, p.x, p.y, p.z);
        if (!b || !GRASS.includes(b.name)) continue;
        if (!await goNear(bot, p, 3)) continue;
        try { await bot.dig(b); } catch { /* gone */ }
        await skills.pickupNearbyItems(bot);
    }
    return seeds() > before ? ok(`${seeds()} seeds`) : fail(stopped(bot) ? 'stopped' : 'no seeds from the grass');
}

// farmSite: up to 16 grass or dirt blocks (4×4 where it fits) within 4 of
// a water source in the work area, open above.
export function farmSite(bot, centre, water) {
    for (const w of water) {
        if (!inColumns(centre, w, WORK)) continue;
        const out = [];
        for (let dx = -4; dx <= 4; dx++) for (let dz = -4; dz <= 4; dz++) {
            const x = w.x + dx, z = w.z + dz;
            for (const y of [w.y, w.y + 1]) {
                const b = blockAt(bot, x, y, z), up = blockAt(bot, x, y + 1, z);
                if (b && up && /^(grass_block|dirt)$/.test(b.name) && OPEN.has(up.name)) out.push({ x, y, z, d: Math.abs(dx) + Math.abs(dz) });
            }
        }
        if (out.length >= 4) return out.sort((a, b) => a.d - b.d).slice(0, 16);
    }
    return [];
}

async function startFarm(agent) {
    const bot = agent.bot, cx = agent._choreCtx;
    if (!bot.inventory.items().some(i => /_hoe$/.test(i.name)) && !await craft(bot, 'wooden_hoe', 1)) return fail('couldn\'t make a hoe');
    const site = farmSite(bot, cx.centre, cx.water.positions);
    if (!site.length) return fail('no ground to till by the water');
    let planted = 0;
    for (const p of site) {
        if (stopped(bot)) break;
        const seed = bot.inventory.items().find(i => i.name in SEED_OF);
        if (!seed) break;
        if (await skills.tillAndSow(bot, p.x, p.y, p.z, seed.name).catch(() => false)) planted++;
    }
    return planted ? ok(`planted ${planted}`) : fail(stopped(bot) ? 'stopped' : 'couldn\'t plant');
}

async function gatherWool(agent) {
    const bot = agent.bot, cx = agent._choreCtx;
    const sheep = cx.animals.list.filter(e => e.name === 'sheep').sort((a, b) => a.position.distanceTo(bot.entity.position) - b.position.distanceTo(bot.entity.position))[0];
    if (!sheep) return fail('no sheep near');
    const before = countWhere(bot, n => /_wool$/.test(n));
    if (count(bot, 'shears') > 0) {
        try { await skills.useToolOn(bot, 'shears', 'sheep'); } catch { /* none sheared */ }
    } else {
        await skills.huntForDrop(bot, 'sheep', 'white_wool', 1).catch(() => false);
    }
    if (!stopped(bot)) await skills.pickupNearbyItems(bot);
    return countWhere(bot, n => /_wool$/.test(n)) > before ? ok('wool') : fail(stopped(bot) ? 'stopped' : 'no wool');
}

async function makeBeds(agent) {
    const bot = agent.bot;
    const h = homeFacts(agent);
    const want = (h.homeBed ? 0 : 1) + (h.playerBed ? 0 : 1);
    const beds = () => bot.inventory.items().filter(i => isBed(i.name));
    while (beds().reduce((n, i) => n + i.count, 0) < want && !stopped(bot)) {
        const wool = bot.inventory.items().filter(i => /_wool$/.test(i.name) && i.count >= 3)[0];
        if (!wool) return fail('not 3 wool of one colour');
        if (!await craft(bot, wool.name.replace(/_wool$/, '_bed'), 1)) return fail('couldn\'t make a bed');
    }
    let first = null;
    for (const who of ['me', 'player']) {
        if (stopped(bot)) break;
        if ((who === 'me' && h.homeBed) || (who === 'player' && h.playerBed)) continue;
        const bed = beds()[0];
        if (!bed) break;
        // side by side: the player's bed beside his
        let p = null;
        if (first) {
            const b = blockAt(bot, first.x, first.y, first.z);
            const f = b?.getProperties?.().facing;
            const side = f === 'north' || f === 'south' ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
            p = side.map(([dx, dz]) => ({ x: first.x + dx, y: first.y, z: first.z + dz }))
                .find(q => OPEN.has(blockAt(bot, q.x, q.y, q.z)?.name || 'stone'));
        }
        p ||= freeSpot(bot, agent._choreCtx.centre, { wide: true });
        if (!p) return fail('no room for a bed in the base');
        if (!await placeAt(agent, bed.name, p)) return fail(stopped(bot) ? 'stopped' : 'couldn\'t place the bed');
        agent.memory_bank.rememberPlace(who === 'me' ? 'home_bed' : 'player_bed', p.x, p.y, p.z);
        if (who === 'me') { first = p; agent.openChat(`My bed is at ${p.x} ${p.y} ${p.z}; my home is now there.`); }
        else agent.openChat(`I put a bed for you beside mine at ${p.x} ${p.y} ${p.z}.`);
    }
    // no room for the player's bed: it goes in the home chest
    if (!stopped(bot) && !homeFacts(agent).playerBed && beds().length && agent.homeChest()) await depositHome(agent, [{ name: beds()[0].name, count: 1 }]);
    return ok('beds');
}

// depositHome puts items in the home chest and refreshes the remembered
// chest contents.
async function depositHome(agent, items) {
    const bot = agent.bot;
    const h = agent.homeChest();
    if (!h) return false;
    const p = { x: Math.floor(h[0]), y: Math.floor(h[1]), z: Math.floor(h[2]) };
    if (!await goNear(bot, p, 3)) return false;
    let chest;
    try {
        chest = await bot.openContainer(bot.blockAt(v(p)));
        for (const it of items) {
            if (stopped(bot)) break;
            const inv = bot.inventory.items().find(i => i.name === it.name);
            if (!inv) continue;
            try { await chest.deposit(inv.type, null, Math.min(it.count, countWhere(bot, n => n === it.name))); } catch { /* full */ }
        }
        agent._chores.chestItems = chest.containerItems().map(i => ({ name: i.name, count: i.count }));
        agent._chores.chestAt = p;
        agent._saveChores?.();
        return true;
    } catch { return false; } finally { try { chest?.close(); } catch { /* closed */ } }
}

// takeFromHome takes items from the home chest, never the reserved kit
// ("leaves one kit in place").
export async function takeFromHome(agent, name, n) {
    const bot = agent.bot;
    const h = agent.homeChest();
    if (!h) return 0;
    const p = { x: Math.floor(h[0]), y: Math.floor(h[1]), z: Math.floor(h[2]) };
    if (!await goNear(bot, p, 3)) return 0;
    let chest, took = 0;
    try {
        chest = await bot.openContainer(bot.blockAt(v(p)));
        const items = chest.containerItems().map(i => ({ name: i.name, count: i.count }));
        const free = unreserved(items, kitIn(items, isFoodOf(bot)).reserved).filter(i => i.name === name).reduce((s, i) => s + i.count, 0);
        const k = Math.min(n, free);
        const it = chest.containerItems().find(i => i.name === name);
        if (k > 0 && it) { await chest.withdraw(it.type, null, k); took = k; }
        agent._chores.chestItems = chest.containerItems().map(i => ({ name: i.name, count: i.count }));
        agent._saveChores?.();
    } catch { /* couldn't */ } finally { try { chest?.close(); } catch { /* closed */ } }
    return took;
}

async function stockKit(agent) {
    const bot = agent.bot, cx = agent._choreCtx;
    const s = cx.situation;
    const t = kitTier(s);
    const put = [];
    if (t !== 'none') for (const k of KIT_TOOLS) {
        const have = { pickaxe: s.kitPickaxe, axe: s.kitAxe, shovel: s.kitShovel, sword: s.kitSword }[k];
        if (tier(have) >= tier(t)) continue;
        const name = `${t === 'stone' ? 'stone' : t}_${k}`;
        // his own tool stays his: make one more for the kit
        const own = count(bot, name);
        if (!await craft(bot, name, 1) || count(bot, name) <= own) return fail(`couldn't make a ${name} for the kit`);
        put.push({ name, count: 1 });
    }
    if (s.kitFood < KIT_FOOD) {
        let need = KIT_FOOD - s.kitFood;
        for (const i of bot.inventory.items()) {
            if (need <= 0) break;
            if (!isFoodOf(bot)(i.name) || RAW_MEAT.has(i.name) || NOT_FOOD.has(i.name)) continue;
            const n = Math.min(need, i.count - (put.find(x => x.name === i.name)?.count || 0));
            if (n > 0) { put.push({ name: i.name, count: n }); need -= n; }
        }
    }
    if (s.kitTorches < KIT_TORCHES && count(bot, 'torch') >= KIT_TORCHES - s.kitTorches + 8)
        put.push({ name: 'torch', count: KIT_TORCHES - s.kitTorches });
    if (!put.length) return fail('nothing to put in the kit');
    return await depositHome(agent, put) ? ok(`kit: ${put.map(i => `${i.count} ${i.name}`).join(', ')}`) : fail('couldn\'t reach the home chest');
}

// sapling spot: dirt or grass in the base area, ≥3 from saplings and trees,
// not farmland or a path, not within 1 of a placed block.
function saplingSpot(bot, centre, used) {
    const cx = Math.floor(centre.x), cy = Math.floor(centre.y), cz = Math.floor(centre.z);
    const nearTree = (x, y, z) => {
        for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) for (let dy = -1; dy <= 3; dy++) {
            const n = blockAt(bot, x + dx, y + dy, z + dz)?.name || '';
            if (isSapling(n) || /_log$/.test(n)) return true;
        }
        return used.some(p => Math.max(Math.abs(p.x - x), Math.abs(p.z - z)) < 3);
    };
    const placedNear = (x, y, z) => {
        for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) for (let dy = 0; dy <= 1; dy++) {
            const b = blockAt(bot, x + dx, y + dy, z + dz);
            if (b && !OPEN.has(b.name) && !/^(grass_block|dirt|water)$/.test(b.name) && !/leaves/.test(b.name)) return true;
        }
        return false;
    };
    for (let r = 3; r <= 10; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let dy = 2; dy >= -3; dy--) {
            const x = cx + dx, y = cy + dy, z = cz + dz;
            const g = blockAt(bot, x, y - 1, z), b = blockAt(bot, x, y, z), up = blockAt(bot, x, y + 1, z);
            if (!g || !b || !up || !/^(grass_block|dirt|podzol|coarse_dirt)$/.test(g.name) || !OPEN.has(b.name) || !OPEN.has(up.name)) continue;
            if ((up.skyLight ?? 15) < 8 || nearTree(x, y, z) || placedNear(x, y, z)) continue;
            return { x, y, z };
        }
    }
    return null;
}

async function replantSaplings(agent) {
    const bot = agent.bot, cx = agent._choreCtx;
    for (const e of cx.ground) {
        if (stopped(bot)) break;
        if (!e.isValid && e.isValid !== undefined) continue;
        await goNear(bot, v(e.position), 1);
    }
    if (!stopped(bot) && cx.ground.length) await skills.pickupNearbyItems(bot);
    const used = [];
    let planted = 0;
    for (const s of bot.inventory.items().filter(i => isSapling(i.name))) {
        for (let n = 0; n < s.count && !stopped(bot); n++) {
            const p = saplingSpot(bot, cx.centre, used);
            if (!p) break;
            used.push(p);
            if (await placeAt(agent, s.name, p)) planted++;
        }
    }
    return planted ? ok(`planted ${planted} saplings`) : fail(stopped(bot) ? 'stopped' : 'nowhere to plant a sapling');
}

async function sleep(agent) {
    const bot = agent.bot;
    const h = homeFacts(agent).homeBed;
    if (!h) return fail('no bed');
    const p = { x: Math.floor(h[0]), y: Math.floor(h[1]), z: Math.floor(h[2]) };
    if (!await goNear(bot, p, 2)) return fail('couldn\'t reach my bed');
    try { await bot.sleep(bot.blockAt(v(p))); } catch (err) { return fail(`can't sleep: ${err?.message || err}`); }
    while (bot.isSleeping && !stopped(bot)) await new Promise(r => setTimeout(r, 500));
    if (bot.isSleeping) try { await bot.wake(); } catch { /* awake */ }
    return ok('slept');
}

async function rest(agent, seconds = 20) {
    const bot = agent.bot, cx = agent._choreCtx;
    if (bot.entity.position.distanceTo(new Vec3(cx.centre.x, cx.centre.y, cx.centre.z)) > 8) await goNear(bot, cx.centre, 4);
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end && !stopped(bot)) await new Promise(r => setTimeout(r, 200));
    return ok('rested');
}

// ACTUATORS: chore → (agent) → Promise<{ok, reason}>.
export const ACTUATORS = {
    gather_logs: a => gatherLogs(a, 4),
    stock_logs: a => gatherLogs(a, 16),
    place_table: a => placeStation(a, 'crafting_table', 'table'),
    craft_wood_tools: a => craftTools(a, 'wooden', ['axe', 'pickaxe']),
    get_seeds: getSeeds,
    start_farm: startFarm,
    gather_cobble: a => gatherCobble(a, Math.max(1, (a._choreCtx.situation.furnace ? 6 : 14) - a._choreCtx.situation.cobble)),
    stock_cobble: a => gatherCobble(a, 16),
    craft_stone_tools: a => craftTools(a, 'stone', ['axe', 'pickaxe']),
    place_furnace: a => placeStation(a, 'furnace', null),
    hunt_food: huntFood,
    cook_food: cookFood,
    make_torches: makeTorches,
    light_base: lightBase,
    place_chest: a => placeStation(a, 'chest', 'chest'),
    gather_wool: gatherWool,
    make_beds: makeBeds,
    stock_kit: stockKit,
    craft_sword: a => craftTools(a, 'stone', ['sword']),
    tend_farm: a => skills.farmWithLayaModel(a.bot, { crop: 'any', count: null, progress: { harvested: 0 }, minutes: 3 },
        () => a.homeChest(), { remember: c => a.memory_bank.rememberPlace('home_chest', c.x, c.y, c.z), say: m => a.openChat(m) })
        .then(r => (r === false || r?.ok === false ? fail(r?.reason || 'farming stopped') : ok('tended'))),
    replant_saplings: replantSaplings,
    unload: async a => { await a._unload(); return ok('unloaded'); },
    sleep,
    night_mine: a => skills.mineOre(a.bot, 'coal', 8, () => a.homeChest(), { done: 0 })
        .then(r => (r === false || r?.ok === false ? fail(r?.reason || 'mining stopped') : ok('mined'))),
    rest: a => rest(a),
};

// runChore runs a chore's actuator; never throws.
export async function runChore(agent, chore) {
    const f = ACTUATORS[chore];
    if (!f) return fail(`no actuator for ${chore}`);
    try { return await f(agent); } catch (err) { return fail(err?.message || String(err)); }
}

// playerAttack: the v1.2 Player fact from what the agent saw. hits:
// {name → {at, by}}; now. Returns {name, attacked, by, dist} | null for the
// nearest player within 24 a mob hit in the last 5 s, else the nearest
// player within 24.
export function playerFact(bot, hits, now = Date.now()) {
    const pos = bot.entity.position;
    let hit = null, nearest = null;
    for (const p of Object.values(bot.players || {})) {
        const e = p.entity;
        if (!e || e === bot.entity || !e.position) continue;
        const d = e.position.distanceTo(pos);
        if (d > 24) continue;
        const h = hits[p.username];
        if (h && now - h.at <= 5000 && (!hit || d < hit.dist)) hit = { name: p.username, attacked: true, by: h.by, dist: d, entity: h.entity };
        if (!nearest || d < nearest.dist) nearest = { name: p.username, attacked: false, by: 'none', dist: d };
    }
    return hit || nearest;
}
