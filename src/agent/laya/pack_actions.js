// The pack in the game: free slots, hostiles near, the home chest (memory
// place "home_chest") and putting things in it. The mineflayer side of
// pack.js and home_chest.js, shared by the Laya tasks that unload (farm, and
// mine from laya-mine-plan's merge).

import Vec3 from 'vec3';
import * as mc from '../../utils/mcdata.js';
import * as world from '../library/world.js';
import * as skills from '../library/skills.js';
import { homeOf, countHostiles } from './pack.js';
import { isChest, isSign, signText, signedChest, chestsAt, depositAll, nearestChest, SET_RANGE, SIGN_RANGE } from './home_chest.js';

// homeChestBlock finds the chest at (or right next to) the home chest place,
// else the nearest chest within 6 blocks of the bot.
export function homeChestBlock(bot, place) {
    const h = homeOf(place);
    if (!h) return null;
    const at = new Vec3(Math.floor(h.x), Math.floor(h.y), Math.floor(h.z));
    for (const d of [[0, 0, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
        const b = bot.blockAt(at.offset(...d));
        if (isChest(b)) return b;
    }
    return world.getNearestBlock(bot, 'chest', 6);
}

// depositInto opens the chest at pos and puts in the listed items ([{name,
// count}]); it returns what didn't fit.
async function depositInto(bot, pos, items) {
    const container = await bot.openContainer(bot.blockAt(new Vec3(pos.x, pos.y, pos.z)));
    const left = [];
    try {
        for (const { name, count } of items) {
            let n = count;
            for (const item of bot.inventory.items().filter(i => i.name === name)) {
                const k = Math.min(n, item.count);
                if (k <= 0) break;
                try {
                    await container.deposit(item.type, null, k);
                    n -= k;
                } catch { break; } // full
            }
            if (n > 0) left.push({ name, count: n });
        }
    } finally {
        container.close();
    }
    return left;
}

// depositAtHome puts items in the home chest, then in the chests touching
// it when it's full. It returns true when everything went in.
export async function depositAtHome(bot, place, items) {
    const chest = homeChestBlock(bot, place);
    if (!chest) {
        skills.log(bot, "There's no chest at the home chest place.");
        return false;
    }
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const left = await depositAll(chestsAt(chest.position, blockAt), items, (pos, list) => depositInto(bot, pos, list));
    if (left.length) skills.log(bot, `The home chest is full: still carrying ${left.map(i => `${i.count} ${i.name}`).join(', ')}.`);
    return left.length === 0;
}

// findSignedChest looks within SIGN_RANGE for a sign with the bot's name on
// or next to a chest, and returns the chest's position or null.
export function findSignedChest(bot) {
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    const signs = bot.findBlocks({ matching: b => isSign(b), maxDistance: SIGN_RANGE, count: 64 })
        .map(p => ({ x: p.x, y: p.y, z: p.z, text: signText(bot.blockAt(p)) }));
    return signedChest(signs, blockAt, bot.username, bot.entity.position);
}

// nearestChestTo returns the position of the chest nearest to `at` (a
// player's or the bot's position) within SET_RANGE, or null.
export function nearestChestTo(bot, at) {
    const chests = bot.findBlocks({ point: at, matching: b => isChest(b), maxDistance: SET_RANGE, count: 32 });
    return nearestChest(chests, at, SET_RANGE);
}

// packDeps returns the pack deps a Laya task loop uses for a real bot.
// homeChest: the home chest place ([x, y, z]) or a function returning it.
// adopt (optional) {remember(pos), say(msg)}: with no home chest saved, a
// chest marked with a sign bearing the bot's name is saved as the home chest
// (looked for at most every 30 s).
export function packDeps(bot, homeChest, adopt = null) {
    let lookedAt = -Infinity;
    const home = () => {
        const h = homeOf(homeChest);
        if (h || !adopt || Date.now() - lookedAt < 30000) return h;
        lookedAt = Date.now();
        const c = findSignedChest(bot);
        if (!c) return null;
        adopt.remember(c);
        adopt.say?.(`Found my name on a sign: the chest at ${c.x} ${c.y} ${c.z} is my home chest now.`);
        return c;
    };
    return {
        freeSlots: () => bot.inventory.emptySlotCount(),
        hostiles: () => countHostiles(Object.values(bot.entities), bot.entity, e => mc.isHostile(e)),
        health: () => bot.health ?? 20,
        food: () => bot.food ?? 20,
        home,
        goHome: async h => !!(await skills.goToPosition(bot, h.x, h.y, h.z, 2)),
        deposit: items => depositAtHome(bot, homeChest, items),
        isFood: name => !!bot.registry.foodsByName?.[name],
    };
}
