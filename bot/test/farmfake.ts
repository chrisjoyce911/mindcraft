// The old farm loop tests' fakes (test/laya_farm.test.js setup/setupV2) and runFarm: the old
// farmWithLaya(bot, goal, deps) over the new FarmRun, stepping until it ends. The old deps' names and shapes are
// kept, so the ported tests read as the old ones; an adapter turns them into a FarmWorld.
import type { DecideResult, ModelDecider, Vec3Like } from '../src/types/index.js';
import { FarmRun, type FarmCounters, type FarmProgress, type FarmWorld } from '../src/jobs/farm.js';
import { FARM_DEFAULTS, type FarmSettings } from '../src/jobs/deps.js';
import { readFarm, type FarmCrop, type FarmView } from '../src/models/farm/index.js';
import type { Stack } from '../src/home/chest.js';
import type { FarmLine } from '../src/log/jsonl.js';

// The golden farm (laya-go games/farm/prompt sampleRows), ground at Y0.
export const ROWS = ['GGGGGXGGL', 'G111211GL', 'G11W1F1GL', 'G121113GL', 'GGGGX33GL', 'XXXXXXXXX', 'GGGGGGGGL', 'OOOOOOOOO', 'LLLLLLLLL'];
export const Y0 = 64;
const CROP_BLOCKS: Record<string, [string, number]> = { 1: ['wheat', 3], 2: ['wheat', 7], 3: ['carrots', 2], 4: ['carrots', 7], 5: ['potatoes', 1], 6: ['potatoes', 7], 7: ['beetroots', 1], 8: ['beetroots', 3] };
const CROP_NAMES = new Set(['wheat', 'carrots', 'potatoes', 'beetroots']);

export interface RowBlock { name: string; boundingBox: 'empty' | 'block'; getProperties?: () => Record<string, unknown> }

/** worldFromRows builds blockAt for rows whose top-left cell is world (0, 0); outside them is grass with no water. */
export function worldFromRows(rows: readonly string[]) {
    const block = (name: string, extra: Partial<RowBlock> = {}): RowBlock =>
        ({ name, boundingBox: name === 'air' || name === 'water' || CROP_NAMES.has(name) ? 'empty' : 'block', ...extra });
    return (x: number, y: number, z: number): RowBlock => {
        const code = rows[z]?.[x] ?? 'L';
        if (y > Y0 + 1) return block('air');
        if (y < Y0) return block('stone');
        if (y === Y0) {
            if (code === 'W') return block('water');
            if (code === 'X') return block('stone');
            if ('GLO'.includes(code)) return block('grass_block');
            return block('farmland');
        }
        if (code === 'O') return block('oak_fence');
        const crop = CROP_BLOCKS[code];
        if (crop) return block(crop[0], { getProperties: () => ({ age: crop[1] }) });
        return block('air');
    };
}

export const ITEMS = [{ name: 'iron_hoe', count: 1 }, { name: 'stone', count: 64 }, { name: 'bone_meal', count: 3 }, { name: 'carrot', count: 5 }, { name: 'wheat_seeds', count: 12 }];
export const ANIMALS = [
    { kind: 'cow', x: 2, z: 7 }, { kind: 'cow', x: 3, z: 8 }, { kind: 'cow', x: 3, z: 9, baby: true },
    { kind: 'pig', x: 6, z: 8 }, { kind: 'pig', x: 7, z: 8 }, { kind: 'pig', x: 8, z: 9 },
    { kind: 'sheep', x: 40, z: 40 }, { kind: 'zombie', x: 4, z: 6 },
];

export const sample = (): FarmView => readFarm(worldFromRows(ROWS), 4, Y0 + 1, 4, ITEMS, ANIMALS);

// The trial's savanna plateau (bots/andy/logs/laya-farm.jsonl): all dry.
export const PLATEAU = ['XXLLLLLLL', 'XXLLLLLLL', 'XLLLLLLLL', 'LLLLLLLXL', 'LLLLLLLLL', 'LLLLLLLXL', 'LLLLLLLLL', 'LLLLLLLLL', 'LLLLLLLLL'];
export const plateau = (carry: FarmView['carry']): FarmView =>
    ({ grid: PLATEAU.map(r => [...r] as FarmView['grid'][number]), ys: PLATEAU.map(() => Array<number>(9).fill(Y0)), carry, animals: [] });

