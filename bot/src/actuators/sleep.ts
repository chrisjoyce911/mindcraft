// Sleep in a bed (the old chores sleep): walk within 2 of it, lie down, stay in bed until morning (the server wakes
// andy) or an abort; on an abort get up again. Never throws.
import { fail, OK, type Outcome, type Vec3Like } from '../types/index.js';
import type { Act } from './bot.js';
import { goNear } from './approach.js';
import { wait } from './settle.js';

export const BED_REACH = 2;
/** How often the bed is checked while asleep. */
export const SLEEP_POLL_MS = 500;

/** sleepIn: sleep in the bed at p until woken; ok when he slept. */
export async function sleepIn(a: Act, p: Vec3Like, signal: AbortSignal): Promise<Outcome> {
    if (!a.bot.sleep) return fail('error', 'this bot cannot sleep');
    const near = await goNear(a, p, BED_REACH, signal);
    if (!near.ok) return near;
    try { await a.bot.sleep(p); } catch (e) { return fail('error', `can't sleep: ${e instanceof Error ? e.message : String(e)}`); }
    while (a.bot.isSleeping && !signal.aborted) await wait(SLEEP_POLL_MS, signal);
    if (a.bot.isSleeping) { try { await a.bot.wake?.(); } catch { /* awake already */ } }
    return signal.aborted ? fail('cancelled') : OK;
}
