// A fake SensorBot for the sensors' tests: entities, players, blocks, inventory, hurt events.
import type { SensorBlock, SensorBot, SensorEntity, SensorItem } from '../src/sensors/bot.js';

export interface FakeBot extends SensorBot {
    blocks: Map<string, SensorBlock>;
    hurt(entity: SensorEntity | undefined, source?: SensorEntity): void;
    gone(entity: SensorEntity): void;
    add(e: SensorEntity): SensorEntity;
    addPlayer(name: string, x: number, z: number, y?: number): SensorEntity;
    dig: { name: string; x: number; y: number; z: number } | null;
    listeners(): number;
}

export const FOOD_NAMES = new Set(['apple', 'bread', 'golden_apple', 'rotten_flesh', 'cooked_beef', 'spider_eye', 'pufferfish']);

export function mob(id: number, name: string, x: number, z: number, more: Partial<SensorEntity> = {}): SensorEntity {
    return { id, name, type: 'hostile', position: { x, y: 64, z }, ...more };
}

export function fakeBot(opts: { items?: SensorItem[]; slots?: Record<number, SensorItem>; time?: number; free?: number; health?: number; food?: number; saturation?: number } = {}): FakeBot {
    const me: SensorEntity = { id: 0, name: 'player', type: 'player', username: 'andy', position: { x: 0.5, y: 64, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 }, onGround: true, metadata: [] };
    const entities: Record<string, SensorEntity> = { 0: me };
    const players: Record<string, { username: string; entity?: SensorEntity | null }> = { andy: { username: 'andy', entity: me } };
    const hurtFns = new Set<(e: SensorEntity, s: SensorEntity | undefined) => void>();
    const goneFns = new Set<(e: SensorEntity) => void>();
    const items = opts.items ?? [];
    const slots: (SensorItem | null)[] = Array.from({ length: 46 }, () => null);
    items.forEach((it, i) => { slots[9 + i] = it; });
    for (const [k, v] of Object.entries(opts.slots ?? {})) slots[Number(k)] = v;
    const blocks = new Map<string, SensorBlock>();
    const bot: FakeBot = {
        entity: me, entities, players,
        health: opts.health ?? 20, food: opts.food ?? 20, foodSaturation: opts.saturation ?? 5, oxygenLevel: 20,
        time: { timeOfDay: opts.time ?? 6000 },
        inventory: { items: () => items, slots, emptySlotCount: () => opts.free ?? 36 - items.length },
        blocks,
        blockAt: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? null,
        isFood: n => FOOD_NAMES.has(n),
        dig: null,
        digTarget: () => bot.dig,
        onHurt: fn => { hurtFns.add(fn); return () => { hurtFns.delete(fn); }; },
        onGone: fn => { goneFns.add(fn); return () => { goneFns.delete(fn); }; },
        hurt: (e, s) => { for (const f of hurtFns) f(e as SensorEntity, s); },
        gone: e => { delete entities[e.id]; for (const f of goneFns) f(e); },
        add: e => { entities[e.id] = e; return e; },
        addPlayer: (name, x, z, y = 64) => {
            const e: SensorEntity = { id: 1000 + Object.keys(players).length, name: 'player', type: 'player', username: name, position: { x, y, z } };
            entities[e.id] = e; players[name] = { username: name, entity: e };
            return e;
        },
        listeners: () => hurtFns.size + goneFns.size,
    };
    return bot;
}
