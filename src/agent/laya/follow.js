// Following a player with a Laya decision model (the "follow" task).
//
// Each step: read the 9×9 window around the bot (follow_state.js), ask the
// follow task for Move and Hazard (laya-client), and take the top move one
// block with the pathfinder, unless the safety veto (veto.js) refuses it. Fall
// back to the ordinary pathfinder follow for a few seconds when there is no
// answer, the answer isn't confident, the model keeps saying wait while the
// bot hasn't arrived, the veto refuses, or a step doesn't move the bot.
//
// Pathfinder actions are passed in (see skills.followPlayer), so this file
// needs no mineflayer import and is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { readWindow, parseGrid, OFFSETS, QUESTIONS } from './follow_state.js';
import { check } from './veto.js';

export const FALLBACK_REASONS = ['no-answer', 'low-confidence', 'wait', 'veto', 'stuck'];

const DEFAULTS = { step_ms: 250, fallback_ms: 4000, log_steps: true, stuck_ms: 1500, max_waits: 2 };

// newCounters returns a session's counters.
export function newCounters() {
    return {
        asked: 0, stepped: 0, arrivedTicks: 0, vetoes: {}, damage: 0, stuckSeconds: 0,
        fallbacks: Object.fromEntries(FALLBACK_REASONS.map(r => [r, 0])),
    };
}

// summary writes a session's counters as one line.
export function summary(c) {
    const fb = Object.entries(c.fallbacks).filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    return `Laya follow: asked ${c.asked}, stepped ${c.stepped}, fallbacks: ${fb}; vetoes: ${vetoes}; damage ${c.damage}, stuck ${c.stuckSeconds.toFixed(1)} s`;
}

// followWithLaya follows the player called username until bot.interrupt_code
// is set. deps:
//   client     laya-client ({decide})
//   task       the follow task's settings (step_ms, fallback_ms, log_steps)
//   stepTo(x, y, z, ms)       → moved? : walk to the block, giving up after ms
//   fallback(entity, dist, ms): pathfinder follow for ms
//   sleep(ms), log(msg), stepLog (file path, or null)
export async function followWithLaya(bot, username, distance, deps) {
    const opts = { ...DEFAULTS, ...(deps.task || {}) };
    const counters = newCounters();
    const player = bot.players[username]?.entity;
    if (!player) return { found: false, counters };
    let waits = 0;
    let lastHealth = bot.health;

    const logStep = (entry) => {
        if (!opts.log_steps || !deps.stepLog) return;
        try {
            mkdirSync(dirname(deps.stepLog), { recursive: true });
            appendFileSync(deps.stepLog, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
        } catch { /* a step log failure never stops following */ }
    };
    const fallback = async (reason, entry) => {
        counters.fallbacks[reason]++;
        logStep({ ...entry, outcome: 'fallback', reason });
        await deps.fallback(player, distance, opts.fallback_ms);
    };

    while (!bot.interrupt_code) {
        if (bot.health < lastHealth) counters.damage += lastHealth - bot.health;
        lastHealth = bot.health;
        const pos = bot.entity.position, pp = player.position;
        if (pos.distanceTo ? pos.distanceTo(pp) <= distance : Math.hypot(pp.x - pos.x, pp.z - pos.z) <= distance) {
            counters.arrivedTicks++;
            waits = 0;
            await deps.sleep(opts.step_ms);
            continue;
        }
        const bx = Math.floor(pos.x), bz = Math.floor(pos.z), feetY = Math.floor(pos.y);
        const win = readWindow(deps.blockAt, bx, feetY, bz, Math.floor(pp.x) - bx, Math.floor(pp.z) - bz);
        counters.asked++;
        const r = await deps.client.decide('follow', win.state, QUESTIONS);
        const entry = { state: win.state };
        if (!r) { await fallback('no-answer', entry); continue; }
        const move = r.answers.Move.top;
        Object.assign(entry, { move, p: r.answers.Move.topProbability, hazard: r.answers.Hazard.probability, ms: r.ms });
        if (!r.answers.Move.confident) { await fallback('low-confidence', entry); continue; }
        if (move === 'wait') {
            if (++waits > opts.max_waits) { waits = 0; await fallback('wait', entry); continue; }
            logStep({ ...entry, outcome: 'wait' });
            await deps.sleep(opts.step_ms);
            continue;
        }
        waits = 0;
        const verdict = check(parseGrid(win.state), move);
        if (!verdict.ok) {
            counters.vetoes[verdict.reason] = (counters.vetoes[verdict.reason] || 0) + 1;
            await fallback('veto', { ...entry, veto: verdict.reason });
            continue;
        }
        const [dx, dz] = OFFSETS[move];
        const target = win.columns[4 + dz][4 + dx];
        const start = Date.now();
        const moved = await deps.stepTo(bx + dx, target.height + 1, bz + dz, opts.stuck_ms);
        if (!moved) {
            counters.stuckSeconds += (Date.now() - start) / 1000;
            await fallback('stuck', entry);
            continue;
        }
        counters.stepped++;
        logStep({ ...entry, outcome: 'stepped' });
    }
    deps.log?.(summary(counters));
    return { found: true, counters };
}
