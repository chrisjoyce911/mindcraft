// The part of a mineflayer bot the actuators use (a fake in tests), the pathfinder goals they build, and the
// adapters from a live bot. Actuators move the body only through Motion (design §4) and never chat.
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Outcome, Vec3Like } from '../types/index.js';
import type { GoToOptions } from '../core/motion.js';

export interface ActEntity { id: number; name?: string | undefined; username?: string | undefined; position: Vec3Like; height?: number; isValid?: boolean }
export interface ActItem { name: string; count: number }
/** A block as the actuators and the follow state read it (a mineflayer Block fits). */
export interface ActBlock { name: string; boundingBox?: string; getProperties?: () => Record<string, unknown> }
/** An open container (a chest): deposit by item name, close. */
export interface ActContainer {
    deposit(name: string, count: number): Promise<void>;
    close(): void;
}
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
    blockAt(x: number, y: number, z: number): ActBlock | null;
    /** The nearest block named `name` within maxDistance, or null. */
    findBlock(name: string, maxDistance: number): Vec3Like | null;
    /** andy's username. */
    readonly username: string;
    /** A player's entity when it is loaded (bot.players[name].entity), or null. */
    player(name: string): ActEntity | null;
    /** Positions of blocks named one of `names` within maxDistance of point (at most count). */
    findBlocks(names: readonly string[], point: Vec3Like, maxDistance: number, count: number): Vec3Like[];
    /** Open the container block at p (rejects when it won't open). */
    openContainer(p: Vec3Like): Promise<ActContainer>;
    /** Toss up to count of the item named `name` (across stacks); resolves with how many were tossed. */
    toss(name: string, count: number): Promise<number>;
    /** Resolves true when `player` picks up an item within ms, false after ms or on abort. */
    waitCollect(player: string, ms: number, signal: AbortSignal): Promise<boolean>;
}

/** The pathfinder goals the actuators use (opaque to them). */
export type Goal = object;
export interface Goals {
    follow(e: ActEntity, range: number): Goal;
    /** x and z only (the follow step: a misread height must not make the step unreachable). */
    xz(x: number, z: number): Goal;
    near(p: Vec3Like, range: number): Goal;
    invert(g: Goal): Goal;
}

/** What actuators need of Motion (core/motion.ts satisfies it). */
export interface Mover {
    moveFor(goal: unknown, ms: number, signal: AbortSignal): Promise<Outcome>;
    moveUntil(goal: unknown, ms: number, done: () => boolean, signal: AbortSignal): Promise<Outcome>;
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
        get username() { return bot.username; },
        player: name => (bot.players[name]?.entity as unknown as ActEntity | undefined) ?? null,
        findBlocks: (names, point, maxDistance, count) => {
            const ids = names.map(n => bot.registry.blocksByName[n]?.id).filter((id): id is number => id !== undefined);
            if (!ids.length) return [];
            return bot.findBlocks({ point: v(point), matching: ids, maxDistance, count }).map(p => ({ x: p.x, y: p.y, z: p.z }));
        },
        openContainer: async p => {
            const block = bot.blockAt(v(p));
            if (!block) throw new Error('no block there');
            const c = await bot.openContainer(block);
            return {
                deposit: async (name, count) => {
                    const id = bot.registry.itemsByName[name]?.id;
                    if (id === undefined) throw new Error(`unknown item ${name}`);
                    await c.deposit(id, null, count);
                },
                close: () => c.close(),
            };
        },
        toss: async (name, count) => {
            let tossed = 0;
            while (tossed < count) {
                const it = bot.inventory.items().find(i => i.name === name);
                if (!it) break;
                const n = Math.min(count - tossed, it.count);
                await bot.toss(it.type, null, n);
                tossed += n;
            }
            return tossed;
        },
        waitCollect: (player, ms, signal) => new Promise<boolean>(resolve => {
            if (signal.aborted) return resolve(false);
            const done = (v: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', onAbort); bot.removeListener('playerCollect', onCollect); resolve(v); };
            const onCollect = (collector: { username?: string }) => { if (collector?.username === player) done(true); };
            const onAbort = () => done(false);
            const timer = setTimeout(() => done(false), ms);
            signal.addEventListener('abort', onAbort, { once: true });
            bot.on('playerCollect', onCollect as never);
        }),
    };
}

const { goals: G } = pathfinderPkg;

/** realGoals builds mineflayer-pathfinder goals (GoalFollow wants the live entity). */
export function realGoals(bot: Bot): Goals {
    return {
        follow: (e, range) => new G.GoalFollow((bot.entities[e.id] ?? e) as never, range),
        xz: (x, z) => new G.GoalXZ(x, z),
        near: (p, range) => new G.GoalNear(p.x, p.y, p.z, range),
        invert: g => new G.GoalInvert(g as never),
    };
}
