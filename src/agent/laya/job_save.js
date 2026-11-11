// A player's Laya job kept across a restart (live play 3, 2026-11-11: the
// agent process was killed and restarted in the middle of "collect 4 coal",
// and the job was gone).
//
// The job on the stack that came from a player's command (not a chore) is
// written to bots/<name>/laya-job.json with what it has done so far
// (job.save()); when it ends, is replaced or the stack is cleared, the file
// goes. After a restart, a fresh file (MAX_AGE_MS) puts the job back on the
// stack as paused, so the director resumes it (rule resume-paused); an old
// or unknown one is reported as lost.

import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { dirname } from 'path';

export const MAX_AGE_MS = 15 * 60_000;
const VERB = { layaCraft: 'make', layaGather: 'get', layaMine: 'mine', layaFarm: 'farm', hunt: 'hunt for' };

// savable: the stack's job a restart should bring back (the bottom job with
// a save(), i.e. a player's command), or null.
export function savable(stack) {
    return stack.items.find(e => e.type === 'job' && typeof e.save === 'function') || null;
}

// saveJob writes the stack's savable job to path, or removes the file.
// Never throws.
export function saveJob(path, stack, now = Date.now()) {
    try {
        const job = savable(stack);
        if (!job) { rmSync(path, { force: true }); return null; }
        const entry = { name: job.name, args: job.args, saved: job.save(), at: now };
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(entry));
        return entry;
    } catch { return null; }
}

// loadJob reads and removes the saved job: {entry, fresh} or null.
export function loadJob(path, now = Date.now()) {
    let entry = null;
    try { entry = JSON.parse(readFileSync(path, 'utf8')); } catch { return null; }
    try { rmSync(path, { force: true }); } catch { /* gone */ }
    if (!entry?.name || !Array.isArray(entry.args)) return null;
    return { entry, fresh: now - (entry.at || 0) <= MAX_AGE_MS };
}

// jobWords: "get 4 coal" for a saved job.
export function jobWords(e) {
    const [item, n] = e.name === 'hunt' ? [e.args[1], e.args[2]] : [e.args[0], e.args[1]];
    const what = [n != null && n !== 'any' ? n : null, item == null ? null : String(item).replace(/_/g, ' ')].filter(x => x != null).join(' ');
    return `${VERB[e.name] || 'do'}${what ? ' ' + what : ''}`;
}

// restoreMessage: what andy says after a restart about the saved job.
export function restoreMessage(e, restored) {
    return restored
        ? `I was restarted while I was going to ${jobWords(e)}. I'll carry on with it.`
        : `I was restarted and lost my job (${jobWords(e)}). Ask me again if you still want it.`;
}
