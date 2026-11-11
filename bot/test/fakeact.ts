// A fake actuator world for the director's tests: Facts the test edits, an ActBot and a Mover that
// record every call with the lease holder at call time (so a test can check nothing moved the body
// outside the lease), and a Director wired to them.
import { BodyLease } from '../src/core/lease.js';
import type { Act, ActBot, ActEntity, ActItem, Goal } from '../src/actuators/bot.js';
import type { Facts, MobFact, Outcome } from '../src/types/index.js';
import { Director, type DecisionSink, type DirectorLogEntry } from '../src/director/loop.js';
import type { RunnerFactory } from '../src/director/jobs.js';
import type { Timing } from '../src/director/activities.js';

export function baseFacts(over: Partial<Facts> = {}): Facts {
    return {
        t: 0, pos: { x: 0.5, y: 64, z: 0.5 }, health: 20, food: 20, saturation: 5, armed: 'none', armor: 0,
        hostiles: 0, nearest: null, mobs: [], me: null, player: null, nearestPlayer: null,
        light: 15, night: false, time: 6000, under: false, danger: 'none', lavaWithin2: false,
        free: 30, valuables: 0, foodItems: 0, items: [], worn: [], offhand: null, home: null, homeGone: false, stuck: false,
        ...over,
    };
}

/** mobFact: a hostile at (x, z) from the bot at the origin. */
export function mobFact(id: number, name: string, x: number, z: number, attacker: boolean): MobFact {
    const kind = (['zombie', 'skeleton', 'creeper', 'spider'] as const).find(k => name.includes(k)) ?? (name === 'husk' ? 'zombie' : 'other');
    return { id, name, kind, pos: { x, y: 64, z }, dist: Math.hypot(x - 0.5, z - 0.5), health: 20, attacker };
}

export interface Call { what: string; arg?: unknown; holder: string | null }

export interface World {
    facts: Facts;
    calls: Call[];
    entities: Record<string, ActEntity>;
    items: ActItem[];
    said: string[];
    logs: DirectorLogEntry[];
    eats: string[];
    defends: string[];
    notes: string[];
    lease: BodyLease;
    act: Act;
    /** consume() takes this long; Infinity never settles */
    consumeMs: number;
    director: Director;
    /** put a mob into the facts and the entities */
    addMob(m: MobFact): void;
    /** called on each goTo (a test moves andy) */
    onGoTo?: () => void;
    removeMob(id: number): void;
}

const wait = (ms: number, signal?: AbortSignal) => new Promise<boolean>(r => {
    if (signal?.aborted) return r(false);
    const t = setTimeout(() => r(true), ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); r(false); }, { once: true });
});

export function world(opts: { facts?: Partial<Facts>; items?: ActItem[]; timing?: Partial<Timing>; runners?: RunnerFactory; overrunMs?: number } = {}): World {
    const lease = new BodyLease({ overrunMs: opts.overrunMs ?? 2000, log: e => w.notes.push(`${e.event} ${e.runner}`) });
    const w = {} as World;
    const rec = (what: string, arg?: unknown) => { w.calls.push({ what, arg, holder: lease.holderName }); };
    Object.assign(w, {
        facts: baseFacts(opts.facts), calls: [], entities: {}, items: opts.items ?? [], said: [], logs: [], eats: [], defends: [], notes: [],
        lease, consumeMs: 30,
    });
    let held: ActItem | null = null;
    const bot: ActBot = {
        get entity() { return { position: w.facts.pos }; },
        get entities() { return w.entities; },
        get health() { return w.facts.health; },
        get heldItem() { return held; },
        items: () => w.items,
        equip: async item => { rec('equip', item.name); held = item; },
        consume: () => {
            rec('consume', held?.name);
            if (!Number.isFinite(w.consumeMs)) return new Promise<void>(() => {});
            return wait(w.consumeMs).then(() => {
                const it = w.items.find(i => i.name === held?.name);
                if (it) { it.count--; if (it.count <= 0) w.items.splice(w.items.indexOf(it), 1); }
                w.facts = { ...w.facts, food: Math.min(20, w.facts.food + 5) };
            });
        },
        activateItem: () => rec('activate'),
        deactivateItem: () => rec('deactivate'),
        lookAt: async () => { rec('look'); },
        attack: e => { rec('attack', e.id); w.removeMob(e.id); },
        setControlState: (c, on) => rec(`control ${c} ${on}`),
        blockAt: () => null,
        findBlock: () => null,
    };
    const motion = {
        moveFor: async (goal: unknown, ms: number, signal: AbortSignal): Promise<Outcome> => {
            rec('moveFor', goal);
            return (await wait(Math.min(ms, 20), signal)) ? { ok: true } : { ok: false, reason: 'cancelled' };
        },
        goTo: async (goal: unknown, signal: AbortSignal): Promise<Outcome> => {
            rec('goTo', goal);
            w.onGoTo?.();
            return (await wait(20, signal)) ? { ok: true } : { ok: false, reason: 'cancelled' };
        },
        stop: () => rec('stop'),
    };
    const goals = {
        follow: (e: ActEntity, range: number): Goal => ({ follow: e.id, range }),
        near: (p: { x: number }, range: number): Goal => ({ near: p.x, range }),
        invert: (g: Goal): Goal => ({ invert: g }),
    };
    w.act = { bot, motion, goals };
    w.addMob = m => {
        w.entities[m.id] = { id: m.id, name: m.name, position: m.pos };
        const mobs = [...w.facts.mobs, m].sort((a, b) => a.dist - b.dist);
        const near = mobs.filter(x => x.dist <= 16);
        w.facts = { ...w.facts, mobs, hostiles: near.length, nearest: near[0] ? { kind: near[0].kind, dist: Math.ceil(near[0].dist) } : null };
    };
    w.removeMob = id => {
        delete w.entities[id];
        const mobs = w.facts.mobs.filter(x => x.id !== id);
        const near = mobs.filter(x => x.dist <= 16);
        const me = w.facts.me?.entityId === id ? null : w.facts.me;
        const player = w.facts.player && w.facts.player.attacked?.entityId === id ? { ...w.facts.player, attacked: null } : w.facts.player;
        w.facts = { ...w.facts, mobs, me, player, hostiles: near.length, nearest: near[0] ? { kind: near[0].kind, dist: Math.ceil(near[0].dist) } : null };
    };
    const sink: DecisionSink = {
        director: e => w.logs.push(e),
        eat: (d, outcome) => w.eats.push(`${d.food ?? 'none'} ${outcome}`),
        defend: (d, outcome) => w.defends.push(`${d.answer} ${d.targetWord} ${outcome}`),
        note: t => w.notes.push(t),
    };
    w.director = new Director({
        lease, facts: () => w.facts, act: () => w.act,
        models: { director: () => null, eat: () => null, defend: () => null },
        say: t => w.said.push(t), sink,
        timing: { stepMs: 10, quietMs: 3000, checkMs: 0, ...(opts.timing ?? {}) },
        ...(opts.runners ? { runners: opts.runners } : {}),
    });
    return w;
}

export const flush = (ms = 30) => new Promise(r => setTimeout(r, ms));

/** until polls cond every 5 ms up to ms. */
export async function until(cond: () => boolean, ms = 2000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (cond()) return true; await flush(5); }
    return cond();
}
