// legacyLine: a Command as the old bot's command line, for laya-command.jsonl's `lines` only (the old log kept
// the lines the plan ran). It is the inverse of harness/legacy.ts parseLegacy and the one place `!name(args)`
// text is written; nothing parses or runs it (bot/test/command.test.ts round-trips every Command the plan makes).

import type { Command } from '../types/commands.js';
import type { JobSpec } from '../types/jobs.js';

/**
 * legacyName: the old command (action) name of a job, without the `!`. The job's lease is `action:<name>`, the
 * old bot's action label, which the game scenarios and the harness's action.current match (followPlayer, …).
 */
export function legacyName(j: JobSpec): string {
    switch (j.kind) {
        case 'follow': return 'followPlayer';
        case 'come': return 'goToPlayer';
        case 'stay': return 'stay';
        case 'hunt': return j.item === null ? 'attack' : 'hunt';
        case 'gather': return j.legacy ?? 'layaGather';
        case 'mine': return 'layaMine';
        case 'farm': return 'layaFarm';
        case 'home': return 'setHomeChest';
        case 'craft': return j.legacy ?? 'layaCraft';
        case 'give': return 'givePlayer';
        case 'store': return 'putInChest';
        case 'eat': return 'consume';
    }
}

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
    const n = `!${legacyName(j)}`;
    switch (j.kind) {
        case 'follow': case 'come': return `${n}(${q(j.player)}, ${j.distance})`;
        case 'stay': return `${n}(${j.seconds})`;
        case 'hunt': return j.item === null ? `${n}(${q(j.mob)})` : `${n}(${q(j.mob)}, ${q(j.item)}, ${j.count})`;
        case 'gather': case 'craft': return `${n}(${q(j.item)}, ${j.count})`;
        case 'mine': return j.count === 'forever' ? `${n}(${q(j.ore)})` : `${n}(${q(j.ore)}, ${j.count})`;
        case 'farm': return j.goal === 'forever' ? `${n}(${q(j.crop)})` : `${n}(${q(j.crop)}, ${j.goal.count})`;
        case 'home': return n;
        case 'give': return `${n}(${q(j.player)}, ${q(j.item)}, ${j.count})`;
        case 'store': return `${n}(${q(j.item)}, ${j.count})`;
        case 'eat': return `${n}(${q(j.item)})`;
    }
}
