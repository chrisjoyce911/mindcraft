// The old mine loop tests' fake world (test/laya_mine_loop.test.js setup/v2) and runMine: the old
// mineWithLaya(bot, ore, count, deps) over the new MineRun, stepping until it ends. The old deps' names and shapes
// are kept, so the ported tests read as the old ones; an adapter turns them into a MineWorld.
import type { DecideResult, ModelDecider, Vec3Like } from '../src/types/index.js';
import { MineRun, type MineEnd, type MineProgress, type MineWorld } from '../src/jobs/mine.js';
import { MINE_DEFAULTS, type MineSettings } from '../src/jobs/deps.js';
import { ORES, type Ore, type Stack } from '../src/models/mine/index.js';
import type { MineBook, MineRecord } from '../src/home/mines.js';
import type { MineLine } from '../src/log/jsonl.js';

export const EMPTY = new Set(['air', 'torch', 'lava', 'water']);
export interface FakeBlock { name: string; boundingBox: 'empty' | 'block' }

/** fakeWorld is solid stone with set blocks; andy stands at feet (0, y, 0) in a short tunnel heading east. */
export function fakeWorld(y: number, blocks: Record<string, string> = {}) {
    const m = new Map(Object.entries(blocks));
    for (const [x, z] of [[0, 0], [-1, 0]] as const) {
        for (const k of [`${x},${y},${z}`, `${x},${y + 1},${z}`]) if (x === 0 || !m.has(k)) m.set(k, 'air');
    }
    return {
        m,
        blockAt: (x: number, yy: number, z: number): FakeBlock => {
            const name = m.get(`${x},${yy},${z}`) ?? 'stone';
            return { name, boundingBox: EMPTY.has(name) ? 'empty' : 'block' };
        },
    };
}

/** answer is a client answer for an action. */
export const answer = (action: string, p = 0.9, ms = 2): DecideResult => ({ model: 'fake', ms, answers: {
    Action: { type: 'choice', top: action, topProbability: p, probabilities: {}, confident: p >= 0.4 },
    Hazard: { type: 'noul', probability: 0.1, top: 'false', topProbability: 0.9, confident: true },
} });

export const withUnload = (a: DecideResult, p: number, confident = true): DecideResult =>
    ({ ...a, answers: { ...a.answers, Unload: { type: 'noul', probability: p, top: p > 0.5 ? 'true' : 'false', topProbability: Math.max(p, 1 - p), confident } } });

export interface FakeBot { entity: { position: Vec3Like; yaw: number }; health?: number; food?: number }

/** The old deps (mineWithLaya's), as the old tests set and override them. */
export interface OldDeps {
    client: { decide(task: string, state: string): Promise<DecideResult | null> } | null;
    task: Partial<Omit<MineSettings, 'model' | 'enabled'>> & Record<string, unknown>;
    blockAt: (x: number, y: number, z: number) => FakeBlock;
    inventory(): Record<string, number>;
    nearestOre?: (names: readonly string[], range: number) => Vec3Like | null;
    ores?: (names: readonly string[], range: number) => Vec3Like[];
    craft(item: string, n: number): Promise<boolean>;
    collect(names: readonly string[], n: number, o: Vec3Like): Promise<boolean>;
    dig(x: number, y: number, z: number): Promise<boolean>;
    moveTo(x: number, y: number, z: number, ms?: number): Promise<boolean>;
    place(item: string, x: number, y: number, z: number, on?: string): Promise<boolean>;
    freeSlots?: () => number;
    home?: () => Vec3Like | null;
    hostiles?: () => number;
    isFood?: (n: string) => boolean;
    goHome?: (h: Vec3Like) => Promise<boolean>;
    deposit?: (items: Stack[]) => Promise<boolean>;
    eat?: () => Promise<boolean>;
    chat?: (msg: string) => void;
    sleep?: (ms: number) => Promise<unknown>;
    log(msg: string): void;
    mines?: { find(f: Vec3Like): MineRecord | null; save(r: MineRecord): void; forget?: (e: Vec3Like) => void };
    progress?: MineProgress;
}

