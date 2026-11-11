// Put items into a chest (the old skills.putInChest's game side): go within 2, open it, deposit, close. The
// container is always closed (abort and errors included).
import { race, isAborted, withTimeout, timedOut } from '../core/abort.js';
import { fail, OK, type Outcome, type Vec3Like } from '../types/index.js';
import type { Act, ActContainer } from './bot.js';
import { goNear } from './approach.js';

export const OPEN_TIMEOUT_MS = 5000;
export const DEPOSIT_TIMEOUT_MS = 5000;
export const CHEST_REACH = 2;

/** deposit puts count of item into the chest at p. */
export async function deposit(a: Act, p: Vec3Like, item: string, count: number, signal: AbortSignal): Promise<Outcome> {
    const near = await goNear(a, p, CHEST_REACH, signal);
    if (!near.ok) return near;
    let box: ActContainer | null = null;
    const t = withTimeout(OPEN_TIMEOUT_MS, signal);
    try {
        const opening = a.bot.openContainer(p);
        box = await race(opening, t.signal, () => { opening.then(c => c.close(), () => {}); });
    } catch (e) {
        if (signal.aborted) return fail('cancelled');
        if (timedOut(t.signal)) return fail('timeout', 'the chest would not open');
        return fail('error', String(e));
    } finally { t.dispose(); }
    const d = withTimeout(DEPOSIT_TIMEOUT_MS, signal);
    try {
        await race(box.deposit(item, count), d.signal);
        return OK;
    } catch (e) {
        if (signal.aborted || isAborted(e) && !timedOut(d.signal)) return fail('cancelled');
        if (timedOut(d.signal)) return fail('timeout', 'deposit');
        return fail('error', String(e));
    } finally {
        d.dispose();
        try { box.close(); } catch { /* closed already */ }
    }
}
