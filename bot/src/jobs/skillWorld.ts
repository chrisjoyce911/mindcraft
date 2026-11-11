// The skill jobs' world (5.5): the hunt, gather and place skills' senses and acts on the live bot through the
// actuators. It reads (entities, blocks, the pack) and moves only through Motion; no choice is made here.
import type { Outcome, PlaceItem, Vec3Like } from '../types/index.js';
import type { Act, ActEntity } from '../actuators/bot.js';
import { isBaby } from '../actuators/farm.js';
import { killEntity } from '../actuators/hunt.js';
import { digAt, pickupNearby, REACH_TIMEOUT_MS } from '../actuators/collect.js';
import { goNear } from '../actuators/approach.js';
import { hold } from '../actuators/equip.js';
import { placeAt } from '../actuators/place.js';
import { wait } from '../actuators/settle.js';
import { baseCentre } from '../home/centre.js';
import type { PlaceBook } from '../home/places.js';
import type { Search } from '../models/skill/index.js';
import { inSearch, isLog, type Creature, type GroundItem, type Tree, type XZ } from '../sensors/skills.js';
import type { HuntFoodWorld } from './huntFood.js';
import type { GatherSkillWorld } from './gatherSkill.js';
import type { PlaceWorld } from './place.js';

/** The wait after a kill or a dig before picking up: the drops appear. */
export const DROP_WAIT_MS = 500;
/** Ground items are picked up within this (the Drops line's 16). */
export const COLLECT_RANGE = 16;
/** Approaching stops this near. */
export const APPROACH_RANGE = 2;
/** Logs and grass are looked for at most this many. */
export const FIND_MAX = 1024;
const SHEARED = 0x10;
/** A place keeps andy's middle at least this far (horizontally) from the cell's middle (the old freeSpot's 1.5). */
export const STAND_OFF = 1.5;

const creatureOf = (e: ActEntity): Creature => ({
    id: e.id, name: e.name ?? '', position: e.position,
    // a baby: the height (farm) or the ageable mob's baby flag (1.21 metadata 16, the old bot's adult test)
    baby: isBaby(e) || e.metadata?.[16] === true,
    sheared: e.name === 'sheep' && typeof e.metadata?.[17] === 'number' && ((e.metadata[17] as number) & SHEARED) !== 0,
});

/** findIn: positions of blocks named one of names in the search square around origin (findBlocks reaches its corners). */
function findIn(a: Act, names: readonly string[], origin: XZ, search: Search): Vec3Like[] {
    const half = (search - 1) / 2;
    const point = { x: origin.x, y: a.bot.entity.position.y, z: origin.z };
    return a.bot.findBlocks(names, point, Math.ceil(half * Math.SQRT2) + 1, FIND_MAX).filter(p => inSearch(origin, p, search));
}

const centre = (p: Vec3Like) => ({ x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 });

