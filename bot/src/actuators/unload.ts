// Unload at home (the old pack_actions.js goHome and depositAtHome): walk to the home chest, then put the listed
// items into it and, when it is full, into the chests touching it. Returns what didn't go in. The deposit goes
// item by item through the chest actuator (each opens, deposits and closes the chest; abort-safe).
import type { Vec3Like } from '../types/index.js';
import { chestsAt, depositAll, type Stack } from '../home/chest.js';
import type { Act } from './bot.js';
import { goNear } from './approach.js';
import { deposit } from './chest.js';

export const HOME_RANGE = 2;

/** goHome walks within HOME_RANGE of the home chest. */
export async function goHome(a: Act, home: Vec3Like, signal: AbortSignal): Promise<boolean> {
    const o = await goNear(a, home, HOME_RANGE, signal, 60000);
    return o.ok;
}

const have = (a: Act, name: string) => a.bot.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);

/**
 * depositAtHome puts items into the home chest, then the chests touching it; returns what is left ([] : all went
 * in). null when there is no chest at home.
 */
export async function depositAtHome(a: Act, home: Vec3Like, items: readonly Stack[], signal: AbortSignal): Promise<Stack[] | null> {
    const chests = chestsAt(home, (x, y, z) => a.bot.blockAt(x, y, z));
    if (!chests.length) return null;
    return depositAll(chests, items, async (chest, list) => {
        const left: Stack[] = [];
        let opened = false;
        for (const { name, count } of list) {
            if (signal.aborted) { left.push({ name, count }); continue; }
            const before = have(a, name);
            const n = Math.min(count, before);
            if (n <= 0) continue;
            const o = await deposit(a, chest, name, n, signal);
            const moved = Math.max(0, before - have(a, name));
            if (o.ok || moved) opened = true;
            if (count - moved > 0) left.push({ name, count: count - moved });
        }
        // a chest that never opened: the next one
        if (!opened && !signal.aborted) throw new Error('the chest would not open');
        return left;
    });
}
