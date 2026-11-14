// The defend answers in the game (a port of the old bot's defend_actions.js): strike, shoot, fight, shield,
// backoff, flee from one mob, eat a golden apple. Each is short (a second or two), so the defend activity
// asks again soon. Moving goes through Motion.moveFor (the pathfinder never paths through lava or off a
// dangerous drop); every wait takes the signal.
import { fail, OK, type Outcome, type Vec3Like } from '../types/index.js';
import { isAborted, race, sleep } from '../core/abort.js';
import type { Act, ActBot, ActEntity } from './bot.js';
import { hold } from './equip.js';
import { eatFood } from './eat.js';

export const MELEE_REACH = 3;
export const STRIKE_REACH = 3.5;
export const CLOSE_IN_MS = 600;
export const BACKOFF_MS = 800;
export const FLEE_MS = 1500;
export const DRAW_MS = 1100;

const dist = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const near = (bot: ActBot, e: ActEntity, d: number): boolean => dist(bot.entity.position, e.position) <= d;
const offset = (p: Vec3Like, dy: number): Vec3Like => ({ x: p.x, y: p.y + dy, z: p.z });

/** guard turns an abort into cancelled and any other throw into error. */
async function guard(signal: AbortSignal, f: () => Promise<Outcome | void>): Promise<Outcome> {
    if (signal.aborted) return fail('cancelled');
    try {
        const o = await f();
        return signal.aborted ? fail('cancelled') : o ?? OK;
    } catch (e) {
        if (isAborted(e) || signal.aborted) return fail('cancelled');
        return fail('error', e instanceof Error ? e.message : String(e));
    }
}

export async function strike(bot: ActBot, e: ActEntity, signal: AbortSignal): Promise<void> {
    await race(bot.lookAt(offset(e.position, (e.height ?? 1.8) * 0.8), true), signal);
    bot.attack(e);
}

/** shoot draws the bow for a second and lets go, aiming a little higher the farther the mob is. */
export function shoot(a: Act, e: ActEntity, signal: AbortSignal): Promise<Outcome> {
    const bot = a.bot;
    return guard(signal, async () => {
        if (!(await hold(bot, 'bow'))) return fail('missing-item', 'bow');
        const d = dist(bot.entity.position, e.position);
        await race(bot.lookAt(offset(e.position, (e.height ?? 1.8) * 0.7 + d * 0.04), true), signal);
        bot.activateItem();
        try { await sleep(DRAW_MS, signal); } finally { bot.deactivateItem(); }
        return OK;
    });
}

export function fight(a: Act, e: ActEntity, weapon: string | null, signal: AbortSignal): Promise<Outcome> {
    if (weapon === 'bow') return shoot(a, e, signal);
    const bot = a.bot;
    return guard(signal, async () => {
        await hold(bot, weapon);
        if (!near(bot, e, MELEE_REACH)) {
            const o = await a.motion.moveFor(a.goals.follow(e, 2), CLOSE_IN_MS, signal);
            if (!o.ok && o.reason === 'cancelled') return o;
        }
        if (near(bot, e, STRIKE_REACH)) await strike(bot, e, signal);
        return OK;
    });
}

export function shield(a: Act, e: ActEntity, weapon: string | null, signal: AbortSignal): Promise<Outcome> {
    const bot = a.bot;
    return guard(signal, async () => {
        await hold(bot, 'shield', 'off-hand');
        await hold(bot, weapon);
        bot.activateItem(true);
        try {
            if (!near(bot, e, MELEE_REACH)) {
                const o = await a.motion.moveFor(a.goals.follow(e, 2), CLOSE_IN_MS, signal);
                if (!o.ok && o.reason === 'cancelled') return o;
            }
        } finally { bot.deactivateItem(); }
        if (near(bot, e, STRIKE_REACH)) await strike(bot, e, signal);
        return OK;
    });
}

export function backoff(a: Act, e: ActEntity, weapon: string | null, signal: AbortSignal): Promise<Outcome> {
    return guard(signal, async () => {
        const o = await a.motion.moveFor(a.goals.invert(a.goals.follow(e, 7)), BACKOFF_MS, signal);
        if (!o.ok) return o;
        if (weapon === 'bow') return shoot(a, e, signal);
        return OK;
    });
}

/** fleeFrom runs from one mob for FLEE_MS (the defend answer flee). */
export function fleeFrom(a: Act, e: ActEntity, signal: AbortSignal): Promise<Outcome> {
    return a.motion.moveFor(a.goals.invert(a.goals.follow(e, 16)), FLEE_MS, signal);
}

/** eatApple eats an enchanted golden apple when health ≤ 4, else any golden apple. */
export function eatApple(a: Act, signal: AbortSignal): Promise<Outcome> {
    const items = a.bot.items();
    const apple = (a.bot.health <= 4 ? items.find(i => i.name === 'enchanted_golden_apple') : undefined)
        ?? items.find(i => i.name === 'golden_apple' || i.name === 'enchanted_golden_apple');
    if (!apple) return Promise.resolve(fail('missing-item', 'golden_apple'));
    return eatFood(a.bot, apple.name, signal);
}
