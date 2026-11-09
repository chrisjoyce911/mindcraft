// The farm task's actions in the game: the mineflayer side of farm.js.
//
// Movement avoids farmland and crops (so the bot never tramples or jumps on
// them) and stands next to the target. Water goes into a hole dug in the dry
// farmland, so it can't flow onto crops; a cell whose sides would let water
// out is refused (flooding).

import pf from 'mineflayer-pathfinder';
import Vec3 from 'vec3';
import * as skills from '../library/skills.js';
import { readFarm, parseCellName, C, KINDS } from './farm_state.js';

const FARM_BLOCKS = ['farmland', 'wheat', 'carrots', 'potatoes', 'beetroots'];

// The real item each game item stands for when it has to be made.
const MAKE = { hoe: 'wooden_hoe', water_bucket: 'water_bucket', bone_meal: 'bone_meal', wheat_seeds: 'wheat_seeds' };

function movements(bot) {
    const m = new pf.Movements(bot);
    m.allowParkour = false;
    m.allowSprinting = false;
    m.canDig = false;
    for (const name of FARM_BLOCKS) {
        const id = bot.registry.blocksByName[name]?.id;
        if (id !== undefined) m.blocksToAvoid.add(id);
    }
    return m;
}

async function reach(bot, pos) {
    bot.pathfinder.setMovements(movements(bot));
    try {
        await bot.pathfinder.goto(new pf.goals.GoalNear(pos.x, pos.y, pos.z, 3));
        return true;
    } catch {
        return bot.entity.position.distanceTo(pos) <= 4.5;
    }
}

// floods reports whether water placed at pos (a hole) could flow out: any
// side at that level isn't solid.
export function floods(blockAt, pos) {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const b = blockAt(pos.x + dx, pos.y, pos.z + dz);
        if (!b || b.boundingBox !== 'block') return true;
    }
    return false;
}

function animalsNear(bot) {
    return Object.values(bot.entities)
        .filter(e => KINDS.includes(e.name) && e.position)
        .map(e => ({ kind: e.name, x: Math.floor(e.position.x), z: Math.floor(e.position.z), baby: isBaby(e), entity: e }));
}

// isBaby: babies are about half an adult's height.
const ADULT_HEIGHT = { cow: 1.4, sheep: 1.3, pig: 0.9, chicken: 0.7 };
function isBaby(e) {
    return typeof e.height === 'number' && e.height < 0.75 * (ADULT_HEIGHT[e.name] || 0);
}

// farmDeps returns the deps farm.js needs for a real bot.
export function farmDeps(bot) {
    const blockAt = (x, y, z) => bot.blockAt(new Vec3(x, y, z));
    let last = null; // the situation read last, with its origin
    const read = () => {
        const p = bot.entity.position;
        const bx = Math.floor(p.x), bz = Math.floor(p.z), feetY = Math.floor(p.y);
        last = { bx, bz, s: readFarm(blockAt, bx, feetY, bz, bot.inventory.items(), animalsNear(bot)) };
        return last.s;
    };
    const cellPos = target => {
        const c = parseCellName(target);
        return new Vec3(last.bx + c.x - C, last.s.ys[c.z][c.x], last.bz + c.z - C);
    };
    const equipItem = async item => {
        const name = item === 'hoe' ? bot.inventory.items().find(i => i.name.endsWith('_hoe'))?.name : item;
        return !!name && await skills.equip(bot, name);
    };

    const act = async (action, target, item) => {
        if (action === 'breed') {
            const fed = [];
            const herd = animalsNear(bot).filter(a => a.kind === target && !a.baby)
                .sort((a, b) => bot.entity.position.distanceTo(a.entity.position) - bot.entity.position.distanceTo(b.entity.position));
            for (const a of herd.slice(0, 2)) {
                if (!await reach(bot, a.entity.position) || !await equipItem(item)) break;
                await bot.activateEntity(a.entity);
                fed.push(a);
            }
            return fed.length === 2;
        }
        const ground = cellPos(target);
        const crop = ground.offset(0, 1, 0);
        if (!await reach(bot, ground)) return false;
        switch (action) {
        case 'harvest':
            await bot.dig(bot.blockAt(crop));
            await skills.pickupNearbyItems(bot);
            return true;
        case 'plant':
            if (!await equipItem(item)) return false;
            await bot.activateBlock(bot.blockAt(ground), new Vec3(0, 1, 0));
            return true;
        case 'till': {
            const above = bot.blockAt(crop);
            if (above && above.name !== 'air') await bot.dig(above); // grass or a flower on top
            if (!await equipItem('hoe')) return false;
            await bot.activateBlock(bot.blockAt(ground), new Vec3(0, 1, 0));
            return true;
        }
        case 'water':
            if (floods(blockAt, ground)) return false;
            await bot.dig(bot.blockAt(ground));
            if (!await equipItem('water_bucket')) return false;
            await bot.activateBlock(bot.blockAt(ground.offset(0, -1, 0)), new Vec3(0, 1, 0));
            return true;
        case 'bone_meal':
            if (!await equipItem('bone_meal')) return false;
            await bot.activateBlock(bot.blockAt(crop));
            return true;
        }
        return false;
    };

    // craft gets an item: the craft task's runCraft when it exists (the
    // laya-craft change), otherwise Mindcraft's own skills.
    const craft = async (item, count) => {
        try {
            const mod = await import('./craft.js').catch(() => null);
            if (mod?.runCraft) return !!await mod.runCraft(bot, MAKE[item] || item, count);
        } catch { /* fall back below */ }
        return craftWithSkills(bot, item, count);
    };
    return { read, act, craft };
}

// craftWithSkills gets an item with Mindcraft's own skills.
export async function craftWithSkills(bot, item, count) {
    const count_of = name => bot.inventory.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
    switch (item) {
    case 'hoe':
        if (count_of('stick') < 2) await skills.craftRecipe(bot, 'stick', 1);
        return await skills.craftRecipe(bot, 'wooden_hoe', 1);
    case 'wheat_seeds': // seeds drop from breaking grass
        await skills.collectBlock(bot, 'short_grass', Math.max(8, count * 2));
        await skills.pickupNearbyItems(bot);
        return count_of('wheat_seeds') > 0;
    case 'water_bucket': {
        if (count_of('bucket') === 0 && !await skills.craftRecipe(bot, 'bucket', 1)) return false;
        const water = bot.findBlock({ matching: b => b.name === 'water' && b.metadata === 0, maxDistance: 32 });
        if (!water) return false;
        await skills.goToPosition(bot, water.position.x, water.position.y, water.position.z, 3);
        await skills.equip(bot, 'bucket');
        await bot.activateBlock(water);
        return count_of('water_bucket') > 0;
    }
    case 'bone_meal':
        return await skills.craftRecipe(bot, 'bone_meal', count);
    default:
        return await skills.craftRecipe(bot, item, count);
    }
}