export interface Calls {
    decide: string[]; dug: number[][]; moves: number[][]; placed: unknown[][]; crafted: string[]; collected: number; logs: string[];
    chat: string[]; walks: number[][]; home: Vec3Like[]; deposited: Stack[][];
}

export interface Setup {
    y?: number; blocks?: Record<string, string>; inv?: Record<string, number>; decide?: (state: string, n: number) => DecideResult | null;
    craftOk?: boolean; ore?: Ore; steps?: number; free?: number; home?: Vec3Like | null;
}

export function setup({ y = 16, blocks = {}, inv = { stone_pickaxe: 1, torch: 5, cobblestone: 10 }, decide = () => null, craftOk = true, ore = 'iron' }: Setup = {}) {
    const w = fakeWorld(y, blocks);
    const bot: FakeBot = { entity: { position: { x: 0.5, y, z: 0.5 }, yaw: -Math.PI / 2 } };
    const calls: Calls = { decide: [], dug: [], moves: [], placed: [], crafted: [], collected: 0, logs: [], chat: [], walks: [], home: [], deposited: [] };
    const inventory: Record<string, number> = { ...inv };
    const deps: OldDeps = {
        client: { decide: async (_task, state) => { calls.decide.push(state); return decide(state, calls.decide.length); } },
        task: { log_steps: false, max_steps: 40, prompt: 'v1' },
        blockAt: w.blockAt,
        inventory: () => ({ ...inventory }),
        nearestOre: (names, range) => {
            const p = bot.entity.position;
            let best: (Vec3Like & { d: number }) | null = null;
            for (const [k, name] of w.m) {
                if (!names.includes(name)) continue;
                const [x, yy, z] = k.split(',').map(Number) as [number, number, number];
                const d = Math.hypot(x - p.x, yy - p.y, z - p.z);
                if (d <= range && (!best || d < best.d)) best = { x, y: yy, z, d };
            }
            return best;
        },
        craft: async (item, n) => { calls.crafted.push(item); if (craftOk) inventory[item] = (inventory[item] || 0) + n; return craftOk; },
        collect: async names => {
            for (const [k, name] of w.m) if (names.includes(name)) {
                w.m.set(k, 'air');
                inventory[ORES[ore].drop] = (inventory[ORES[ore].drop] || 0) + 1;
                calls.collected++;
                return true;
            }
            return false;
        },
        dig: async (x, yy, z) => { calls.dug.push([x, yy, z]); w.m.set(`${x},${yy},${z}`, 'air'); return true; },
        moveTo: async (x, yy, z) => { calls.moves.push([x, yy, z]); bot.entity.position = { x: x + 0.5, y: yy, z: z + 0.5 }; return true; },
        place: async (item, x, yy, z) => { calls.placed.push([item, x, yy, z]); w.m.set(`${x},${yy},${z}`, item === 'torch' ? 'torch' : 'stone'); inventory[item]!--; return true; },
        sleep: async () => {},
        log: msg => calls.logs.push(msg),
    };
    return { bot, deps, calls, w, inventory };
}

