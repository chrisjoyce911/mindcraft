// The mine log sessions: the old loop tests' fake world (test/laya_mine_loop.test.js setup/v2) and a set of runs
// that between them write every laya-mine.jsonl entry shape. Shared by record-mine.mjs (the old JS writes the
// fixture) and bot/test/mine.log.test.ts (the new MineRun must write the same lines). Each make() returns a fresh
// {bot, deps} in the old mineWithLaya deps shape.
const EMPTY = new Set(['air', 'torch', 'lava', 'water']);

function fakeWorld(y, blocks = {}) {
    const m = new Map(Object.entries(blocks));
    for (const [x, z] of [[0, 0], [-1, 0]]) {
        for (const k of [`${x},${y},${z}`, `${x},${y + 1},${z}`]) if (x === 0 || !m.has(k)) m.set(k, 'air');
    }
    return { m, blockAt: (x, yy, z) => { const name = m.get(`${x},${yy},${z}`) ?? 'stone'; return { name, boundingBox: EMPTY.has(name) ? 'empty' : 'block' }; } };
}

const answer = (action, p = 0.9, ms = 2) => ({ model: 'fake', ms, answers: {
    Action: { type: 'choice', top: action, topProbability: p, confident: p >= 0.4 },
    Hazard: { type: 'noul', probability: 0.1, confident: true },
} });
const withUnload = (a, p) => { a.answers.Unload = { type: 'noul', probability: p, confident: true }; return a; };
const DROPS = { coal: 'coal', iron: 'raw_iron' };

function setup({ y = 16, blocks = {}, inv = { stone_pickaxe: 1, torch: 5, cobblestone: 10 }, decide = () => null, ore = 'iron' } = {}) {
    const w = fakeWorld(y, blocks);
    const bot = { entity: { position: { x: 0.5, y, z: 0.5 }, yaw: -Math.PI / 2 }, interrupt_code: false };
    const inventory = { ...inv };
    let asked = 0;
    const deps = {
        client: { decide: async (task, state) => decide(state, ++asked) },
        task: { log_steps: true, max_steps: 40, prompt: 'v1' },
        blockAt: w.blockAt,
        inventory: () => ({ ...inventory }),
        nearestOre: (names, range) => {
            const p = bot.entity.position;
            let best = null;
            for (const [k, name] of w.m) {
                if (!names.includes(name)) continue;
                const [x, yy, z] = k.split(',').map(Number);
                const d = Math.hypot(x - p.x, yy - p.y, z - p.z);
                if (d <= range && (!best || d < best.d)) best = { x, y: yy, z, d };
            }
            return best ? { x: best.x, y: best.y, z: best.z } : null;
        },
        craft: async (item, n) => { inventory[item] = (inventory[item] || 0) + n; return true; },
        collect: async (names, n, o) => {
            if (!o || !names.includes(w.m.get(`${o.x},${o.y},${o.z}`))) return false;
            w.m.set(`${o.x},${o.y},${o.z}`, 'air');
            inventory[DROPS[ore]] = (inventory[DROPS[ore]] || 0) + 1;
            return true;
        },
        dig: async (x, yy, z) => { w.m.set(`${x},${yy},${z}`, 'air'); return true; },
        moveTo: async (x, yy, z) => { bot.entity.position = { x: x + 0.5, y: yy, z: z + 0.5 }; return true; },
        place: async (item, x, yy, z) => { w.m.set(`${x},${yy},${z}`, item === 'torch' ? 'torch' : 'stone'); inventory[item]--; return true; },
        sleep: async () => {},
        log: () => {},
    };
    return { bot, deps, w, inventory };
}

function v2(opts = {}) {
    const s = setup({ decide: () => null, ...opts });
    Object.assign(s.deps.task, { prompt: 'v2', max_steps: opts.steps ?? 20 });
    s.deps.chat = () => {};
    s.deps.freeSlots = () => opts.free ?? 20;
    s.deps.home = () => opts.home ?? null;
    s.deps.hostiles = () => 0;
    s.deps.isFood = n => n === 'bread';
    s.deps.goHome = async h => { s.bot.entity.position = { x: h.x + 0.5, y: h.y, z: h.z + 1.5 }; return true; };
    s.deps.deposit = async items => { for (const { name, count } of items) s.inventory[name] -= count; return true; };
    return s;
}

