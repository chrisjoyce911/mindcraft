// The part of a mineflayer bot the actuators use (a fake in tests), the pathfinder goals they build, and the
// adapters from a live bot. Actuators move the body only through Motion (design §4) and never chat.
import type { Bot } from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import { Vec3 } from 'vec3';
import type { Outcome, Vec3Like } from '../types/index.js';
import type { GoToOptions } from '../core/motion.js';

export interface ActEntity { id: number; name?: string | undefined; type?: string | undefined; username?: string | undefined; position: Vec3Like; height?: number; isValid?: boolean;
    /** The entity's metadata (mineflayer's array; 1.21: 16 a baby, a sheep's 17 has 0x10 when sheared). */
    metadata?: readonly unknown[] }
export interface ActItem { name: string; count: number }
/** A block as the actuators and the follow state read it (a mineflayer Block fits). metadata 0: a liquid's source. */
export interface ActBlock { name: string; boundingBox?: string; metadata?: number; /** Block light (mineflayer Block.light). */ light?: number; getProperties?: () => Record<string, unknown>; getSignText?: () => unknown }
/** An open container (a chest): its items, deposit and withdraw by item name, close. */
export interface ActContainer {
    /** The container's own slots' items (not andy's inventory). */
    items(): ActItem[];
    deposit(name: string, count: number): Promise<void>;
    withdraw(name: string, count: number): Promise<void>;
    close(): void;
}
/** An open furnace: its three slots, put and take, close. */
export interface ActFurnace {
    input(): ActItem | null;
    fuel(): ActItem | null;
    output(): ActItem | null;
    putFuel(name: string, count: number): Promise<void>;
    putInput(name: string, count: number): Promise<void>;
    /** Takes the output stack; resolves with what was taken (null: nothing). */
    takeOutput(): Promise<ActItem | null>;
    takeInput(): Promise<void>;
    takeFuel(): Promise<void>;
    close(): void;
}
/** A crafting recipe andy has the ingredients for (bot.recipesFor through minecraft-data): one craft's result and needs. */
export interface ActRecipe {
    /** How many one craft makes. */
    result: number;
    /** What one craft uses. */
    needs: ActItem[];
    /** The live recipe (opaque to the actuators). */
    readonly ref: unknown;
}
export type Hand = 'hand' | 'off-hand';
export type Control = 'jump' | 'forward' | 'back' | 'sprint';

export interface ActBot {
    readonly entity: { position: Vec3Like; yaw?: number };
    readonly entities: Readonly<Record<string, ActEntity>>;
    readonly health: number;
    /** The food level (optional in fakes). */
    readonly food?: number;
    readonly heldItem: ActItem | null;
    items(): ActItem[];
    /** Empty inventory slots (optional in fakes). */
    emptySlots?(): number;
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
    /** minecraft-data: the item has a crafting recipe. */
    hasRecipe(name: string): boolean;
    /** The recipes for name andy has the ingredients for: without a table (null), with the table at p, or with any table ('any'). */
    recipesFor(name: string, table: Vec3Like | 'any' | null): ActRecipe[];
    /** Craft a recipe once (at the table at p, or in the inventory grid: null). */
    craft(recipe: ActRecipe, table: Vec3Like | null): Promise<void>;
    /** Dig the block at p (with the held item); rejects when it can't. */
    dig(p: Vec3Like): Promise<void>;
    stopDigging(): void;
    /** The held item can harvest the block at p (it drops). */
    canHarvest(p: Vec3Like): boolean;
    /** The carried item that digs the block at p fastest (the patched digTime), or null: the hand is as good. */
    bestTool(p: Vec3Like): string | null;
    /** Use the held item on the block at p, on its face side (till, plant, bone meal: the old bot.activateBlock). */
    activateBlock(p: Vec3Like, face: Vec3Like): Promise<void>;
    /** Use the held item on an entity (feed an animal: bot.activateEntity). */
    activateEntity(e: ActEntity): Promise<void>;
    /** Place the held block against the block at `against`, on its `face` side. */
    placeBlock(against: Vec3Like, face: Vec3Like): Promise<void>;
    /** Open the furnace block at p (rejects when it won't open). */
    openFurnace(p: Vec3Like): Promise<ActFurnace>;
    /** minecraft-data's block names that pass test (e.g. every *_log). */
    blockNames(test: (name: string) => boolean): string[];
    /** minecraft-data's foods. */
    isFood(name: string): boolean;
    /** The planks a log crafts into (minecraft-data's recipes), or null. */
    planksFor(log: string): string | null;
    /** The item an item entity on the ground is (getDroppedItem), or null (optional in fakes). */
    droppedItem?(e: ActEntity): string | null;
}

