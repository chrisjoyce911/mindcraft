// legacyLine: a Command as the old bot's command line, for laya-command.jsonl's `lines` only (the old log kept
// the lines the plan ran). It is the inverse of harness/legacy.ts parseLegacy and the one place `!name(args)`
// text is written; nothing parses or runs it (bot/test/command.test.ts round-trips every Command the plan makes).

import type { Command } from '../types/commands.js';

const q = (s: string) => JSON.stringify(String(s));

/** The old line for a Command, or null for one that never was a line (reply, ignore). */
export function legacyLine(c: Command): string | null {
    switch (c.kind) {
        case 'stop': return '!stop';
        case 'inventory': return '!inventory';
        case 'chores': return `!layaChores(${q(c.on ? 'on' : 'off')})`;
        case 'reply': case 'ignore': return null;
        case 'job': break;
    }
    const j = c.job;
    switch (j.kind) {
        case 'follow': return `!followPlayer(${q(j.player)}, ${j.distance})`;
        case 'come': return `!goToPlayer(${q(j.player)}, ${j.distance})`;
        case 'stay': return `!stay(${j.seconds})`;
        case 'hunt': return j.item === null ? `!attack(${q(j.mob)})` : `!hunt(${q(j.mob)}, ${q(j.item)}, ${j.count})`;
        case 'gather': return `!${j.legacy ?? 'layaGather'}(${q(j.item)}, ${j.count})`;
        case 'mine': return j.count === 'forever' ? `!layaMine(${q(j.ore)})` : `!layaMine(${q(j.ore)}, ${j.count})`;
        case 'farm': return j.goal === 'forever' ? `!layaFarm(${q(j.crop)})` : `!layaFarm(${q(j.crop)}, ${j.goal.count})`;
        case 'home': return '!setHomeChest';
        case 'craft': return `!${j.legacy ?? 'layaCraft'}(${q(j.item)}, ${j.count})`;
        case 'give': return `!givePlayer(${q(j.player)}, ${q(j.item)}, ${j.count})`;
        case 'store': return `!putInChest(${q(j.item)}, ${j.count})`;
        case 'eat': return `!consume(${q(j.item)})`;
    }
}
