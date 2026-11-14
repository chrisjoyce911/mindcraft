// The part of a mineflayer bot the sensors read (a fake in tests), and the adapter from a real bot.
import type { Bot } from 'mineflayer';
import { Vec3 } from 'vec3';
import type { Vec3Like } from '../types/index.js';

export interface SensorEntity {
    id: number;
    name?: string | undefined;
    type?: string;
    username?: string | undefined;
    position: Vec3Like;
    velocity?: Vec3Like;
    onGround?: boolean;
    metadata?: readonly unknown[];
    health?: number | undefined;
    isValid?: boolean;
}
export interface SensorBlock { name: string; light?: number; skyLight?: number; boundingBox?: string }
export interface SensorItem { name: string; count: number }
export interface SensorBot {
    entity: SensorEntity;
    entities: Readonly<Record<string, SensorEntity>>;
    players: Readonly<Record<string, { username: string; entity?: SensorEntity | null }>>;
    health: number; food: number; foodSaturation: number; oxygenLevel: number;
    time: { timeOfDay: number };
    inventory: { items(): SensorItem[]; slots: readonly (SensorItem | null | undefined)[]; emptySlotCount(): number };
    blockAt(x: number, y: number, z: number): SensorBlock | null;
    /** minecraft-data's foods (bot.registry.foodsByName). */
    isFood(name: string): boolean;
    /** The block being dug, or null. */
    digTarget(): { name: string; x: number; y: number; z: number } | null;
    /** entityHurt(entity, source?) subscription; returns the unsubscribe. */
    onHurt(fn: (entity: SensorEntity, source: SensorEntity | undefined) => void): () => void;
    /** entityGone(entity) subscription; returns the unsubscribe. */
    onGone(fn: (entity: SensorEntity) => void): () => void;
}

/** sensorBot reads a live mineflayer bot through the SensorBot interface. */
export function sensorBot(bot: Bot): SensorBot {
    const foods = (bot.registry as unknown as { foodsByName?: Record<string, unknown> }).foodsByName ?? {};
    return {
        get entity() { return bot.entity; },
        get entities() { return bot.entities; },
        get players() { return bot.players; },
        get health() { return bot.health; },
        get food() { return bot.food; },
        get foodSaturation() { return bot.foodSaturation; },
        get oxygenLevel() { return bot.oxygenLevel; },
        get time() { return bot.time; },
        get inventory() { return bot.inventory; },
        blockAt: (x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)); } catch { return null; } },
        isFood: name => Object.hasOwn(foods, name),
        digTarget: () => {
            const b = (bot as unknown as { targetDigBlock?: { name: string; position: Vec3Like } | null }).targetDigBlock;
            return b ? { name: b.name, x: b.position.x, y: b.position.y, z: b.position.z } : null;
        },
        onHurt: fn => {
            const h = (e: SensorEntity, s: SensorEntity | undefined) => fn(e, s);
            bot.on('entityHurt', h);
            return () => { bot.off('entityHurt', h); };
        },
        onGone: fn => {
            const h = (e: SensorEntity) => fn(e);
            bot.on('entityGone', h);
            return () => { bot.off('entityGone', h); };
        },
    };
}

/** dist3 is the straight-line distance between two points. */
export const dist3 = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
