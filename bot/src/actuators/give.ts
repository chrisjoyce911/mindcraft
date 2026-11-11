// Give items to a player (the old skills.giveToPlayer): go to the player (3; 1 when 2 or more below), back off
// when nearer than 2 (to 5, at most 3 s), look at them, toss the asked count and wait ≤ 3 s for them to pick
// it up. The only toss in the bot: only the asked count, only at a player in reach who was looked at.
import { fail, type Outcome, type Vec3Like } from '../types/index.js';
import type { Act, ActEntity } from './bot.js';

export const GIVE_CEILING_MS = 60000;
export const BACKOFF_MS = 3000;
export const COLLECT_MS = 3000;

export type GiveResult =
    | { ok: true; tossed: number }
    | { ok: false; why: 'too close' | 'never received' | 'no-item' | 'cancelled'; outcome?: Outcome }
    /** Aborted after the toss: what was tossed, and whether the player picks it up (settles ≤ COLLECT_MS). */
    | { ok: false; why: 'cancelled'; tossed: number; collected: Promise<boolean> };

/** collectedOrAborted: the pickup, or 'aborted' as soon as the signal aborts (its listener removed after). */
function collectedOrAborted(collected: Promise<boolean>, signal: AbortSignal): Promise<boolean | 'aborted'> {
    if (signal.aborted) return Promise.resolve('aborted');
    let onAbort = () => {};
    const abort = new Promise<'aborted'>(resolve => { onAbort = () => resolve('aborted'); });
    signal.addEventListener('abort', onAbort, { once: true });
    return Promise.race([collected, abort]).finally(() => signal.removeEventListener('abort', onAbort));
}

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** giveTo gives count of item to player (the entity is looked up by the caller); beforeToss runs right before the toss. */
export async function giveTo(a: Act, player: ActEntity, username: string, item: string, count: number, signal: AbortSignal, beforeToss?: () => void): Promise<GiveResult> {
    const go = async (range: number) => a.motion.goTo(a.goals.follow(player, Math.max(range, 0.5)), signal, { timeoutMs: GIVE_CEILING_MS });
    // a goal not quite reached still gives (the old goToPlayer didn't check): the toss is checked by the pickup
    await go(3);
    if (signal.aborted) return { ok: false, why: 'cancelled' };
    if (a.bot.entity.position.y < player.position.y - 1) await go(1);
    if (signal.aborted) return { ok: false, why: 'cancelled' };
    if (dist(a.bot.entity.position, player.position) < 2) {
        const start = Date.now();
        let tooClose = true;
        while (tooClose && Date.now() - start < BACKOFF_MS) {
            const m = await a.motion.moveFor(a.goals.invert(a.goals.follow(player, 5)), 500, signal);
            if (!m.ok && m.reason === 'cancelled') return { ok: false, why: 'cancelled' };
            tooClose = dist(a.bot.entity.position, player.position) < 5;
        }
        if (tooClose) return { ok: false, why: 'too close' };
    }
    try { await a.bot.lookAt(player.position); } catch { /* best effort */ }
    if (signal.aborted) return { ok: false, why: 'cancelled' };
    // the pickup wait runs to its own timeout, not the job's signal: an abort after the toss still learns
    // whether the player got it (the job must never toss again on resume)
    const collected = a.bot.waitCollect(username, COLLECT_MS, new AbortController().signal);
    let tossed = 0;
    beforeToss?.();
    try { tossed = await a.bot.toss(item, count); } catch (e) { return { ok: false, why: 'never received', outcome: fail('error', String(e)) }; }
    if (!tossed) return { ok: false, why: 'no-item' };
    const got = await collectedOrAborted(collected, signal);
    if (got === true) return { ok: true, tossed };
    if (got === 'aborted') return { ok: false, why: 'cancelled', tossed, collected };
    return { ok: false, why: 'never received' };
}
