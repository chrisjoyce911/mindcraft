// The follow job (the old skills.followPlayer and src/agent/laya/follow.js): with the follow model on, one
// decision per step: arrived → wait step_ms; else read the 9×9 window, ask Move and Hazard, and step one block
// unless the safety rules refuse it. Fall back to the pathfinder follow for fallback_ms when there is no
// answer, the answer isn't confident, the model keeps saying wait while andy hasn't arrived, the rules refuse
// the move, or a step doesn't move him. With the model off: the plain pathfinder follow. It never ends by
// itself, except when the player isn't there at the start ("Could not find X.").
import type { Facts, FollowFallback, JobStepper, StepResult, Vec3Like } from '../types/index.js';
import { FOLLOW_FALLBACKS } from '../types/index.js';
import { race } from '../core/abort.js';
import { check, decideFollowStep, OFFSETS, parseGrid, readWindow, type FollowRead, type MobColumn } from '../models/follow/index.js';
import { followFor, stepTo } from '../actuators/follow.js';
import type { Act, ActEntity } from '../actuators/bot.js';
import { followLine, type FollowLogInput } from '../log/jsonl.js';
import { notFound, pause, type JobDeps, type JobOf } from './deps.js';

/** A run's counters (the old newCounters). */
export interface FollowCounters {
    asked: number; stepped: number; arrivedTicks: number; vetoes: Record<string, number>; damage: number; stuckSeconds: number;
    fallbacks: Record<FollowFallback, number>;
}
export const newCounters = (): FollowCounters => ({
    asked: 0, stepped: 0, arrivedTicks: 0, vetoes: {}, damage: 0, stuckSeconds: 0,
    fallbacks: Object.fromEntries(FOLLOW_FALLBACKS.map(r => [r, 0])) as Record<FollowFallback, number>,
});

/** summary writes a run's counters as one line (the old follow.js summary). */
export function summary(c: Pick<FollowCounters, 'asked' | 'stepped' | 'vetoes' | 'damage' | 'stuckSeconds'> & { fallbacks: Partial<Record<FollowFallback, number>> }): string {
    const fb = Object.entries(c.fallbacks).filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    return `Laya follow: asked ${c.asked}, stepped ${c.stepped}, fallbacks: ${fb}; vetoes: ${vetoes}; damage ${c.damage}, stuck ${c.stuckSeconds.toFixed(1)} s`;
}

/** Without the model: follow with the pathfinder for this long per step. */
export const PLAIN_FOLLOW_MS = 2000;

const dist3 = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** mobColumns: every named entity but andy, as block columns (the follow state keeps the known hostiles). */
function mobColumns(a: Act): MobColumn[] {
    const me = a.bot.entity;
    return Object.values(a.bot.entities)
        .filter(e => e.position && e.name && e.position !== me.position)
        .map(e => ({ kind: e.name as string, x: Math.floor(e.position.x), z: Math.floor(e.position.z) }));
}

/** The follow runner; counters for the tests and the summary line. */
export interface FollowStepper extends JobStepper { readonly counters: FollowCounters }

export function followRunner(job: JobOf<'follow'>, deps: JobDeps): FollowStepper {
    const { player: username, distance } = job.spec;
    const counters = newCounters();
    let waits = 0;
    let lastHealth: number | null = null;
    let first = true;
    let laya = false;

    const log = (e: FollowLogInput, logSteps: boolean) => { if (logSteps) deps.followLog(followLine(e)); };

    return {
        counters,
        async step(_facts: Facts, signal: AbortSignal): Promise<StepResult> {
            const a = deps.act();
            if (!a) { await pause(250, signal); return { how: 'more' }; }
            const player = a.bot.player(username);
            if (!player) {
                if (first) return { how: 'end', end: { how: 'failed', reason: notFound(username) }, say: notFound(username) };
                await pause(250, signal);   // out of sight for now: wait for them
                return { how: 'more' };
            }
            const opts = deps.follow();
            if (first) deps.note(`You are now actively following player ${username}${opts.model ? ', stepping with the Laya follow model' : ''}.`);
            first = false;
            if (!opts.model) {
                await followFor(a, player, distance, PLAIN_FOLLOW_MS, signal);
                return { how: 'more' };
            }
            laya = true;
            return lStep(a, player, opts, signal);
        },
        close() { if (laya) deps.note(summary(counters)); },
    };

    async function lStep(a: Act, player: ActEntity, opts: ReturnType<JobDeps['follow']>, signal: AbortSignal): Promise<StepResult> {
        const model = opts.model!;
        const more: StepResult = { how: 'more' };
        const health = a.bot.health;
        if (lastHealth !== null && health < lastHealth) counters.damage += lastHealth - health;
        lastHealth = health;
        const fallback = async (reason: FollowFallback, e: Omit<FollowLogInput, 'outcome' | 'reason'>) => {
            counters.fallbacks[reason]++;
            log({ ...e, outcome: 'fallback', reason }, opts.log_steps);
            await followFor(a, player, distance, opts.fallback_ms, signal);
            return more;
        };
        const pos = a.bot.entity.position, pp = player.position;
        if (dist3(pos, pp) <= distance) {
            counters.arrivedTicks++;
            waits = 0;
            await pause(opts.step_ms, signal);
            return more;
        }
        const bx = Math.floor(pos.x), bz = Math.floor(pos.z), feetY = Math.floor(pos.y);
        const win = readWindow((x, y, z) => a.bot.blockAt(x, y, z), bx, feetY, bz, Math.floor(pp.x) - bx, Math.floor(pp.z) - bz,
            opts.prompt === 'v2' ? mobColumns(a) : null);
        counters.asked++;
        let r: FollowRead;
        try { r = await race(decideFollowStep(win, model), signal); } catch { return more; }
        if (!r.ok) {
            if (r.why === 'no-answer') return fallback('no-answer', { state: win.state });
            return fallback('low-confidence', { state: win.state, asked: r.asked });
        }
        const entry = { state: win.state, asked: r.asked };
        if (r.move === 'wait') {
            if (++waits > opts.max_waits) { waits = 0; return fallback('wait', entry); }
            log({ ...entry, outcome: 'wait' }, opts.log_steps);
            await pause(opts.step_ms, signal);
            return more;
        }
        waits = 0;
        const grid = parseGrid(win.state);
        const verdict = grid ? check(grid, r.move, win.mobs) : { ok: false as const, reason: 'unknown' as const };
        if (!verdict.ok) {
            counters.vetoes[verdict.reason] = (counters.vetoes[verdict.reason] ?? 0) + 1;
            return fallback('veto', { ...entry, veto: verdict.reason });
        }
        const [dx, dz] = OFFSETS[r.move];
        const start = Date.now();
        const moved = await stepTo(a, bx + dx, bz + dz, opts.stuck_ms, signal);
        if (signal.aborted) return more;
        if (!moved.ok) {
            counters.stuckSeconds += (Date.now() - start) / 1000;
            return fallback('stuck', entry);
        }
        counters.stepped++;
        log({ ...entry, outcome: 'stepped' }, opts.log_steps);
        return more;
    }
}
