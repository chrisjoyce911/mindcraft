// Fighting and defending with a Laya decision model (the "defend" task).
//
// While hostile mobs are active, an engagement asks the defend task Action,
// Target, Weapon and Danger every step_ms and carries out the answer: fight
// (melee, or a bow), close in behind a shield, back off (shooting when the
// weapon is a bow), flee with the pathfinder, eat a golden apple, or ignore.
// The safety rules below refuse answers that would get the bot hurt; then, or
// with no confident answer, the ordinary self_defense, cowardice and
// self_preservation modes take over for fallback_ms.
//
// Actions are passed in (see defend_actions.js and the laya_defending mode),
// so this file is tested with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { NONE, KINDS, WEAPONS, state as defendState, questions as defendQuestions, active, dist } from './defend_state.js';

export const FALLBACK_REASONS = ['no-answer', 'low-confidence', 'veto'];
const DEFAULTS = { step_ms: 400, fallback_ms: 8000, quiet_ms: 3000, max_engage_ms: 60000, log_steps: true };

const REACH = 3, CREEPER_CLOSE = 4;

// safety checks an answer ({action, target, weapon}) against laya-go's
// safety-critical defend rules. It returns {ok: true, answer} (possibly with
// a safer answer: fleeing from a close creeper instead of fighting it), or
// {ok: false, reason}.
export function safety(s, a) {
    const target = a.target === NONE ? -1 : s.mobs.findIndex((m, i) => `${m.kind} ${i + 1}` === a.target);
    const weapon = a.weapon === NONE || !s.weapons.includes(a.weapon) ? NONE : a.weapon;
    const answer = { ...a, weapon, targetIndex: target };
    const meleeThreat = s.mobs.some(m => active(s, m) && !KINDS[m.kind].ranged && dist(m) <= REACH);
    switch (a.action) {
        case 'ignore':
            if (meleeThreat) return { ok: false, reason: 'ignore-threat' };
            return { ok: true, answer };
        case 'eat':
            if (s.apples < 1) return { ok: false, reason: 'no-apple' };
            return { ok: true, answer };
        case 'fight':
        case 'shield':
        case 'backoff':
        case 'flee':
            break;
        default:
            return { ok: false, reason: 'unknown-action' };
    }
    if (target < 0) return { ok: false, reason: 'no-target' };
    if (weapon === 'bow' && s.arrows < 1) return { ok: false, reason: 'no-arrows' };
    const m = s.mobs[target];
    if ((a.action === 'fight' || a.action === 'shield') && m.kind === 'creeper' && dist(m) <= CREEPER_CLOSE && weapon !== 'bow') {
        const alone = s.mobs.filter(x => active(s, x)).length === 1;
        const best = Math.max(4, ...s.weapons.map(w => WEAPONS[w] || 0));
        if (!(alone && s.health >= 14 && s.armor >= 15 && best >= 9.6)) {
            return { ok: true, answer: { ...answer, action: 'flee', weapon: NONE }, overridden: 'creeper' };
        }
    }
    return { ok: true, answer };
}

export class LayaDefender {
    // deps: client ({decide}), task (settings), read() → {situation, entities}
    // (entities[i] is the mob entity of situation.mobs[i]), act ({fight,
    // shield, backoff, flee: (entity, weapon) → Promise, eat: () → Promise}),
    // interrupted() → bool, sleep(ms), now() → ms, stepLog (path or null)
    constructor(deps) {
        this.deps = deps;
        this.opts = { ...DEFAULTS, ...(deps.task || {}) };
        this.counters = { asked: 0, engagements: 0, acted: {}, overrides: 0, fallbacks: Object.fromEntries(FALLBACK_REASONS.map(r => [r, 0])), vetoes: {} };
        this.fallbackUntil = 0;
        this.quietUntil = 0;
    }

    logStep(entry) {
        if (!this.opts.log_steps || !this.deps.stepLog) return;
        try {
            mkdirSync(dirname(this.deps.stepLog), { recursive: true });
            appendFileSync(this.deps.stepLog, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
        } catch { /* never stops the bot */ }
    }

    // inControl reports whether the model decides defence now: false during a
    // fallback, when the ordinary modes do.
    inControl() { return this.deps.now() >= this.fallbackUntil; }

    // wantsToEngage reports whether an engagement should start: some mob is
    // active, and neither a fallback nor a quiet spell after "ignore" is on.
    wantsToEngage() {
        const now = this.deps.now();
        if (now < this.fallbackUntil || now < this.quietUntil) return false;
        const { situation: s } = this.deps.read();
        return s.mobs.some(m => active(s, m));
    }

    fallback(reason, entry) {
        this.counters.fallbacks[reason]++;
        this.fallbackUntil = this.deps.now() + this.opts.fallback_ms;
        this.logStep({ ...entry, outcome: 'fallback', reason });
        return 'fallback';
    }

    // step reads the world, asks once and acts. It returns 'calm', 'ignore',
    // 'fallback' or the action taken.
    async step() {
        const { situation: s, entities } = this.deps.read();
        if (!s.mobs.some(m => active(s, m))) return 'calm';
        const text = defendState(s);
        this.counters.asked++;
        const r = await this.deps.client.decide('defend', text, defendQuestions(s));
        const entry = { state: text };
        if (!r) return this.fallback('no-answer', entry);
        const A = r.answers;
        const a = { action: A.Action.top, target: A.Target.top, weapon: A.Weapon.top };
        Object.assign(entry, a, { p: A.Action.topProbability, danger: A.Danger.probability, ms: r.ms });
        if (!A.Action.confident || !A.Target.confident) return this.fallback('low-confidence', entry);
        const verdict = safety(s, a);
        if (!verdict.ok) {
            this.counters.vetoes[verdict.reason] = (this.counters.vetoes[verdict.reason] || 0) + 1;
            this.fallback('veto', { ...entry, veto: verdict.reason });
            return 'fallback';
        }
        const ans = verdict.answer;
        if (verdict.overridden) {
            this.counters.overrides++;
            entry.override = verdict.overridden;
        }
        this.counters.acted[ans.action] = (this.counters.acted[ans.action] || 0) + 1;
        this.logStep({ ...entry, outcome: ans.action });
        if (ans.action === 'ignore') {
            this.quietUntil = this.deps.now() + this.opts.quiet_ms;
            return 'ignore';
        }
        if (ans.action === 'eat') {
            await this.deps.act.eat();
            return 'eat';
        }
        await this.deps.act[ans.action](entities[ans.targetIndex], ans.weapon);
        return ans.action;
    }

    // engage runs steps until the mobs are calm, the model says ignore, a
    // fallback starts, the action is interrupted or max_engage_ms passes.
    async engage() {
        this.counters.engagements++;
        const end = this.deps.now() + this.opts.max_engage_ms;
        while (!this.deps.interrupted() && this.deps.now() < end) {
            const out = await this.step();
            if (out === 'calm' || out === 'ignore' || out === 'fallback') return out;
            await this.deps.sleep(this.opts.step_ms);
        }
        return 'stopped';
    }
}

// summary writes the counters as one line.
export function summary(c) {
    const acted = Object.entries(c.acted).map(([a, n]) => `${a} ${n}`).join(', ') || 'nothing';
    const fb = Object.entries(c.fallbacks).filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    return `Laya defend: ${c.engagements} engagements, asked ${c.asked}, acted ${acted}; creeper overrides ${c.overrides}; fallbacks: ${fb}; vetoes: ${vetoes}`;
}