const hollowEast = () => {
    const blocks = {};
    for (let x = 1; x <= 4; x++) for (let z = -3; z <= 3; z++) for (let y = 50; y <= 57; y++) blocks[`${x},${y},${z}`] = 'air';
    return blocks;
};

// mine memory shared by the two reuse sessions (in order)
let saved = [];
const store = { find: () => saved[0] || null, save: rec => { saved = [JSON.parse(JSON.stringify(rec))]; }, forget: () => { saved = []; } };
let firstMine = null;

export const SESSIONS = [
    // v1: model tunnels until the ore is in sight, then collects it (model lines, collect with its ore)
    { ore: 'iron', count: 1, make: () => setup({ blocks: { '6,16,0': 'iron_ore' }, decide: st => answer(st.includes('\nSeen none\n') ? 'tunnel E' : 'collect', 0.93, 31) }) },
    // v1: a veto (lava), a low-confidence and a no-answer fallback, then trapped is not reached: max_steps 3
    { ore: 'iron', count: 1, make: () => { const s = setup({ blocks: { '2,16,0': 'lava' }, decide: (st, n) => (n === 1 ? answer('tunnel E', 0.95, 12) : n === 2 ? answer('up N', 0.2, 13) : null) }); s.deps.task.max_steps = 3; return s; } },
    // v1: trapped (bedrock all round): the stop line
    { ore: 'iron', count: 1, make: () => {
        const blocks = {};
        for (let x = -3; x <= 3; x++) for (let y = 13; y <= 19; y++) for (let z = -3; z <= 3; z++) blocks[`${x},${y},${z}`] = 'bedrock';
        return setup({ blocks, decide: () => answer('stop', 0.9, 9) });
    } },
    // v1: lava touching: block, and a torch in the dark
    { ore: 'iron', count: 1, make: () => { const s = setup({ blocks: { '0,16,1': 'lava' }, decide: () => answer('block', 0.8, 5) }); s.deps.task.max_steps = 1; return s; } },
    // v2: start (planned), the stair down with the model's Unload probability, an off-plan overrule
    { ore: 'iron', count: 1, make: () => v2({ y: 60, steps: 3, home: { x: 0, y: 64, z: 10 }, decide: (st, n) => withUnload(answer(n === 2 ? 'down S' : 'down E', 0.88, 40 + n), 0.07) }) },
    // v2: collect off the line (the ore field), then the walk back
    { ore: 'iron', count: 2, make: () => {
        const s = v2({ y: 20, steps: 3, blocks: { '2,20,3': 'iron_ore' } });
        s.deps.collect = async () => { s.w.m.set('2,20,3', 'air'); s.inventory.raw_iron = (s.inventory.raw_iron || 0) + 1; s.bot.entity.position = { x: 2.5, y: 20, z: 3.5 }; return true; };
        return s;
    } },
    // v2: unload at home (the rule: a full pack), then the walk back
    { ore: 'iron', count: 3, make: () => {
        const s = v2({ y: 20, steps: 3, free: 1, home: { x: 0, y: 64, z: 10 }, inv: { stone_pickaxe: 1, torch: 5, cobblestone: 50, bread: 3, raw_iron: 2, andesite: 10 } });
        let deposited = false;
        s.deps.freeSlots = () => (deposited ? 20 : 1);
        const dep = s.deps.deposit;
        s.deps.deposit = async items => { deposited = true; return dep(items); };
        return s;
    } },
    // v2: unload wanted with ore in sight: collect first (unload_later), and a partial unload
    { ore: 'iron', count: 2, make: () => {
        const s = v2({ y: 20, steps: 3, free: 1, home: { x: 0, y: 20, z: 10 }, inv: { stone_pickaxe: 1, torch: 5, cobblestone: 10, dirt: 40 }, blocks: { '2,20,1': 'iron_ore' } });
        s.deps.ores = () => (s.w.m.get('2,20,1') === 'iron_ore' ? [{ x: 2, y: 20, z: 1 }] : []);
        s.deps.deposit = async () => { s.inventory.dirt = 0; return false; };
        return s;
    } },
    // v2: the walk back fails twice: restart from here
    { ore: 'iron', count: 5, make: () => {
        const s = v2({ y: 20, steps: 4, blocks: { '2,20,3': 'iron_ore' } });
        s.deps.collect = async () => { s.w.m.set('2,20,3', 'air'); s.inventory.raw_iron = (s.inventory.raw_iron || 0) + 1; s.bot.entity.position = { x: 2.5, y: 20, z: 3.5 }; return true; };
        const moveTo = s.deps.moveTo;
        s.deps.moveTo = async (x, y, z, ms) => (ms ? false : moveTo(x, y, z));
        return s;
    } },
    // v2: drops and shift-stair above the band
    { ore: 'iron', count: 1, make: () => v2({ y: 60, steps: 4, blocks: hollowEast() }) },
    // v2: stop-descent in the band (coal, a short grid)
    { ore: 'coal', count: 1, make: () => {
        const hollow = {};
        for (let x = 4; x <= 9; x++) for (let z = -3; z <= 3; z++) for (let y = 50; y <= 57; y++) hollow[`${x},${y},${z}`] = 'air';
        const s = v2({ y: 60, steps: 12, blocks: hollow, ore: 'coal' });
        Object.assign(s.deps.task, { main_length: 3, branch_every: 3, branch_length: 1 });
        return s;
    } },
    // v2: a blocked staircase: the unsafe restart from the entrance
    { ore: 'iron', count: 1, make: () => {
        const blocks = {};
        for (let x = 1; x <= 12; x++) for (let z = -6; z <= 6; z++) for (let y = 40; y <= 57; y++) blocks[`${x},${y},${z}`] = 'air';
        return v2({ y: 60, steps: 30, blocks });
    } },
    // v2: every plan step unsafe: unsafe-ground (the old 400-step world, 120 steps are enough)
    { ore: 'iron', count: 1, make: () => {
        const blocks = {};
        for (let x = -40; x <= 40; x++) for (let z = -40; z <= 40; z++) for (let y = 8; y <= 19; y++) if (z <= 0 || y < 19) blocks[`${x},${y},${z}`] = 'air';
        return v2({ y: 20, steps: 400, blocks });
    } },
    // v2 heal: eat, wait, done
    { ore: 'iron', count: 1, make: () => {
        const s = v2({ y: 20, steps: 2 });
        s.bot.health = 6; s.bot.food = 12;
        s.deps.eat = async () => { s.bot.food = Math.min(20, s.bot.food + 4); return true; };
        s.deps.sleep = async ms => { if (ms >= 1000) s.bot.health += 1; };
        return s;
    } },
    // v2 heal: no food, hostiles: retreat and stop
    { ore: 'iron', count: 1, make: () => {
        const s = v2({ y: 60, steps: 5 });
        s.bot.health = 4; s.bot.food = 16;
        s.deps.eat = async () => false;
        s.deps.hostiles = () => 1;
        return s;
    } },
    // v2.1: the rules' low-health stop takes the heal path
    { ore: 'iron', count: 1, make: () => {
        const s = v2({ y: 60, steps: 3 });
        Object.assign(s.deps.task, { prompt: 'v2.1', heal_health: 0 });
        s.bot.health = 6; s.bot.food = 20;
        s.deps.sleep = async ms => { if (ms >= 1000) s.bot.health = 20; };
        return s;
    } },
    // mine memory: a first mine (saved), then a second job goes on with it (reused) ...
    { ore: 'iron', count: 1, make: () => { saved = []; const s = v2({ y: 60, steps: 4 }); s.deps.mines = store; firstMine = s; return s; } },
    { ore: 'iron', count: 1, make: () => {
        const s = v2({ y: 60, steps: 2 });
        for (const [k, v] of firstMine.w.m) s.w.m.set(k, v);
        s.bot.entity.position = { x: 0.5, y: 60, z: 3.5 };
        s.bot.entity.yaw = 0;
        s.deps.mines = store;
        return s;
    } },
    // ... and a saved mine that isn't there any more (gone)
    { ore: 'iron', count: 1, make: () => { saved = [{ entrance: { x: 0, y: 60, z: 0 }, heading: 'E', surface: false, ores: ['coal'] }]; const s = v2({ y: 60, steps: 1 }); s.deps.mines = store; return s; } },
    // v2: a torch on the left wall (the rules' torch after 8 moves)
    { ore: 'iron', count: 1, make: () => v2({ y: 20, steps: 10 }) },
];