/** reply: a client answer for Action, Target and Item. */
export function reply(action: string, target: string, item: string, p = 0.9, ms = 3): DecideResult {
    const ans = (top: string) => ({ type: 'choice' as const, top, topProbability: p, confident: p >= 0.5, probabilities: { [top]: p } });
    return { model: 'fake', ms, answers: { Action: ans(action), Target: ans(target), Item: ans(item) } };
}

export type Answer = DecideResult | null | (() => DecideResult | null);

/** The old deps (farmWithLaya's), as the old tests set and override them. */
export interface OldDeps {
    client: { decide(task: string, state: string, q: unknown): Promise<DecideResult | null> };
    task: Partial<Omit<FarmSettings, 'model' | 'enabled'>>;
    read(): FarmView;
    act(action: string, target: string, item: string, s: FarmView): Promise<boolean>;
    craft(item: string, count: number): Promise<boolean>;
    now(): number;
    sleep(ms: number): Promise<void>;
    log(msg: string): void;
    inventory?: () => Record<string, number>;
    say?: (msg: string) => void;
    position?: () => Vec3Like;
    goTo?: (p: Vec3Like) => Promise<boolean>;
    findWater?: (radius: number) => Promise<Vec3Like | null>;
    pack?: {
        freeSlots(): number; hostiles(): number; health(): number; food(): number; home(): Vec3Like | null;
        goHome(h: Vec3Like): Promise<boolean>; deposit(items: Stack[]): Promise<boolean>; isFood(n: string): boolean;
    };
}

export interface Calls { act: [string, string, string][]; craft: [string, number][]; asked: number; walked: Vec3Like[]; deposited: Stack[][]; home: number }

export function setup(answers: Answer[], { situation = sample(), craftOk = true }: { situation?: FarmView; craftOk?: boolean } = {}) {
    let t = 0, i = 0;
    const calls: Calls = { act: [], craft: [], asked: 0, walked: [], deposited: [], home: 0 };
    let s = situation;
    const deps: OldDeps = {
        client: { decide: async () => { calls.asked++; const a = answers[Math.min(i++, answers.length - 1)]!; return typeof a === 'function' ? a() : a; } },
        task: { step_ms: 10, max_steps: answers.length, max_misses: 2 },
        read: () => s,
        act: async (action, target, item) => {
            calls.act.push([action, target, item]);
            // a harvest changes what andy carries (a done step on an unchanged state is a no-op: FarmRun fails it)
            if (action === 'harvest') s = { ...s, carry: [...s.carry.filter(c => c.item !== 'wheat'), { item: 'wheat', count: (s.carry.find(c => c.item === 'wheat')?.count ?? 0) + 1 }] };
            return true;
        },
        craft: async (item, count) => {
            calls.craft.push([item, count]);
            if (craftOk) s = { ...s, carry: [...s.carry, { item: item as FarmView['carry'][number]['item'], count }] };
            return craftOk;
        },
        now: () => t, sleep: async ms => { t += ms; }, log: () => {},
    };
    return { deps, calls, bot: {} as FakeBot };
}

export interface V2Opts { situation?: FarmView; inv?: Record<string, number>; water?: Vec3Like | null; home?: Vec3Like | null; free?: () => number; task?: OldDeps['task'] }

