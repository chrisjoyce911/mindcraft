// Escape a danger the sensors report (a port of the old self_preservation mode's moves; the director chose
// flee, so nothing is decided here): burning → pour a water bucket if carried, else go into water within
// 20, else move 5 away; lava near → move 5 away; drowning → swim up (jump) until the head is out of water.
import { fail, OK, type Danger, type Outcome } from '../types/index.js';
import { isAborted, race, sleep, timedOut, withTimeout } from '../core/abort.js';
import type { Act } from './bot.js';
import { hold } from './equip.js';

export const ESCAPE_CEILING_MS = 10000;
export const WATER_REACH = 20;
export const AWAY = 5;
const SWIM_STEP_MS = 200;

export async function escape(a: Act, danger: Danger, signal: AbortSignal, ceilingMs = ESCAPE_CEILING_MS): Promise<Outcome> {
    if (signal.aborted) return fail('cancelled');
    const t = withTimeout(ceilingMs, signal);
    const end = (o: Outcome): Outcome => (t.signal.aborted ? (timedOut(t.signal) ? fail('timeout') : fail('cancelled')) : o);
    try {
        switch (danger) {
            case 'fire': return end(await douse(a, t.signal));
            case 'fluid': return end(await away(a, t.signal));
            case 'drowning': return end(await swimUp(a, t.signal));
            default: return OK;
        }
    } catch (e) {
        if (isAborted(e) || t.signal.aborted) return end(fail('cancelled'));
        return fail('error', e instanceof Error ? e.message : String(e));
    } finally {
        t.dispose();
        try { a.bot.setControlState('jump', false); } catch { /* best effort */ }
    }
}

function away(a: Act, signal: AbortSignal): Promise<Outcome> {
    return a.motion.goTo(a.goals.invert(a.goals.near(a.bot.entity.position, AWAY)), signal);
}

async function douse(a: Act, signal: AbortSignal): Promise<Outcome> {
    const bot = a.bot;
    if (bot.items().some(i => i.name === 'water_bucket') && await hold(bot, 'water_bucket')) {
        const p = bot.entity.position;
        await race(bot.lookAt({ x: p.x, y: Math.floor(p.y) - 0.5, z: p.z }, true), signal);
        bot.activateItem();
        return OK;
    }
    const water = bot.findBlock('water', WATER_REACH);
    if (water) return a.motion.goTo(a.goals.near(water, 0), signal);
    return away(a, signal);
}

async function swimUp(a: Act, signal: AbortSignal): Promise<Outcome> {
    const bot = a.bot;
    const headInWater = (): boolean => {
        const p = bot.entity.position;
        return bot.blockAt(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z))?.name === 'water';
    };
    bot.setControlState('jump', true);
    while (headInWater()) await sleep(SWIM_STEP_MS, signal);
    return OK;
}
