// The part of a mineflayer bot the actuators use (a fake in tests), the pathfinder goals they build, and the
// adapters from a live bot. Actuators move the body only through Motion (design §4) and never chat.
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Outcome, Vec3Like } from '../types/index.js';
import type { GoToOptions } from '../core/motion.js';

export interface ActEntity { id: number; name?: string | undefined; username?: string | undefined; position: Vec3Like; height?: number; isValid?: boolean }
export interface ActItem { name: string; count: number }
export type Hand = 'hand' | 'off-hand';
export type Control = 'jump' | 'forward' | 'back' | 'sprint';

export interface ActBot {
    readonly entity: { position: Vec3Like };
    readonly entities: Readonly<Record<string, ActEntity>>;
    readonly health: number;
    readonly heldItem: ActItem | null;
    items(): ActItem[];
    equip(item: ActItem, hand: Hand): Promise<void>;
    /** Eat or drink the held item (mineflayer consume(); it can't be cancelled). */
    consume(): Promise<void>;
    activateItem(offHand?: boolean): void;
    deactivateItem(): void;
    lookAt(p: Vec3Like, force?: boolean): Promise<void>;
    attack(e: ActEntity): void;
    setControlState(c: Control, on: boolean): void;
    blockAt(x: number, y: number, z: number): { name: string } | null;
    /** The nearest block named `name` within maxDistance, or null. */
    findBlock(name: string, maxDistance: number): Vec3Like | null;
}

/** The pathfinder goals the actuators use (opaque to them). */
export type Goal = object;
export interface Goals {
    follow(e: ActEntity, range: number): Goal;
    near(p: Vec3Like, range: number): Goal;
    invert(g: Goal): Goal;
}

/** What actuators need of Motion (core/motion.ts satisfies it). */
export interface Mover {
    moveFor(goal: unknown, ms: number, signal: AbortSignal): Promise<Outcome>;
    goTo(goal: unknown, signal: AbortSignal, opts?: GoToOptions): Promise<Outcome>;
    stop(): void;
}

/** One actuator context: the bot, its Motion, the goals. */
export interface Act { bot: ActBot; motion: Mover; goals: Goals }

const v = (p: Vec3Like): Vec3 => new Vec3(p.x, p.y, p.z);

/** actBot reads and moves a live mineflayer bot through the ActBot interface. */
export function actBot(bot: Bot): ActBot {
    return {
        get entity() { return bot.entity; },
        get entities() { return bot.entities as unknown as Record<string, ActEntity>; },
        get health() { return bot.health; },
        get heldItem() { return bot.heldItem; },
        items: () => bot.inventory.items(),
        equip: async (item, hand) => {
            const it = bot.inventory.items().find(i => i.name === item.name);
            if (!it) throw new Error(`no ${item.name}`);
            await bot.equip(it, hand);
        },
        consume: () => bot.consume(),
        activateItem: offHand => bot.activateItem(offHand),
        deactivateItem: () => bot.deactivateItem(),
        lookAt: (p, force) => bot.lookAt(v(p), force),
        attack: e => { const ent = bot.entities[e.id]; if (ent) bot.attack(ent); },
        setControlState: (c, on) => bot.setControlState(c, on),
        blockAt: (x, y, z) => { try { return bot.blockAt(new Vec3(x, y, z)); } catch { return null; } },
        findBlock: (name, maxDistance) => {
            const id = bot.registry.blocksByName[name]?.id;
            if (id === undefined) return null;
            return bot.findBlock({ matching: id, maxDistance })?.position ?? null;
        },
    };
}

const { goals: G } = pathfinderPkg;

/** realGoals builds mineflayer-pathfinder goals (GoalFollow wants the live entity). */
export function realGoals(bot: Bot): Goals {
    return {
        follow: (e, range) => new G.GoalFollow((bot.entities[e.id] ?? e) as never, range),
        near: (p, range) => new G.GoalNear(p.x, p.y, p.z, range),
        invert: g => new G.GoalInvert(g as never),
    };
}
