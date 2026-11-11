// The mine state: laya-go's mine prompt v1, or v2 with the plan's next step and the pack line (games/mine/prompt).
// A typed port of the old mine_state.js state(). The text must match laya-go byte for byte: test/mine.state.test.ts
// checks it against laya-go's golden requests and 300 generated situations each.
//
//   Mine.
//   Ore iron Y 41 Pick stone Torches 6 Blocks 20 Dark 7 Heading E
//   Plan tunnel E                                                       (v2)
//   Pack 5 Home 12 Health 20 Food 20 Hostiles 0 Valuables 0             (v2)
//   Seen none
//   SSSSS SSSSS SSSSS SSSSS SSSSS   (five rows: each layer's row z, layers above → below)
import { HOME_CAP, HOSTILES_CAP, TIERS, VALUABLES_CAP, type Dir, type Ore, type Tier } from './data.js';
import type { MoveAction } from './questions.js';
import { SIZE, type View } from './view.js';

/** The plan and pack fields of prompt v2. */
export interface MinePack {
    /** The plan's next step (null: andy is off the plan, walking back to it: the model isn't asked). */
    plan: MoveAction | null;
    /** Empty inventory slots. */
    free: number;
    /** The home chest's distance (homeDistance), or null when none is known. */
    home: number | null;
    health: number;
    food: number;
    /** Hostile mobs within 16 blocks. */
    hostiles: number;
    valuables: number;
}

/** What andy knows when he decides a mine step (the old situation object); v2 adds the pack fields. */
export interface MineSituation extends Partial<MinePack> {
    ore: Ore;
    y: number;
    pick: Tier;
    torches: number;
    blocks: number;
    dark: number;
    heading: Dir;
    /** The distance to the ore to collect (rounded up, at least 1), or 0 when none. */
    seen: number;
    view: View;
}

/** state writes a situation as prompt v1, or v2 when it has a plan step. */
export function state(s: MineSituation): string {
    const lines = ['Mine.',
        `Ore ${s.ore} Y ${s.y} Pick ${TIERS[s.pick]} Torches ${s.torches} Blocks ${s.blocks} Dark ${s.dark} Heading ${s.heading}`];
    if (s.plan) lines.push(`Plan ${s.plan}`,
        `Pack ${s.free} Home ${s.home == null ? 'none' : Math.min(s.home, HOME_CAP)} Health ${s.health} Food ${s.food} ` +
        `Hostiles ${Math.min(s.hostiles ?? 0, HOSTILES_CAP)} Valuables ${Math.min(s.valuables ?? 0, VALUABLES_CAP)}`);
    lines.push(s.seen > 0 ? `Seen ${s.seen}` : 'Seen none');
    for (let z = 0; z < SIZE; z++) lines.push(s.view.map(layer => layer[z]!.join('')).join(' '));
    return lines.join('\n');
}
