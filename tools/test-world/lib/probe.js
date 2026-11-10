// Site checks: does each named site in sites.json still look the way the
// tests need it? A probe player (mineflayer, username "probe") is teleported
// to the site over RCON, waits for the chunks, then the checks look at the
// blocks. The checks take a small "view" so tests can use a fake:
//   view.blockAt(x, y, z) → block name, or null when not loaded
//   view.find(names[], {x, y, z}, radius, count) → [{x, y, z}]
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Blocks a player can stand in (air and small plants).
export const OPEN = /(^|_)air$|^(short_grass|tall_grass|fern|large_fern|dead_bush|dandelion|poppy|blue_orchid|allium|azure_bluet|.*_tulip|oxeye_daisy|cornflower|lily_of_the_valley|sunflower|lilac|rose_bush|peony|pink_petals|snow|sweet_berry_bush|bush|firefly_bush|leaf_litter|wildflowers|short_dry_grass|tall_dry_grass)$/;
export const WATER = ['water'];
export const STONE = ['stone', 'andesite', 'diorite', 'granite', 'deepslate', 'tuff', 'cobblestone', 'calcite', 'coal_ore', 'iron_ore', 'copper_ore'];
export const SOLID_GROUND = /^(stone|andesite|diorite|granite|deepslate|tuff|dirt|coarse_dirt|gravel|calcite|cobblestone|.*_ore|grass_block|sand|clay|moss_block|rooted_dirt|mud|cobbled_deepslate|smooth_basalt)$/;

const isOpen = n => n != null && OPEN.test(n);
const at = (s, d = {}) => ({ x: s.x + (d.dx || 0), y: s.y + (d.dy || 0), z: s.z + (d.dz || 0) });
const offsets = v => (Array.isArray(v) ? v : String(v).trim().split(/\s+/)).map(Number);

// checkSite evaluates one site's checks: [{type, ok, reason}].
export function checkSite(view, s) {
    return (s.checks || []).map(c => {
        try { return { type: c.type, ...CHECKS[c.type](view, s, c) }; } catch (e) { return { type: c.type, ok: false, reason: e.message }; }
    });
}

const notLoaded = p => { throw new Error(`block ${p.x} ${p.y} ${p.z} isn't loaded`); };

export const CHECKS = {
    // grass: grass underfoot, and with radius r a flat, open square of grass
    // (2r+1)² wide at the site's height.
    grass(view, s, c) {
        const r = c.radius ?? 0;
        let bad = [];
        for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
            const g = view.blockAt(s.x + dx, s.y - 1, s.z + dz);
            const f = view.blockAt(s.x + dx, s.y, s.z + dz);
            const h = view.blockAt(s.x + dx, s.y + 1, s.z + dz);
            if (g == null || f == null) notLoaded(at(s, { dx, dz }));
            if (g !== 'grass_block' || !isOpen(f) || !isOpen(h)) bad.push(`${s.x + dx} ${s.z + dz}: ${g}/${f}/${h}`);
        }
        const n = (2 * r + 1) ** 2;
        const min = c.min ?? n;
        const good = n - bad.length;
        return good >= min
            ? { ok: true, reason: `${good}/${n} open grass blocks at y ${s.y - 1}` }
            : { ok: false, reason: `only ${good}/${n} open grass blocks at y ${s.y - 1}, wanted ${min} (${bad.slice(0, 4).join('; ')})` };
    },
    // water: at least min water blocks within radius.
    water(view, s, c) {
        const r = c.radius ?? 8, min = c.min ?? 1;
        const found = view.find(WATER, s, r, Math.max(min, 1));
        return found.length >= min
            ? { ok: true, reason: `water within ${r} (nearest ${fmt(nearest(found, s))})` }
            : { ok: false, reason: `${found.length} water blocks within ${r}, wanted ${min}` };
    },
    // noWater: no water within radius (the farm task's water_radius is 64).
    noWater(view, s, c) {
        const r = c.radius ?? 64;
        const found = view.find(WATER, s, r, 1);
        return found.length ? { ok: false, reason: `water at ${fmt(found[0])}, within ${r}` } : { ok: true, reason: `no water within ${r}` };
    },
    // stone: at least min stone-like blocks with an open side, within radius.
    stone(view, s, c) {
        const r = c.radius ?? 8, min = c.min ?? 8;
        const found = view.find(STONE, s, r, 2000);
        const sides = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
        const exposed = found.filter(p => sides.some(([dx, dy, dz]) => isOpen(view.blockAt(p.x + dx, p.y + dy, p.z + dz))));
        return exposed.length >= min
            ? { ok: true, reason: `${exposed.length} exposed stone blocks within ${r}` }
            : { ok: false, reason: `${exposed.length} exposed stone blocks within ${r}, wanted ${min}` };
    },
    // cave: open at feet and head, solid underfoot, and a solid roof within
    // `roof` blocks above (so it's underground, not open sky).
    cave(view, s, c) {
        const roof = c.roof ?? 24;
        const f = view.blockAt(s.x, s.y, s.z), h = view.blockAt(s.x, s.y + 1, s.z), g = view.blockAt(s.x, s.y - 1, s.z);
        if (f == null || g == null) notLoaded(s);
        if (!isOpen(f) || !isOpen(h)) return { ok: false, reason: `not open at the site: ${f}/${h}` };
        if (isOpen(g) || g === 'water' || g === 'lava') return { ok: false, reason: `nothing to stand on: ${g}` };
        let top = null;
        for (let dy = 2; dy <= roof; dy++) {
            const b = view.blockAt(s.x, s.y + dy, s.z);
            if (b != null && !isOpen(b) && b !== 'water') { top = { dy, b }; break; }
        }
        if (!top) return { ok: false, reason: `no roof within ${roof} blocks (open sky?)` };
        // and solid rock all the way up from the roof for a few blocks
        return { ok: true, reason: `underground: ${g} underfoot, ${top.b} roof ${top.dy} up` };
    },
    // block: the block at an offset ("dx dy dz") has a name matching c.name.
    block(view, s, c) {
        const [dx, dy, dz] = offsets(c.at ?? '0 0 0');
        const p = at(s, { dx, dy, dz });
        const b = view.blockAt(p.x, p.y, p.z);
        if (b == null) notLoaded(p);
        return new RegExp(c.name).test(b) ? { ok: true, reason: `${b} at ${fmt(p)}` } : { ok: false, reason: `${b} at ${fmt(p)}, wanted /${c.name}/` };
    },
};