/** The pathfinder goals the actuators use (opaque to them). */
export type Goal = object;
export interface Goals {
    follow(e: ActEntity, range: number): Goal;
    /** x and z only (the follow step: a misread height must not make the step unreachable). */
    xz(x: number, z: number): Goal;
    near(p: Vec3Like, range: number): Goal;
    invert(g: Goal): Goal;
    /** Somewhere the block at p is in reach and in sight (to dig it). */
    lookAt(p: Vec3Like): Goal;
    /** Standing in the cell p (the old moveTo's GoalBlock). */
    block(p: Vec3Like): Goal;
    /**
     * lookAt within reach 4 that never ends standing on top of p (in its column above it): for ore over a hollow
     * (the old collectOreAt's isEnd override).
     */
    lookAtNotOn(p: Vec3Like): Goal;
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
        get food() { return bot.food; },
        get heldItem() { return bot.heldItem; },
        items: () => bot.inventory.items(),
        emptySlots: () => bot.inventory.emptySlotCount(),
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
                items: () => c.containerItems().map(i => ({ name: i.name, count: i.count })),
                deposit: async (name, count) => {
                    const id = bot.registry.itemsByName[name]?.id;
                    if (id === undefined) throw new Error(`unknown item ${name}`);
                    await c.deposit(id, null, count);
                },
                withdraw: async (name, count) => {
                    const id = bot.registry.itemsByName[name]?.id;
                    if (id === undefined) throw new Error(`unknown item ${name}`);
                    await c.withdraw(id, null, count);
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
        hasRecipe: name => {
            const id = bot.registry.itemsByName[name]?.id;
            return id !== undefined && ((bot.registry as unknown as { recipes: Record<number, unknown[]> }).recipes[id]?.length ?? 0) > 0;
        },
        recipesFor: (name, table) => {
            const id = bot.registry.itemsByName[name]?.id;
            if (id === undefined) return [];
            const t = table === null ? null : table === 'any' ? true : bot.blockAt(v(table));
            if (table !== null && !t) return [];
            return bot.recipesFor(id, null, 1, t as never).map(r => ({
                result: r.result.count,
                needs: r.delta.filter(d => d.count < 0).map(d => ({ name: bot.registry.items[d.id]?.name ?? String(d.id), count: -d.count })),
                ref: r,
            }));
        },
        craft: async (recipe, table) => {
            const t = table ? bot.blockAt(v(table)) : null;
            if (table && !t) throw new Error('no crafting table there');
            await bot.craft(recipe.ref as never, 1, (t ?? undefined) as never);
        },
        dig: async p => {
            const b = bot.blockAt(v(p));
            if (!b) throw new Error('no block there');
            await bot.dig(b, true);
        },
        stopDigging: () => bot.stopDigging(),
        canHarvest: p => {
            const b = bot.blockAt(v(p));
            return !!b && b.canHarvest(bot.heldItem ? bot.heldItem.type : null);
        },
        bestTool: p => {
            const b = bot.blockAt(v(p));
            if (!b) return null;
            // the patched bot.digTime's material fix (1.21 names some stone after the wooden-tool tag)
            if ((b as unknown as { material?: string }).material === 'incorrect_for_wooden_tool') (b as unknown as { material: string }).material = 'mineable/pickaxe';
            const creative = bot.game.gameMode === 'creative';
            const time = (type: number | null) => b.digTime(type, creative, !!(bot.entity as unknown as { isInWater?: boolean }).isInWater, !bot.entity.onGround, [], bot.entity.effects as never);
            let best: string | null = null, bestTime = time(null);
            for (const it of bot.inventory.items()) {
                const t = time(it.type);
                if (t < bestTime && b.canHarvest(it.type)) { best = it.name; bestTime = t; }
            }
            // a block the hand can't harvest: any tool that can
            if (!best && !b.canHarvest(null)) best = bot.inventory.items().find(it => b.canHarvest(it.type))?.name ?? null;
            return best;
        },
        activateBlock: async (p, face) => {
            const b = bot.blockAt(v(p));
            if (!b) throw new Error('no block there');
            await bot.activateBlock(b, v(face));
        },
        activateEntity: async e => {
            const ent = bot.entities[e.id];
            if (!ent) throw new Error('no such entity');
            await bot.activateEntity(ent);
        },
        placeBlock: async (against, face) => {
            const b = bot.blockAt(v(against));
            if (!b) throw new Error('nothing to place against');
            await bot.placeBlock(b, v(face));
        },
        openFurnace: async p => {
            const block = bot.blockAt(v(p));
            if (!block) throw new Error('no block there');
            const f = await bot.openFurnace(block);
            const item = (i: { name: string; count: number } | null) => (i ? { name: i.name, count: i.count } : null);
            const id = (name: string) => {
                const n = bot.registry.itemsByName[name]?.id;
                if (n === undefined) throw new Error(`unknown item ${name}`);
                return n;
            };
            return {
                input: () => item(f.inputItem()),
                fuel: () => item(f.fuelItem()),
                output: () => item(f.outputItem()),
                putFuel: (name, count) => f.putFuel(id(name), null, count),
                putInput: (name, count) => f.putInput(id(name), null, count),
                takeOutput: async () => item(await f.takeOutput()),
                takeInput: async () => { await f.takeInput(); },
                takeFuel: async () => { await f.takeFuel(); },
                close: () => f.close(),
            };
        },
        blockNames: test => Object.keys(bot.registry.blocksByName).filter(test),
        isFood: name => Object.hasOwn((bot.registry as unknown as { foodsByName?: Record<string, unknown> }).foodsByName ?? {}, name),
        planksFor: log => {
            const logId = bot.registry.itemsByName[log]?.id;
            if (logId === undefined) return null;
            const recipes = (bot.registry as unknown as { recipes: Record<number, { ingredients?: number[] }[]> }).recipes;
            for (const name of Object.keys(bot.registry.itemsByName)) {
                if (!name.endsWith('_planks')) continue;
                const id = bot.registry.itemsByName[name]!.id;
                if ((recipes[id] ?? []).some(r => r.ingredients?.includes(logId))) return name;
            }
            return null;
        },
        droppedItem: e => {
            try {
                const ent = bot.entities[e.id] as unknown as { getDroppedItem?: () => { name: string } | null } | undefined;
                return ent?.getDroppedItem?.()?.name ?? null;
            } catch { return null; }
        },
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
        lookAt: p => new G.GoalLookAtBlock(v(p), bot.world, { reach: 4.5 }),
        block: p => new G.GoalBlock(p.x, p.y, p.z),
        lookAtNotOn: p => {
            const goal = new G.GoalLookAtBlock(v(p), bot.world, { reach: 4 });
            const isEnd = goal.isEnd.bind(goal);
            goal.isEnd = (node: { x: number; y: number; z: number }) => !(node.x === p.x && node.z === p.z && node.y > p.y) && isEnd(node as never);
            return goal;
        },
    };
}