/** v2 sets a v2 run up: the rules answer (no model) unless decide is given. */
export function v2(opts: Setup = {}) {
    const s = setup({ decide: () => null, ...opts });
    Object.assign(s.deps.task, { prompt: 'v2', max_steps: opts.steps ?? 20 });
    const moveTo = s.deps.moveTo;
    s.deps.moveTo = async (x, y, z, ms) => { if (ms) s.calls.walks.push([x, y, z]); return moveTo(x, y, z); };
    s.deps.place = async (item, x, y, z, on) => { s.calls.placed.push([item, x, y, z, on]); s.w.m.set(`${x},${y},${z}`, item === 'torch' ? 'torch' : 'stone'); s.inventory[item]!--; return true; };
    s.deps.chat = msg => s.calls.chat.push(msg);
    s.deps.freeSlots = () => opts.free ?? 20;
    s.deps.home = () => opts.home ?? null;
    s.deps.hostiles = () => 0;
    s.deps.isFood = n => n === 'bread';
    s.deps.goHome = async h => { s.calls.home.push(h); s.bot.entity.position = { x: h.x + 0.5, y: h.y, z: h.z + 1.5 }; return true; };
    s.deps.deposit = async items => {
        s.calls.deposited.push(items);
        for (const { name, count } of items) s.inventory[name]! -= count;
        return true;
    };
    return s;
}

/** worldOf adapts the old deps to a MineWorld. */
export function worldOf(bot: FakeBot, deps: OldDeps): MineWorld {
    return {
        position: () => bot.entity.position,
        yaw: () => bot.entity.yaw,
        health: () => bot.health ?? 20,
        food: () => bot.food ?? 20,
        blockAt: (x, y, z) => deps.blockAt(x, y, z),
        inventory: () => deps.inventory(),
        ores: (blocks, range) => deps.ores ? deps.ores(blocks, range) : [deps.nearestOre?.(blocks, range)].filter((o): o is Vec3Like => !!o).map(o => ({ x: o.x, y: o.y, z: o.z })),
        freeSlots: () => deps.freeSlots?.() ?? 36,
        home: () => deps.home?.() ?? null,
        hostiles: () => deps.hostiles?.() ?? 0,
        isFood: n => deps.isFood?.(n) ?? false,
        craft: (item, n) => deps.craft(item, n),
        collect: (o, blocks) => deps.collect(blocks, 1, o),
        dig: p => deps.dig(p.x, p.y, p.z),
        moveTo: (c, ms) => (ms === null ? deps.moveTo(c.x, c.y, c.z) : deps.moveTo(c.x, c.y, c.z, ms)),
        place: (item, p, on) => deps.place(item, p.x, p.y, p.z, on),
        goHome: async h => (deps.goHome ? deps.goHome(h) : false),
        deposit: async items => (deps.deposit ? deps.deposit([...items]) : false),
        eat: async () => (deps.eat ? deps.eat() : false),
        sleep: async ms => { await deps.sleep?.(ms); return true; },
    };
}

/** The result of a run, as the old mineWithLaya returned it. */
export type RunResult = MineEnd;

/** runMine runs a mine job to its end (the old mineWithLaya), collecting its log lines. */
export async function runMine(bot: FakeBot, ore: string, count: number | 'forever', deps: OldDeps, o: { lines?: MineLine[]; signal?: AbortSignal } = {}): Promise<RunResult> {
    const client: ModelDecider | null = deps.client ? { decide: (task, state) => deps.client!.decide(task, state) } : null;
    const progress: MineProgress = deps.progress ?? {};
    const mines: MineBook | null = deps.mines ? { find: f => deps.mines!.find(f), save: r => deps.mines!.save(r), forget: e => deps.mines!.forget?.(e) } : null;
    const run = new MineRun({
        ore: ore as Ore, count, progress,
        settings: () => ({ ...MINE_DEFAULTS, ...deps.task, enabled: true, model: client } as MineSettings),
        world: () => worldOf(bot, deps),
        mines,
        log: line => { o.lines?.push(line); },
        note: msg => deps.log(msg),
        chat: msg => deps.chat?.(msg),
        checkpoint: () => {},
    });
    const signal = o.signal ?? new AbortController().signal;
    for (let i = 0; i < 100000; i++) {
        const r = await run.step(signal);
        if (r.how === 'end') return r.end;
        if (signal.aborted) { run.close(); return { ok: false, reason: 'interrupted', collected: 0, counters: run.counters, reused: false }; }
    }
    throw new Error('never ended');
}