function nearest(list, s) {
    let best = null, bd = Infinity;
    for (const p of list) { const d = Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z); if (d < bd) { bd = d; best = p; } }
    return best;
}
const fmt = p => (p ? `${p.x} ${p.y} ${p.z}` : '—');

// ---- the real probe ----

// mineflayerView wraps a mineflayer bot as a view.
export function mineflayerView(bot, Vec3) {
    const ids = names => names.map(n => bot.registry.blocksByName[n]?.id).filter(id => id != null);
    return {
        blockAt: (x, y, z) => bot.blockAt(new Vec3(x, y, z))?.name ?? null,
        find: (names, s, radius, count) => bot.findBlocks({ matching: ids(names), point: new Vec3(s.x, s.y, s.z), maxDistance: radius, count })
            .map(p => ({ x: p.x, y: p.y, z: p.z })),
    };
}

// openProbe joins the test world as "probe" (offline). It is moved with
// RCON (tp), so it needs no operator rights.
export async function openProbe({ host, port, version, username = 'probe', timeoutMs = 60000 }) {
    const [{ default: mineflayer }, { default: Vec3 }] = await Promise.all([import('mineflayer'), import('vec3')]);
    const bot = mineflayer.createBot({ host, port, version, username, auth: 'offline', hideErrors: true, viewDistance: 'far' });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`probe did not spawn in ${timeoutMs} ms`)), timeoutMs);
        bot.once('spawn', () => { clearTimeout(timer); resolve(); });
        bot.once('kicked', r => { clearTimeout(timer); reject(new Error(`probe kicked: ${JSON.stringify(r)}`)); });
        bot.once('error', e => { clearTimeout(timer); reject(e); });
    });
    bot.on('error', () => {});
    return { bot, Vec3, view: mineflayerView(bot, Vec3) };
}

// goTo teleports the probe to x y z with RCON (spectator, so it doesn't fall
// or suffocate) and waits until the blocks around are loaded.
export async function goTo(probe, command, p, { radius = 64, timeoutMs = 30000 } = {}) {
    const { bot, Vec3 } = probe;
    await command(`gamemode spectator ${bot.username}`);
    await command(`tp ${bot.username} ${p.x + 0.5} ${p.y} ${p.z + 0.5}`);
    const start = Date.now();
    const far = [[radius, 0], [-radius, 0], [0, radius], [0, -radius], [0, 0]];
    for (;;) {
        const pos = bot.entity?.position;
        const near = pos && Math.abs(pos.x - (p.x + 0.5)) < 2 && Math.abs(pos.z - (p.z + 0.5)) < 2;
        const loaded = far.every(([dx, dz]) => bot.blockAt(new Vec3(p.x + dx, p.y, p.z + dz)) != null);
        if (near && loaded) { await sleep(500); return true; }
        if (Date.now() - start > timeoutMs) return false;
        await sleep(250);
    }
}

// checkSites checks every site (or the named ones): {ok, results: {name: [..]}}.
export async function checkSites({ sites, command, open = openProbe, server, names = null, log = () => {} }) {
    const probe = await open(server);
    const results = {};
    let ok = true;
    try {
        for (const [name, s] of Object.entries(sites.sites)) {
            if (names?.length && !names.includes(name)) continue;
            const loaded = await goTo(probe, command, s);
            const r = loaded ? checkSite(probe.view, s) : [{ type: 'load', ok: false, reason: 'chunks did not load in 30 s' }];
            results[name] = r;
            const good = r.every(x => x.ok);
            ok &&= good;
            log(`${good ? 'ok  ' : 'FAIL'} ${name.padEnd(6)} ${s.x} ${s.y} ${s.z}  ${r.map(x => `${x.type}: ${x.reason}`).join('; ')}`);
        }
    } finally {
        try { probe.bot.quit(); } catch { /* */ }
    }
    return { ok, results };
}
