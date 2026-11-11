/* global Buffer */
// Reading the Laya step logs, bots/<agent>/logs/laya-<task>.jsonl: one JSON
// object per line with an ISO `time`.
import fs from 'fs';
import path from 'path';

export const TASKS = ['chores', 'command', 'craft', 'defend', 'director', 'eat', 'farm', 'follow', 'gather', 'hunt', 'mine', 'place'];
const TAIL_BYTES = 4 * 1024 * 1024; // only the last 4 MB of a big log is read

export function parseLines(text, task) {
    const out = [];
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const e = JSON.parse(line);
            if (e && typeof e === 'object') out.push({ task, ...e });
        } catch { /* a partly written line */ }
    }
    return out;
}

// matchValue: a value matches "/re/flags" as a regex, otherwise by equality
// (as strings, so 5 matches "5").
export function matchValue(actual, want) {
    if (typeof want === 'string') {
        const m = want.match(/^\/(.*)\/([a-z]*)$/s);
        if (m) return new RegExp(m[1], m[2] || 'i').test(typeof actual === 'string' ? actual : JSON.stringify(actual ?? ''));
    }
    return String(actual) === String(want);
}

// matches: match is an object of field → wanted value (dotted fields work),
// or a string looked for anywhere in the entry's JSON (any case).
export function matches(entry, match) {
    if (match == null) return true;
    if (typeof match === 'string') return JSON.stringify(entry).toLowerCase().includes(match.toLowerCase());
    return Object.entries(match).every(([k, v]) => matchValue(k.split('.').reduce((o, p) => o?.[p], entry), v));
}

const ms = t => (t == null ? null : typeof t === 'number' ? t : Date.parse(t));

export function filterEntries(entries, { since = null, until = null, match = null } = {}) {
    const s = ms(since), u = ms(until);
    return entries.filter(e => {
        const t = Date.parse(e.time);
        if (s != null && !(t >= s)) return false;
        if (u != null && !(t <= u)) return false;
        return matches(e, match);
    });
}

function readTail(file) {
    const size = fs.statSync(file).size;
    if (size <= TAIL_BYTES) return fs.readFileSync(file, 'utf8');
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(TAIL_BYTES);
        fs.readSync(fd, buf, 0, TAIL_BYTES, size - TAIL_BYTES);
        const text = buf.toString('utf8');
        return text.slice(text.indexOf('\n') + 1);
    } finally { fs.closeSync(fd); }
}

// readLogs returns entries of one task (or all) in time order, filtered,
// the last `limit` of them.
export function readLogs(logDir, { task = null, since = null, until = null, match = null, limit = 50 } = {}) {
    const tasks = task ? [].concat(task) : TASKS;
    let all = [];
    for (const t of tasks) {
        const file = path.join(logDir, `laya-${t}.jsonl`);
        if (!fs.existsSync(file)) continue;
        all = all.concat(filterEntries(parseLines(readTail(file), t), { since, until, match }));
    }
    all.sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    return limit ? all.slice(-limit) : all;
}

// brief: an entry without its long multi-line state, for reports and tools.
export function brief(entry, stateChars = 0) {
    const { state, ...rest } = entry;
    if (stateChars && typeof state === 'string') rest.state = state.slice(0, stateChars);
    return rest;
}
