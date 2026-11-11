// Gather a craft item (the old skills.layaGatherBlocks): n more of a laya-go gathered item, by collecting its
// blocks, then the items nearby. ok: the count grew.
//   log          any *_log within 64 (the nearest tree's wood)
//   wheat        only ripe wheat (age 7)
//   wheat_seeds  break short or tall grass until n seeds
//   bone         refused: bones come from skeletons
//   raw_iron     iron ore (and deepslate); coal → coal ore; diamond → diamond ore; else the item's block
import { carriedOf } from '../models/craft/index.js';
import type { Act } from './bot.js';
import { collectBlocks, pickupNearby } from './collect.js';

export interface GatherResult { ok: boolean; message: string; cancelled: boolean }

const BLOCK_OF: Readonly<Record<string, string>> = { raw_iron: 'iron_ore', coal: 'coal', diamond: 'diamond' };
export const LOG_RANGE = 64;

export async function gatherItem(a: Act, g: string, n: number, signal: AbortSignal): Promise<GatherResult> {
    const count = () => carriedOf(a.bot.items(), g);
    const before = count();
    let message = '';
    if (g === 'log') {
        const me = a.bot.entity.position;
        const logs = a.bot.blockNames(name => name.endsWith('_log'));
        const near = a.bot.findBlocks(logs, me, LOG_RANGE, 64)
            .sort((p, q) => Math.hypot(p.x - me.x, p.y - me.y, p.z - me.z) - Math.hypot(q.x - me.x, q.y - me.y, q.z - me.z))[0];
        const block = near ? a.bot.blockAt(near.x, near.y, near.z) : null;
        if (!block) return { ok: false, message: 'No trees nearby.', cancelled: false };
        message = (await collectBlocks(a, block.name, n, signal)).message;
    } else if (g === 'wheat') {
        message = (await collectBlocks(a, 'wheat', n, signal, { accept: b => b.getProperties?.().age === 7 })).message;
    } else if (g === 'wheat_seeds') {
        for (let i = 0; i < 10 * n && count() - before < n && !signal.aborted; i++) {
            const short = await collectBlocks(a, 'short_grass', 1, signal);
            if (short.collected) continue;
            if (signal.aborted) break;
            const tall = await collectBlocks(a, 'tall_grass', 1, signal);
            if (!tall.collected) { message = 'No grass nearby.'; break; }
        }
    } else if (g === 'bone') {
        return { ok: false, message: 'Bones come from skeletons: I cannot gather them by mining.', cancelled: false };
    } else {
        message = (await collectBlocks(a, BLOCK_OF[g] ?? g, n, signal)).message;
    }
    if (!signal.aborted) await pickupNearby(a, signal);
    return { ok: count() > before, message, cancelled: signal.aborted };
}
