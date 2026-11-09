// The defend task's actions in the game: what the laya_defending mode passes to
// LayaDefender as `act`. Each is short (at most a second or two), so the
// engagement asks the model again soon. Moving uses the pathfinder, which
// never paths through lava or off a dangerous drop.

import pf from 'mineflayer-pathfinder';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function hold(bot, name, hand = 'hand') {
    if (!name || name === 'none') return true;
    if (hand === 'hand' && bot.heldItem?.name === name) return true;
    const item = bot.inventory.items().find(i => i.name === name);
    if (!item) return false;
    try {
        await bot.equip(item, hand);
        return true;
    } catch {
        return false;
    }
}

// move runs the pathfinder towards goal for at most ms, then stops it.
async function move(bot, goal, ms) {
    bot.pathfinder.setMovements(new pf.Movements(bot));
    bot.pathfinder.setGoal(goal, true);
    await sleep(ms);
    bot.pathfinder.setGoal(null);
}

const near = (bot, e, d) => bot.entity.position.distanceTo(e.position) <= d;

async function strike(bot, entity) {
    await bot.lookAt(entity.position.offset(0, (entity.height ?? 1.8) * 0.8, 0), true);
    bot.attack(entity);
}

// shoot draws the bow for a second and lets go, aiming a little higher the
// farther the mob is.
async function shoot(bot, entity) {
    if (!(await hold(bot, 'bow'))) return;
    const d = bot.entity.position.distanceTo(entity.position);
    await bot.lookAt(entity.position.offset(0, (entity.height ?? 1.8) * 0.7 + d * 0.04, 0), true);
    bot.activateItem();
    await sleep(1100);
    bot.deactivateItem();
}

export function defendActions(bot) {
    return {
        async fight(entity, weapon) {
            if (weapon === 'bow') return shoot(bot, entity);
            await hold(bot, weapon);
            if (!near(bot, entity, 3)) await move(bot, new pf.goals.GoalFollow(entity, 2), 600);
            if (near(bot, entity, 3.5)) await strike(bot, entity);
        },
        async shield(entity, weapon) {
            await hold(bot, 'shield', 'off-hand');
            await hold(bot, weapon);
            bot.activateItem(true);
            if (!near(bot, entity, 3)) await move(bot, new pf.goals.GoalFollow(entity, 2), 600);
            bot.deactivateItem();
            if (near(bot, entity, 3.5)) await strike(bot, entity);
        },
        async backoff(entity, weapon) {
            await move(bot, new pf.goals.GoalInvert(new pf.goals.GoalFollow(entity, 7)), 800);
            if (weapon === 'bow') await shoot(bot, entity);
        },
        async flee(entity) {
            await move(bot, new pf.goals.GoalInvert(new pf.goals.GoalFollow(entity, 16)), 1500);
        },
        async eat() {
            const apple = bot.inventory.items().find(i => i.name === 'enchanted_golden_apple' && bot.health <= 4)
                || bot.inventory.items().find(i => i.name === 'golden_apple' || i.name === 'enchanted_golden_apple');
            if (!apple) return;
            const previous = bot.heldItem;
            try {
                await bot.equip(apple, 'hand');
                await bot.consume();
            } catch { /* eating can be interrupted by a hit */ }
            if (previous && previous.name !== apple.name) await hold(bot, previous.name);
        },
    };
}
