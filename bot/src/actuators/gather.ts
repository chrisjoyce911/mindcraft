// Gather a craft item (the old skills.layaGatherBlocks): n more of a laya-go gathered item, by collecting its
// blocks, then the items nearby. ok: the count grew (after a dig that collected some, waiting up to 3 s for a late
// inventory update: run a of 6.1 logged "Collected 1 oak_log" and called the gather failed, with the log in the pack).
//   log          any *_log within 64 (the nearest tree's wood)
//   wheat        only ripe wheat (age 7)
//   wheat_seeds  break short or tall grass until n seeds
//   bone         refused: bones come from skeletons
//   raw_iron     iron ore (and deepslate); coal → coal ore; diamond → diamond ore; else the item's block
import { carriedOf } from '../models/craft/index.js';
import type { Act } from './bot.js';
import { collectBlocks, pickupNearby } from './collect.js';
import { settle } from './settle.js';

export interface GatherResult { ok: boolean; message: string; cancelled: boolean }

const BLOCK_OF: Readonly<Record<string, string>> = { raw_iron: 'iron_ore', coal: 'coal', diamond: 'diamond' };
export const LOG_RANGE = 64;

export const GATHER_SETTLE_MS = 3000;

export async function gatherItem(a: Act, g: string, n: number, signal: AbortSignal, settleMs = GATHER_SETTLE_MS): Promise<GatherResult> {
    const count = () => carriedOf(a.bot.items(), g);
    const before = count();
    let message = '';
    let dug = 0;
    if (g === 'log') {
        const me = a.bot.entity.position;
        const logs = a.bot.blockNames(name => name.endsWith('_log'));
        const near = a.bot.findBlocks(logs, me, LOG_RANGE, 64)
            .sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) - Math.hypot(q.x - me.x, q.y - me.y, q.z - me.z))[0];
        const block = near ? a.bot.blockAt(near.x, near.y, near.z) : null;
        if (!block) return { ok: false, message: 'No trees nearby.', cancelled: false };
        ({ message, collected: dug } = await collectBlocks(a, block.name, n, signal));
    } else if (g === 'wheat') {
        ({ message, collected: dug } = await collectBlocks(a, 'wheat', n, signal, { accept: b => b.getProperties?.().age === 7 }));
    } else if (g === 'wheat_seeds') {
        for (let i = 0; i < 10 * n && count() - before < n && !signal.aborted; i++) {
            const short = await collectBlocks(a, 'short_grass', 1, signal);
            if (short.collected) { dug += short.collected; continue; }
            if (signal.aborted) break;
            const tall = await collectBlocks(a, 'tall_grass', 1, signal);
            if (!tall.collected) { message = 'No grass nearby.'; break; }
            dug += tall.collected;
        }
    } else if (g === 'bone') {
        return { ok: false, message: 'Bones come from skeletons: I cannot gather them by mining.', cancelled: false };
    } else {
        ({ message, collected: dug } = await collectBlocks(a, BLOCK_OF[g] ?? g, n, signal));
    }
    if (!signal.aborted) await pickupNearby(a, signal);
    // the dig collected some but the pack doesn't show it yet: the drop's slot update can come late
    const ok = count() > before
        || (dug > 0 && !signal.aborted && await settle(() => count() > before, { ms: settleMs, quiet: 0, signal }));
    return { ok, message, cancelled: signal.aborted };
}
