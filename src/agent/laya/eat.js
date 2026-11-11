// Deciding when and what to eat with a Laya decision model (the "eat" task).
//
// Every check_ms the reflex asks the eat task Eat (noul) and Food (choice).
// When the answers are confident, agree, and pass the safety rules, it eats
// the chosen food. Otherwise it falls back to mineflayer-auto-eat for
// fallback_ms: today's behaviour. With the task on, auto-eat is off except
// during fallbacks.
//
// Actions are passed in (see the laya_eating mode), so this file is tested
// with fakes.

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { FOODS, NONE, situation, state as eatState, questions as eatQuestions } from './eat_state.js';

export const FALLBACK_REASONS = ['no-answer', 'low-confidence', 'disagree', 'veto'];
const DEFAULTS = { check_ms: 2000, fallback_ms: 10000, log_steps: true };

// safety returns null when eating food is allowed in situation s, or the
// reason it isn't: laya-go's safety-critical rules.
export function safety(s, food) {
    if (!s.carry.some(c => c.food === food)) return 'not-carried';
    const f = FOODS[food];
    const emergencyApple = (food === 'golden_apple' && s.health <= 6) || (food === 'enchanted_golden_apple' && s.health <= 6);
    if (emergencyApple) return null;
    if (f.tag === 'rare') return 'rare';
    if (s.danger) return 'danger';
    if (s.food >= 20) return 'full';
    if (f.tag === 'bad' && s.food > 6) return 'bad';
    return null;
}

export class LayaEater {
    // deps: client ({decide}), task (settings), danger() → bool, eat(food) →
    // Promise<bool>, autoEat ({enable, disable}), now() → ms, stepLog (path or
    // null), log(msg)
    constructor(bot, deps) {
        this.bot = bot;
        this.deps = deps;
        this.opts = { ...DEFAULTS, ...(deps.task || {}) };
        this.counters = { asked: 0, ate: {}, fallbacks: Object.fromEntries(FALLBACK_REASONS.map(r => [r, 0])), vetoes: {} };
        this.nextCheck = 0;
        this.fallbackUntil = 0;
        this.busy = false;
        deps.autoEat.disable();
    }

    logStep(entry) {
        if (!this.opts.log_steps || !this.deps.stepLog) return;
        try {
            mkdirSync(dirname(this.deps.stepLog), { recursive: true });
            appendFileSync(this.deps.stepLog, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
        } catch { /* never stops the bot */ }
    }

    fallback(reason, entry) {
        this.counters.fallbacks[reason]++;
        this.fallbackUntil = this.deps.now() + this.opts.fallback_ms;
        this.deps.autoEat.enable();
        this.logStep({ ...entry, outcome: 'fallback', reason });
        return 'fallback';
    }

    // tick runs one decision if one is due, and returns what happened: 'busy',
    // 'wait' (not due), 'fallback', 'veto', 'no-eat' or 'ate'.
    async tick() {
        const now = this.deps.now();
        if (this.busy) return 'busy';
        if (now < this.fallbackUntil) return 'wait';
        if (this.fallbackUntil) { this.fallbackUntil = 0; this.deps.autoEat.disable(); }
        if (now < this.nextCheck) return 'wait';
        this.nextCheck = now + this.opts.check_ms;
        this.busy = true;
        try {
            return await this.decide();
        } finally {
            this.busy = false;
        }
    }

    async decide() {
        const s = situation(this.bot, this.deps.danger());
        const text = eatState(s);
        this.counters.asked++;
        const r = await this.deps.client.decide('eat', text, eatQuestions(s));
        const entry = { state: text };
        if (!r) return this.fallback('no-answer', entry);
        const eatA = r.answers.Eat, foodA = r.answers.Food;
        Object.assign(entry, { eat: eatA.probability, food: foodA.top, p: foodA.topProbability, ms: r.ms });
        if (!eatA.confident || !foodA.confident) return this.fallback('low-confidence', entry);
        const wantsEat = eatA.probability > 0.5;
        if (wantsEat !== (foodA.top !== NONE)) return this.fallback('disagree', entry);
        if (!wantsEat) {
            this.logStep({ ...entry, outcome: 'no-eat' });
            return 'no-eat';
        }
        const why = safety(s, foodA.top);
        if (why) {
            this.counters.vetoes[why] = (this.counters.vetoes[why] || 0) + 1;
            this.fallback('veto', { ...entry, veto: why });
            return 'veto';
        }
        const ok = await this.deps.eat(foodA.top);
        if (ok) this.counters.ate[foodA.top] = (this.counters.ate[foodA.top] || 0) + 1;
        this.logStep({ ...entry, outcome: ok ? 'ate' : 'eat-failed' });
        return ok ? 'ate' : 'eat-failed';
    }

    // stop hands eating back to auto-eat.
    stop() {
        this.deps.autoEat.enable();
    }
}

// summary writes the counters as one line.
export function summary(c) {
    const ate = Object.entries(c.ate).map(([f, n]) => `${f} ${n}`).join(', ') || 'nothing';
    const fb = Object.entries(c.fallbacks).filter(([, n]) => n).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    return `Laya eat: asked ${c.asked}, ate ${ate}; fallbacks: ${fb}; vetoes: ${vetoes}`;
}