export function skillWorld(a: Act, places?: PlaceBook): HuntFoodWorld & GatherSkillWorld & PlaceWorld {
    const collect = async (signal: AbortSignal) => {
        if (!(await wait(DROP_WAIT_MS, signal))) return 0;
        return pickupNearby(a, signal, COLLECT_RANGE);
    };
    const live = (c: Creature): ActEntity | null => {
        const e = a.bot.entities[String(c.id)];
        return e && e.isValid !== false ? e : null;
    };
    return {
        me: () => a.bot.entity.position,
        items: () => a.bot.items(),
        isFood: name => a.bot.isFood(name),
        free: () => a.bot.emptySlots?.() ?? 0,
        creatures: () => Object.values(a.bot.entities).filter(e => e.position && e.username === undefined && e.name !== 'item').map(creatureOf),
        ground: (): GroundItem[] => Object.values(a.bot.entities).filter(e => e.name === 'item' && e.position).flatMap(e => {
            const item = a.bot.droppedItem?.(e) ?? null;
            return item ? [{ id: e.id, item, position: e.position }] : [];
        }),
        kill: (c, signal) => {
            const e = live(c);
            return e ? killEntity(a, e, signal) : Promise.resolve<Outcome>({ ok: false, reason: 'no-block', detail: `${c.name} gone` });
        },
        approach: (p, signal) => goNear(a, p, APPROACH_RANGE, signal),
        collect,
        logs: (origin, search) => findIn(a, a.bot.blockNames(isLog), origin, search),
        leavesBeside: p => [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]
            .some(([dx, dy, dz]) => a.bot.blockAt(p.x + dx!, p.y + dy!, p.z + dz!)?.name.endsWith('_leaves') ?? false),
        grass: (origin, search) => findIn(a, ['short_grass', 'grass', 'tall_grass'], origin, search),
        fell: async (tree: Tree, signal) => {
            let dug = 0;
            for (const p of tree.logs) {
                if (signal.aborted) return { ok: false, reason: 'cancelled' };
                if (!isLog(a.bot.blockAt(p.x, p.y, p.z)?.name ?? '')) continue;
                const reach = await a.motion.goTo(a.goals.lookAt(p), signal, { timeoutMs: REACH_TIMEOUT_MS });
                if (signal.aborted || (!reach.ok && reach.reason === 'cancelled')) return { ok: false, reason: 'cancelled' };
                if (!reach.ok) continue; // a top log out of reach stays
                await hold(a.bot, a.bot.bestTool(p));
                const o = await digAt(a, p, signal);
                if (signal.aborted) return { ok: false, reason: 'cancelled' };
                if (o.ok) dug++;
            }
            await collect(signal);
            return dug > 0 ? { ok: true } : { ok: false, reason: 'unreachable', detail: 'no log of the tree dug' };
        },
        dig: async (p, signal) => {
            const reach = await a.motion.goTo(a.goals.lookAt(p), signal, { timeoutMs: REACH_TIMEOUT_MS });
            if (!reach.ok) return reach;
            const o = await digAt(a, p, signal);
            if (!o.ok) return o;
            await collect(signal);
            return { ok: true };
        },
        shear: async (c, signal) => {
            const e = live(c);
            if (!e) return { ok: false, reason: 'no-block', detail: 'sheep gone' };
            const o = await goNear(a, e, APPROACH_RANGE, signal);
            if (!o.ok) return o;
            if (!(await hold(a.bot, 'shears'))) return { ok: false, reason: 'missing-item', detail: 'shears' };
            try {
                await a.bot.lookAt({ x: e.position.x, y: e.position.y + 0.8, z: e.position.z });
                await a.bot.activateEntity(e);
            } catch (err) { return { ok: false, reason: 'error', detail: err instanceof Error ? err.message : String(err) }; }
            await collect(signal);
            return { ok: true };
        },
        carried: (item: PlaceItem) => {
            const names = a.bot.items().map(i => i.name);
            switch (item) {
                case 'bed': return names.find(n => n.endsWith('_bed')) ?? null;
                case 'saplings': return names.find(n => n.endsWith('_sapling')) ?? null;
                default: return names.includes(item) ? item : null;
            }
        },
        centre: () => baseCentre(places ?? { all: () => ({}), recall: () => null, remember: () => {}, forget: () => {} }, a.bot.entity.position),
        blockAt: (x, y, z) => a.bot.blockAt(x, y, z),
        put: async (name, item, p, signal) => {
            const me = a.bot.entity.position;
            // never into or right beside the cells andy stands in (the server refuses a block in his box; the old
            // freeSpot kept 1.5 from his middle): step away first
            if (Math.hypot(p.x + 0.5 - me.x, p.z + 0.5 - me.z) < STAND_OFF && Math.abs(Math.floor(me.y) - p.y) <= 1) {
                await a.motion.goTo(a.goals.invert(a.goals.near(centre(p), STAND_OFF + 1)), signal, { timeoutMs: 5000 });
                if (signal.aborted) return { ok: false, reason: 'cancelled' };
            }
            // a bed faces the way andy looks: stand west of the cell, so the head goes on the east one
            if (item === 'bed') {
                await a.motion.goTo(a.goals.near({ x: p.x - 2, y: p.y, z: p.z }, 1), signal, { timeoutMs: 10000 });
                if (signal.aborted) return { ok: false, reason: 'cancelled' };
            }
            const ok = await placeAt(a, name, p, 'bottom', signal);
            if (signal.aborted) return { ok: false, reason: 'cancelled' };
            return ok ? { ok: true } : { ok: false, reason: 'error', detail: `${name} not placed` };
        },
    };
}
