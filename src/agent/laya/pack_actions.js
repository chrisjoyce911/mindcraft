// The pack in the game: free slots, hostiles near, the home chest (memory
// place "home_chest") and putting things in it. The mineflayer side of
// pack.js, shared by the Laya tasks that unload (farm, and mine from
// laya-mine-plan's merge).

import Vec3 from 'vec3';
import * as mc from '../../utils/mcdata.js';
import * as world from '../library/world.js';
import * as skills from '../library/skills.js';
import { homeOf, countHostiles } from './pack.js';

const CHESTS = ['chest', 'trapped_chest', 'barrel'];

// homeChestBlock finds the chest at (or right next to) the home chest place,
// else the nearest chest within 6 blocks of the bot.
export function homeChestBlock(bot, place) {
    const h = homeOf(place);
    if (!h) return null;
    const at = new Vec3(Math.floor(h.x), Math.floor(h.y), Math.floor(h.z));
    for (const d of [[0, 0, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const b = bot.blockAt(at.offset(...d));
        if (b && CHESTS.includes(b.name)) return b;
    }
    return world.getNearestBlock(bot, 'chest', 6);
}

// depositInChest puts the listed items ([{name, count}]) in a chest block.
export async function depositInChest(bot, chest, items) {
    if (!chest) {
        skills.log(bot, "There's no chest at the home chest place.");
        return false;
    }
    let container;
    try {
        container = await bot.openContainer(chest);
        for (const { name, count } of items) {
            let left = count;
            for (const item of bot.inventory.items().filter(i => i.name === name)) {
                const n = Math.min(left, item.count);
                if (n <= 0) break;
                await container.deposit(item.type, null, n);
                left -= n;
            }
        }
        return true;
    } catch (err) {
        skills.log(bot, `Couldn't put things in the home chest: ${err.message}`);
        return false;
    } finally {
        container?.close();
    }
}

// packDeps returns the pack deps a Laya task loop uses for a real bot.
// homeChest: the home chest place ([x, y, z]) or a function returning it.
export function packDeps(bot, homeChest) {
    return {
        freeSlots: () => bot.inventory.emptySlotCount(),
        hostiles: () => countHostiles(Object.values(bot.entities), bot.entity, e => mc.isHostile(e)),
        health: () => bot.health ?? 20,
        food: () => bot.food ?? 20,
        home: () => homeOf(homeChest),
        goHome: async h => !!(await skills.goToPosition(bot, h.x, h.y, h.z, 2)),
        deposit: items => depositInChest(bot, homeChestBlock(bot, homeChest), items),
        isFood: name => !!bot.registry.foodsByName?.[name],
    };
}
