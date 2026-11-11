// The chores Last line (skills-spec v1 §1 "Last", §7): the latest result of each (skill, target) run as a chore in
// the last 10 minutes, latest first, at most 4. It is not kept in memory: it is rebuilt from laya-chores.jsonl's run
// lines (their time is the run's end, real time) at start and on every ask, so a failure's 5-minute cooldown runs on
// across a restart. Only the file's tail is read (the file grows). A forget line (a world reset) drops the runs before it.
import fs from 'fs';
import {
    CHORES_MAX, LAST_WINDOW, isChorePair, isChoreReason,
    type ChoreReason, type ChoreSkill, type ChoreTarget, type LastRun,
} from '../types/chores.js';

/** A run as the Last line needs it: when it ended (ms), its pair and result. */
export interface RunEnd { at: number; skill: ChoreSkill; target: ChoreTarget; done: boolean; reason?: ChoreReason }

/** How much of laya-chores.jsonl's end is read (≈ 600 lines; a run line is ~100 bytes, an ask line ~1 KB). */
export const TAIL_BYTES = 256 * 1024;

/** ageOf: ⌊(now − end) / 60 s⌋, rounded down (0 under a minute, 4 up to 4 min 59 s); never below 0. */
export const ageOf = (now: number, at: number): number => Math.max(0, Math.floor((now - at) / 60_000));

/**
 * lastOf: the Last entries at now: the latest run of each pair whose age is under 10, latest first (ties: the later
 * line first), at most 4.
 */
export function lastOf(runs: readonly RunEnd[], now: number): LastRun[] {
    const out: LastRun[] = [];
    const seen = new Set<string>();
    const ordered = runs.map((r, i) => ({ r, i })).sort((a, b) => b.r.at - a.r.at || b.i - a.i);
    for (const { r } of ordered) {
        const key = `${r.skill} ${r.target}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const age = ageOf(now, r.at);
        if (age >= LAST_WINDOW) continue;
        out.push({ skill: r.skill, target: r.target, done: r.done, age, ...(r.done ? {} : { reason: r.reason! }) });
        if (out.length === CHORES_MAX.last) break;
    }
    return out;
}

/** runOf: a laya-chores.jsonl line as a run, or null (an ask line, a malformed or foreign one). */
export function runOf(line: string): RunEnd | null {
    let j: Record<string, unknown>;
    try { j = JSON.parse(line) as Record<string, unknown>; } catch { return null; }
    if (!j || j.event !== 'run' || typeof j.skill !== 'string' || typeof j.target !== 'string' || typeof j.time !== 'string') return null;
    if (!isChorePair(j.skill, j.target)) return null;
    const at = Date.parse(j.time);
    if (!Number.isFinite(at)) return null;
    if (j.result === 'done') return { at, skill: j.skill as ChoreSkill, target: j.target as ChoreTarget, done: true };
    if (j.result !== 'failed' || typeof j.reason !== 'string' || !isChoreReason(j.reason)) return null;
    return { at, skill: j.skill as ChoreSkill, target: j.target as ChoreTarget, done: false, reason: j.reason };
}

/**
 * isForget: a forget line ({"event":"forget"}): the world before it is gone (the test harness's world reset writes
 * one); runs before it don't count.
 */
const isForget = (line: string): boolean => line.includes('"forget"') && (() => { try { return JSON.parse(line).event === 'forget'; } catch { return false; } })();

/** readRuns: the run lines in the file's tail after the last forget line (none when there is no file). */
export function readRuns(file: string, tail: number = TAIL_BYTES): RunEnd[] {
    let fd: number | null = null;
    try {
        fd = fs.openSync(file, 'r');
        const size = fs.fstatSync(fd).size;
        const start = Math.max(0, size - tail);
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        const lines = buf.toString('utf8').split('\n');
        if (start > 0) lines.shift(); // a cut first line
        let from = 0;
        lines.forEach((l, i) => { if (isForget(l)) from = i + 1; });
        return lines.slice(from).map(runOf).filter((r): r is RunEnd => r !== null);
    } catch {
        return [];
    } finally {
        if (fd !== null) try { fs.closeSync(fd); } catch { /* closed */ }
    }
}

/** lastFromFile: the Last line now, from the run lines in the file. */
export const lastFromFile = (file: string, now: number): LastRun[] => lastOf(readRuns(file), now);
