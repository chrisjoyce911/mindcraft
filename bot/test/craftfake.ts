// A fake craft world for the craft loop tests (the old tests' deps: an inventory the fake actions change, a chest,
// the stations), and runCraft: the step runner driven to its end, as the old runCraft(item, count, deps) returned
// {ok, reason, steps}.
import { craftStep, type CraftProgress, type CraftWorld } from '../src/jobs/craft.js';
import { CRAFT_DEFAULTS, type CraftSettings } from '../src/jobs/deps.js';
import type { CraftLine } from '../src/log/jsonl.js';
import type { DecideResult, ModelDecider } from '../src/types/index.js';
import type { CraftAction, Counts, Near } from '../src/models/craft/index.js';

/** answer: a craft reply (Action, Item, Count) with probability p. */
export const answer = (action: string, item: string, count: number, p = 0.9, ms = 3): DecideResult => ({
    model: 'fake', ms, answers: {
        Action: { type: 'choice', top: action, topProbability: p, confident: true, probabilities: { [action]: p } },
        Item: { type: 'choice', top: item, topProbability: p, confident: true, probabilities: { [item]: p } },
        Count: { type: 'choice', top: String(count), topProbability: p, confident: true, probabilities: { [String(count)]: p } },
    },
});

type Act = (g: string, n: number, signal: AbortSignal) => Promise<boolean>;
export interface OldDeps {
    client: ModelDecider | null;
    task: Partial<Omit<CraftSettings, 'model'>>;
    items(): { name: string; count: number }[];
    near(): Partial<Near>;
    readChest?: (signal: AbortSignal) => Promise<Counts | null>;
    act: Record<Exclude<CraftAction, 'done'>, Act>;
}

export interface RunOut { ok: boolean; reason: string; steps: number }

/** runCraft drives the craft runner to its end for a target of `target` of item (a generic name). */
export async function runCraft(item: string, target: number, deps: OldDeps, o: { progress?: CraftProgress; lines?: CraftLine[]; kind?: 'craft' | 'gather'; signal?: AbortSignal } = {}): Promise<RunOut & { say?: string }> {
    const progress: CraftProgress = o.progress ?? { target };
    const world: CraftWorld = {
        items: () => deps.items(),
        near: () => ({ table: false, furnace: false, chest: false, ...deps.near() }),
        readChest: async s => (deps.readChest ? deps.readChest(s) : null),
        act: deps.act,
    };
    const signal = o.signal ?? new AbortController().signal;
    for (let i = 0; i < 200; i++) {
        const r = await craftStep({
            kind: o.kind ?? 'craft', item, count: 1, purpose: 'player', progress,
            settings: () => ({ ...CRAFT_DEFAULTS, log_steps: false, enabled: true, ...deps.task, model: deps.client }),
            world: () => world,
            log: line => o.lines?.push(line),
            checkpoint: () => {},
        }, signal);
        if (r.how === 'end') {
            const ok = r.end.how === 'done';
            const reason = 'reason' in r.end ? r.end.reason : ok ? 'done' : r.end.how;
            return { ok, reason, steps: progress.steps ?? 0, ...(r.say ? { say: r.say } : {}) };
        }
    }
    throw new Error('runCraft: no end after 200 steps');
}

/** fakeWorld is an inventory the fake actions change, a chest and stations (the old laya_craft_loop fake). */
export function fakeWorld(inv: Record<string, number>, { near = {} as Partial<Near>, chest = null as Counts | null, script = [] as (DecideResult | null)[] } = {}) {
    const calls: unknown[][] = [];
    const add = (name: string, n: number) => { inv[name] = (inv[name] || 0) + n; };
    const states: string[] = [];
    const deps: OldDeps = {
        client: { decide: async (_t, state) => { states.push(state); return script.shift() ?? null; } },
        task: { log_steps: false },
        items: () => Object.entries(inv).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count })),
        near: () => near,
        readChest: async () => { calls.push(['readChest']); return chest; },
        act: {
            gather: async (g, n) => { calls.push(['gather', g, n]); add(g === 'log' ? 'oak_log' : g, n); return true; },
            craft: async (g, t) => { calls.push(['craft', g, t]); if (g === 'stick') { inv.oak_planks! -= 2 * t; add('stick', 4 * t); } return true; },
            smelt: async (g, n) => { calls.push(['smelt', g, n]); return true; },
            place: async g => {
                calls.push(['place', g]); inv[g]!--;
                const k = ({ crafting_table: 'table', furnace: 'furnace', chest: 'chest' } as const)[g as 'chest'];
                near[k] = true;
                return true;
            },
            take: async (g, n) => { calls.push(['take', g, n]); add(g, n); return true; },
            store: async (g, n) => { calls.push(['store', g, n]); inv[g] = 0; return true; },
        },
    };
    return { deps, calls, states, inv };
}
