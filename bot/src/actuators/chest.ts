// Put items into a chest (the old skills.putInChest's game side): go within 2, open it, deposit, close. The
// container is always closed (abort and errors included).
import { race, isAborted, withTimeout, timedOut } from '../core/abort.js';
import { fail, OK, type Outcome, type Vec3Like } from '../types/index.js';
import type { Act, ActContainer, ActItem } from './bot.js';
import { goNear } from './approach.js';

export const OPEN_TIMEOUT_MS = 5000;
export const DEPOSIT_TIMEOUT_MS = 5000;
export const CHEST_REACH = 2;
/** On an abort, how long a deposit already in flight may finish before the chest is closed (< the lease overrun). */
export const SETTLE_MS = 1000;

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
    const depositing = box.deposit(item, count);
    try {
        await race(depositing, d.signal);
        return OK;
    } catch (e) {
        if (signal.aborted || isAborted(e) && !timedOut(d.signal)) {
            // let a deposit in flight settle before the close, so the inventory says what went in (the store
            // job counts it on resume and never deposits it twice)
            let t: NodeJS.Timeout | undefined;
            await Promise.race([depositing.catch(() => {}), new Promise(r => { t = setTimeout(r, SETTLE_MS); })]);
            clearTimeout(t);
            return fail('cancelled');
        }
        if (timedOut(d.signal)) return fail('timeout', 'deposit');
        return fail('error', String(e));
    } finally {
        d.dispose();
        seen(a, p, box);
        try { box.close(); } catch { /* closed already */ }
    }
}

/** seen: tell the chest's items to the Act's chestSeen (the chores' home chest record). */
function seen(a: Act, p: Vec3Like, box: ActContainer): void {
    try { a.chestSeen?.({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, box.items()); } catch { /* never stops the actuator */ }
}

export type ChestRead = { ok: true; items: ActItem[] } | { ok: false; outcome: Outcome };

/** open goes within reach of the chest at p and opens it (closed again on an abort). */
async function open(a: Act, p: Vec3Like, signal: AbortSignal): Promise<{ ok: true; box: ActContainer } | { ok: false; outcome: Outcome }> {
    const near = await goNear(a, p, CHEST_REACH, signal);
    if (!near.ok) return { ok: false, outcome: near };
    const t = withTimeout(OPEN_TIMEOUT_MS, signal);
    try {
        const opening = a.bot.openContainer(p);
        return { ok: true, box: await race(opening, t.signal, () => { opening.then(c => c.close(), () => {}); }) };
    } catch (e) {
        if (signal.aborted) return { ok: false, outcome: fail('cancelled') };
        if (timedOut(t.signal)) return { ok: false, outcome: fail('timeout', 'the chest would not open') };
        return { ok: false, outcome: fail('error', String(e)) };
    } finally { t.dispose(); }
}

/** readChest goes to the chest at p and reads its items. */
export async function readChest(a: Act, p: Vec3Like, signal: AbortSignal): Promise<ChestRead> {
    const o = await open(a, p, signal);
    if (!o.ok) return o;
    try { return { ok: true, items: o.box.items() }; } finally { seen(a, p, o.box); try { o.box.close(); } catch { /* closed already */ } }
}

export type WithdrawResult = { ok: true; name: string; took: number } | { ok: false; outcome: Outcome; why?: string };

/**
 * withdraw takes from the chest at p what pick chooses from the chest's items (a name and a count; null: nothing
 * to take), across stacks. The caller's pick leaves the player kit out (design §11.1). On an abort a withdrawal
 * in flight may settle (≤ SETTLE_MS) before the chest closes, so the pack says what came out.
 */
export async function withdraw(a: Act, p: Vec3Like, pick: (items: ActItem[]) => { name: string; count: number } | { why: string },
    signal: AbortSignal): Promise<WithdrawResult> {
    const o = await open(a, p, signal);
    if (!o.ok) return o;
    const box = o.box;
    try {
        const want = pick(box.items());
        if ('why' in want) return { ok: false, outcome: fail('missing-item', want.why), why: want.why };
        let took = 0;
        const d = withTimeout(DEPOSIT_TIMEOUT_MS, signal);
        try {
            while (took < want.count) {
                const stack = box.items().find(i => i.name === want.name);
                if (!stack) break;
                const n = Math.min(want.count - took, stack.count);
                const taking = box.withdraw(want.name, n);
                try {
                    await race(taking, d.signal);
                } catch (e) {
                    if (signal.aborted) {
                        let t: NodeJS.Timeout | undefined;
                        await Promise.race([taking.catch(() => {}), new Promise(r => { t = setTimeout(r, SETTLE_MS); })]);
                        clearTimeout(t);
                        return { ok: false, outcome: fail('cancelled') };
                    }
                    if (timedOut(d.signal)) return took ? { ok: true, name: want.name, took } : { ok: false, outcome: fail('timeout', 'withdraw') };
                    return took ? { ok: true, name: want.name, took } : { ok: false, outcome: fail('error', String(e)) };
                }
                took += n;
            }
        } finally { d.dispose(); }
        return took ? { ok: true, name: want.name, took } : { ok: false, outcome: fail('missing-item', want.name), why: `Could not find any ${want.name} in the chest.` };
    } finally { seen(a, p, box); try { box.close(); } catch { /* closed already */ } }
}
