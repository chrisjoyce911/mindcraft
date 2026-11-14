// Item resolution (laya-go generate.ResolveFor, HuntFor, BestTier): the Minecraft item a command acts on, from
// the Item key, the Tier and what the bot carries. An exact port of src/agent/laya/command_state.js; laya-go's
// resolve_cases fixtures pin it.

import type { Carried } from '../../types/facts.js';
import { ARMOR, CROPS, DROPS, FOODS, KINDS_V2, KINDS_V21, MOBS, NONE, TOOLS, type CommandPrompt, type Kind } from './vocab.js';

const includes = (list: readonly string[], v: string) => list.includes(v);

/** kindOf: prompt v's kind: v2's kinds for v1 and v2, v2.1's (with the drops) for v2.1 and v2.2. */
function kindOf(key: string, v: CommandPrompt): Kind | undefined {
    return (v === 'v2.1' || v === 'v2.2' ? KINDS_V21 : KINDS_V2).find(k => k.key === key);
}

/** huntFor: the mob a gather of item hunts, or '' when it isn't an animal drop (v2.1's drops, wool, string). */
export function huntFor(item: string): string {
    if (item === 'white_wool') return 'sheep';
    if (item === 'string') return 'spider';
    return DROPS.find(k => k.gather === item)?.hunt ?? '';
}

/** bestTier: the tier a tool without one is made in. */
export function bestTier(carry: readonly Carried[]): 'diamond' | 'iron' | 'stone' | 'wooden' {
    const have = (name: string) => carry.filter(s => s.name === name).reduce((n, s) => n + s.count, 0);
    if (have('diamond') >= 3) return 'diamond';
    if (have('iron_ingot') >= 3) return 'iron';
    if (have('cobblestone') >= 3) return 'stone';
    return 'wooden';
}

/** pick: the carried item matching with the most items, the first on a tie; none when nothing matches. */
export function pick(carry: readonly Carried[], match: (name: string) => boolean): string {
    let best = NONE, n = 0;
    for (const s of carry) if (match(s.name) && s.count > n) { best = s.name; n = s.count; }
    return best;
}

/** resolve: the Minecraft item command acts on, or none. */
export function resolve(command: string, key: string, tier: string, carry: readonly Carried[], v: CommandPrompt = 'v2'): string {
    if (!key || key === NONE) return NONE;
    const tool = includes(TOOLS, key), armor = includes(ARMOR, key);
    const noTier = !tier || tier === NONE;
    switch (command) {
        case 'attack':
            return includes(MOBS, key) ? key : NONE;
        case 'farm':
            return includes(CROPS, key) ? key : NONE;
        case 'gather': case 'mine': {
            const k = kindOf(key, v);
            return k && k.gather && (command === 'gather' || !k.hunt) ? k.gather : NONE;
        }
        case 'craft': {
            if (tool) return `${noTier ? bestTier(carry) : tier}_${key}`;
            if (armor) return `${noTier || tier === 'wooden' || tier === 'stone' ? 'iron' : tier}_${key}`;
            const k = kindOf(key, v);
            return k && k.craft ? k.craft : NONE;
        }
        case 'give': case 'store': case 'eat': {
            let match: (n: string) => boolean;
            if (tool || armor) {
                match = n => n.endsWith('_' + key) && (noTier || n.startsWith(tier + '_'));
            } else {
                const k = kindOf(key, v);
                if (!k) return NONE;
                match = k.carried;
            }
            if (command === 'eat') {
                const m = match;
                match = n => m(n) && FOODS.includes(n);
            }
            return pick(carry, match);
        }
    }
    return NONE;
}
