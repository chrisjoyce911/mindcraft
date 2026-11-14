// Gather a craft item (the old skills.layaGatherBlocks): n more of a laya-go gathered item, by collecting its
// blocks, then the items nearby. ok: the count grew (after a dig that collected some, waiting up to 3 s for a late
// inventory update: run a of 6.1 logged "Collected 1 oak_log" and called the gather failed, with the log in the pack).
// 6.2b: every target is looked for in rings 49 → 97 → 193 around where the gather started (as the skills' search
// widens), and only after the widest does it say there is none (within 96 blocks).
//   log          any *_log (the nearest tree's wood)
//   wheat        only ripe wheat (age 7)
//   wheat_seeds  break short or tall grass until n seeds
//   bone         refused: bones come from skeletons
//   raw_iron     iron ore (and deepslate); coal → coal ore; diamond → diamond ore; else the item's block
import { carriedOf } from '../models/craft/index.js';
import type { Vec3Like } from '../types/index.js';
import type { Act } from './bot.js';
import { collectBlocks, findRinged, pickupNearby, rings, RINGS_REACH } from './collect.js';
import { settle } from './settle.js';

export interface GatherResult { ok: boolean; message: string; cancelled: boolean }

const BLOCK_OF: Readonly<Record<string, string>> = { raw_iron: 'iron_ore', coal: 'coal', diamond: 'diamond' };

export const GATHER_SETTLE_MS = 3000;

export async function gatherItem(a: Act, g: string, n: number, signal: AbortSignal, settleMs = GATHER_SETTLE_MS): Promise<GatherResult> {
    const count = () => carriedOf(a.bot.items(), g);
    const before = count();
    let message = '';
    let dug = 0;
    const r = rings(a.bot.entity.position);
    if (g === 'log') {
        const logs = a.bot.blockNames(name => name.endsWith('_log'));
        const near = findRinged(a, logs, r, sorted => sorted[0]);
        const block = near ? a.bot.blockAt(near.x, near.y, near.z) : null;
        if (!block) return { ok: false, message: `No trees nearby (none within ${RINGS_REACH} blocks).`, cancelled: false };
        ({ message, collected: dug } = await collectBlocks(a, block.name, n, signal, { rings: r }));
    } else if (g === 'wheat') {
        ({ message, collected: dug } = await collectBlocks(a, 'wheat', n, signal, { accept: b => b.getProperties?.().age === 7, rings: r }));
    } else if (g === 'wheat_seeds') {
        // short and tall grass in one ring at a time: the nearer of either first, the ring kept between blocks
        // a grass block andy couldn't reach or dig is left out and the next one tried (only "none left" ends it)
        const skip: Vec3Like[] = [];
        for (let i = 0; i < 10 * n && count() - before < n && !signal.aborted; i++) {
            const grass = await collectBlocks(a, 'short_grass', 1, signal, { rings: r, kin: ['tall_grass'], exclude: skip });
            dug += grass.collected;
            skip.push(...(grass.failed ?? []));
            if (grass.none) { if (!signal.aborted) message = `No grass nearby (none within ${RINGS_REACH} blocks).`; break; }
        }
        if (!message && count() - before < n && !signal.aborted) message = `Broke grass ${dug} times${skip.length ? ` (${skip.length} out of reach)` : ''}; seeds are rare drops.`;
    } else if (g === 'bone') {
        return { ok: false, message: 'Bones come from skeletons: I cannot gather them by mining.', cancelled: false };
    } else {
        ({ message, collected: dug } = await collectBlocks(a, BLOCK_OF[g] ?? g, n, signal, { rings: r }));
    }
    if (!signal.aborted) await pickupNearby(a, signal);
    // the dig collected some but the pack doesn't show it yet: the drop's slot update can come late
    const ok = count() > before
        || (dug > 0 && !signal.aborted && await settle(() => count() > before, { ms: settleMs, quiet: 0, signal }));
    return { ok, message, cancelled: signal.aborted };
}
