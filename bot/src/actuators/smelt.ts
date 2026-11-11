// Smelt (the old skills.smeltItem): a furnace within 16, else place the carried one (and take it back after).
// Fuel in FUELS order (coal, charcoal, logs, planks), enough for num; the input; take the output as it comes,
// until num or 11 s with nothing new; take back what's left in the input and fuel slots; close. On an abort the
// wait ends at once and the furnace is emptied into the pack and closed in the background (never left behind).
import { race, withTimeout } from '../core/abort.js';
import type { Vec3Like } from '../types/index.js';
import type { Act, ActFurnace } from './bot.js';
import { goNear } from './approach.js';
import { nearestBlock } from './craft.js';
import { placeStation, takeBack } from './place.js';
import { wait } from './settle.js';

export const FURNACE_RANGE = 16;
export const OPEN_TIMEOUT_MS = 5000;
export const IDLE_MS = 11000;
/** Items one fuel smelts (minecraft: coal and charcoal 8, logs and planks 1.5). */
export const FUEL_OUTPUT: Readonly<Record<string, number>> = { coal: 8, charcoal: 8, log: 1.5, planks: 1.5 };
const FUEL_ORDER = ['coal', 'charcoal', 'log', 'planks'] as const;

export interface SmeltResult { ok: boolean; message: string; cancelled?: boolean; smelted: number }

const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const countOf = (a: Act, name: string) => a.bot.items().filter(i => i.name === name).reduce((n, i) => n + i.count, 0);
const fuelKind = (name: string) => (name.endsWith('_log') || name.endsWith('_stem') ? 'log' : name.endsWith('_planks') ? 'planks' : name);

/** pickFuel: the carried fuel to use, first by FUEL_ORDER (the most carried of a kind). */
export function pickFuel(items: readonly { name: string; count: number }[]): { name: string; count: number; per: number } | null {
    for (const kind of FUEL_ORDER) {
        const it = items.filter(i => fuelKind(i.name) === kind).sort((x, y) => y.count - x.count)[0];
        if (it) return { name: it.name, count: items.filter(i => i.name === it.name).reduce((n, i) => n + i.count, 0), per: FUEL_OUTPUT[kind]! };
    }
    return null;
}

/** smeltItem smelts num of itemName (the raw item: raw_iron, sand, cobblestone, a log). */
export async function smeltItem(a: Act, itemName: string, num: number, signal: AbortSignal): Promise<SmeltResult> {
    const cancelled = (smelted = 0): SmeltResult => ({ ok: false, message: 'cancelled', cancelled: true, smelted });
    let at = nearestBlock(a, ['furnace'], FURNACE_RANGE);
    let placed: Vec3Like | null = null;
    if (!at && a.bot.items().some(i => i.name === 'furnace')) {
        const p = await placeStation(a, 'furnace', signal, FURNACE_RANGE);
        if (signal.aborted) return cancelled();
        if (p.ok) at = placed = p.at;
    }
    if (!at) return { ok: false, message: 'There is no furnace nearby and you have no furnace.', smelted: 0 };
    const putBack = async () => { if (placed && !signal.aborted) await takeBack(a, placed, 'furnace', signal); };
    const fail = async (message: string): Promise<SmeltResult> => { await putBack(); return { ok: false, message, smelted: 0 }; };
    if (dist(a.bot.entity.position, at) > 4) {
        const o = await goNear(a, at, 3, signal);
        if (signal.aborted) return cancelled();
        if (!o.ok) return fail(`Could not reach the furnace (${o.reason}).`);
    }
    if (countOf(a, itemName) < num) return fail(`You do not have enough ${itemName} to smelt.`);
    let f: ActFurnace;
    const t = withTimeout(OPEN_TIMEOUT_MS, signal);
    try {
        const opening = a.bot.openFurnace(at);
        f = await race(opening, t.signal, () => { opening.then(x => x.close(), () => {}); });
    } catch (e) {
        if (signal.aborted) return cancelled();
        return fail(`The furnace would not open: ${e instanceof Error ? e.message : String(e)}.`);
    } finally { t.dispose(); }
    // empty the furnace into the pack and close it (an abort does this in the background)
    const empty = async () => {
        try { if (f.output()) await f.takeOutput(); } catch { /* best effort */ }
        try { if (f.input()) await f.takeInput(); } catch { /* best effort */ }
        try { if (f.fuel()) await f.takeFuel(); } catch { /* best effort */ }
        try { f.close(); } catch { /* closed already */ }
    };
    try {
        const input = f.input();
        if (input && input.name !== itemName && input.count > 0) {
            try { f.close(); } catch { /* closed */ }
            return fail(`The furnace is currently smelting ${input.name}.`);
        }
        if (!f.fuel()) {
            const fuel = pickFuel(a.bot.items());
            if (!fuel) { try { f.close(); } catch { /* closed */ } return fail(`You have no fuel to smelt ${itemName}, you need coal, charcoal, or wood.`); }
            const put = Math.ceil(num / fuel.per);
            if (fuel.count < put) { try { f.close(); } catch { /* closed */ } return fail(`You don't have enough ${fuel.name} to smelt ${num} ${itemName}; you need ${put}.`); }
            await race(f.putFuel(fuel.name, put), signal);
        }
        await race(f.putInput(itemName, num), signal);
        let total = 0, last = Date.now();
        let outName = '';
        if (!(await wait(200, signal))) { void empty(); return cancelled(); }
        while (total < num) {
            if (!(await wait(1000, signal))) { void empty(); return cancelled(total); }
            if (f.output()) {
                const got = await race(f.takeOutput(), signal);
                if (got) { total += got.count; outName = got.name; last = Date.now(); }
            }
            if (Date.now() - last > IDLE_MS) break;
        }
        await empty();
        await putBack();
        if (total === 0) return { ok: false, message: `Failed to smelt ${itemName}.`, smelted: 0 };
        if (total < num) return { ok: false, message: `Only smelted ${total} ${outName}.`, smelted: total };
        return { ok: true, message: `Successfully smelted ${itemName}, got ${total} ${outName}.`, smelted: total };
    } catch (e) {
        void empty();
        if (signal.aborted) return cancelled();
        await putBack();
        return { ok: false, message: `Failed to smelt ${itemName}: ${e instanceof Error ? e.message : String(e)}.`, smelted: 0 };
    }
}
