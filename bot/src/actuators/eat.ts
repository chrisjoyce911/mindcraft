// Eat one food item: equip it, consume, re-equip what was held. mineflayer's consume() can't be cancelled:
// on abort stop waiting and deactivate the item (design §4: settle ≤ 250 ms).
import { fail, OK, type Outcome } from '../types/index.js';
import { race, isAborted, withTimeout, timedOut } from '../core/abort.js';
import type { ActBot } from './bot.js';
import { hold } from './equip.js';

export const EAT_CEILING_MS = 5000;

export async function eatFood(bot: ActBot, food: string, signal: AbortSignal, ceilingMs = EAT_CEILING_MS): Promise<Outcome> {
    if (signal.aborted) return fail('cancelled');
    const item = bot.items().find(i => i.name === food);
    if (!item) return fail('missing-item', food);
    const previous = bot.heldItem?.name ?? null;
    const t = withTimeout(ceilingMs, signal);
    try {
        await race(bot.equip(item, 'hand'), t.signal);
        await race(bot.consume(), t.signal, () => { try { bot.deactivateItem(); } catch { /* not eating */ } });
    } catch (e) {
        if (isAborted(e) || t.signal.aborted) return timedOut(t.signal) ? fail('timeout') : fail('cancelled');
        return fail('error', e instanceof Error ? e.message : String(e));
    } finally {
        t.dispose();
    }
    if (previous && previous !== food && !signal.aborted) await hold(bot, previous);
    return OK;
}