export function setupV2(answers: Answer[], { situation, inv = {}, water = null, home = null, free = () => 20, task = {} }: V2Opts = {}) {
    const { deps, calls, bot } = setup(answers, situation ? { situation } : {});
    const said: string[] = [];
    const inventory: Record<string, number> = { ...inv };
    Object.assign(deps, {
        task: { ...deps.task, prompt: 'v2', wait_limit: 3, ...task },
        inventory: () => ({ ...inventory }),
        say: (m: string) => said.push(m),
        position: () => ({ x: 0, y: Y0 + 1, z: 0 }),
        goTo: async (p: Vec3Like) => { calls.walked.push(p); return true; },
        findWater: async () => water,
        pack: {
            freeSlots: () => free(), hostiles: () => 0, health: () => 20, food: () => 20,
            home: () => home, goHome: async () => { calls.home++; return true; },
            deposit: async (items: Stack[]) => { calls.deposited.push(items); for (const i of items) inventory[i.name]! -= i.count; return true; },
            isFood: (n: string) => n === 'bread',
        },
    });
    const act = deps.act;
    deps.act = async (action, target, item, s) => {
        if (action === 'harvest') inventory.wheat = (inventory.wheat || 0) + 6;
        return act(action, target, item, s);
    };
    return { deps, calls, bot, said };
}

/** The old bot argument: interrupt_code set stops the loop before it asks. */
export interface FakeBot { interrupt_code?: boolean }

/** worldOf adapts the old deps to a FarmWorld (deps.pack is read at each call: the tests swap its functions). */
export function worldOf(deps: OldDeps): FarmWorld {
    const p = () => deps.pack;
    return {
        read: () => deps.read(),
        act: (action, target, item, s) => deps.act(action, target, item, s),
        craft: (item, n) => deps.craft(item, n),
        inventory: () => deps.inventory?.() ?? {},
        position: () => deps.position?.() ?? null,
        goTo: async q => (deps.goTo ? deps.goTo(q) : false),
        findWater: async r => (deps.findWater ? deps.findWater(r) : null),
        freeSlots: () => p()?.freeSlots() ?? 36,
        hostiles: () => p()?.hostiles() ?? 0,
        health: () => p()?.health() ?? 20,
        food: () => p()?.food() ?? 20,
        home: () => p()?.home() ?? null,
        goHome: async h => (p() ? p()!.goHome(h) : false),
        deposit: async items => (p() ? p()!.deposit([...items]) : false),
        isFood: n => p()?.isFood(n) ?? false,
        sleep: async ms => { await deps.sleep(ms); return true; },
    };
}

/** The old goal: a number of milliseconds (timed: max_steps), or {crop, count, progress}. */
export type OldGoal = number | { crop?: FarmCrop; count?: number | null; progress?: FarmProgress };

/** runFarm runs a farm to its end (the old farmWithLaya), collecting its log lines; it returns the counters. */
export async function runFarm(bot: FakeBot, goal: OldGoal, deps: OldDeps, o: { lines?: FarmLine[] } = {}): Promise<FarmCounters> {
    const timed = typeof goal === 'number';
    const g = timed ? { crop: 'any' as FarmCrop, count: null } : { crop: goal.crop ?? 'any', count: goal.count ?? null, progress: goal.progress };
    const client: ModelDecider = { decide: (task, state, q) => deps.client.decide(task, state, q) };
    const task = { ...deps.task };
    // the old timed goal: max_steps and a time limit (the minutes goal itself arrives with 5.6)
    if (timed) task.max_steps_open = task.max_steps ?? FARM_DEFAULTS.max_steps;
    const run = new FarmRun({
        crop: g.crop, count: g.count ?? 'forever', progress: ('progress' in g && g.progress) || {},
        settings: () => ({ ...FARM_DEFAULTS, ...task, enabled: true, model: client } as FarmSettings),
        world: () => worldOf(deps),
        log: line => { o.lines?.push(line); },
        note: msg => deps.log(msg),
        chat: msg => deps.say?.(msg),
        checkpoint: () => {},
    });
    const end = timed ? deps.now() + goal : Infinity;
    const signal = new AbortController().signal;
    for (let i = 0; i < 100000; i++) {
        if (bot.interrupt_code) { run.counters.reason = 'stopped'; return run.counters; }
        if (deps.now() >= end) { run.counters.reason = 'time'; return run.counters; }
        const r = await run.step(signal);
        if (r.how === 'end') {
            if (r.end.say) deps.say?.(r.end.say);
            return run.counters;
        }
    }
    throw new Error('never ended');
}
