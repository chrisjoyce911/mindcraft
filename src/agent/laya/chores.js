// Chores: what andy does by himself when nobody has given him a job
// (openspec/changes/laya-chores). The director answers idle with no job on
// the stack → the chores model (decision_models.tasks.chores, served name
// "chores") picks the next chore from the chores sensor's state (the rules
// of the chores shared spec v1 when the model isn't served or isn't sure) →
// the chore runs as a job of kind `chore` on the director's job stack → when
// it ends the director answers idle again and the next chore is asked.
//
// A player's command replaces the chore (the job stack's replaceTop); a
// director safety activity or a player being attacked pauses it and the
// director resumes it after. Pure: the agent passes the bot side in.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { nextChore, recentFailed, CHORES } from './chores_state.js';

// CHORE_JOB: each chore's job as the director's Job line shows it (the
// shared director spec's job kinds; a chore has no kind of its own there)
// and its item word.
export const CHORE_JOB = {
    gather_logs: ['gather', 'log'], place_table: ['craft', 'crafting_table'], craft_wood_tools: ['craft', 'wooden_pickaxe'],
    get_seeds: ['gather', 'wheat_seeds'], start_farm: ['farm', 'none'], gather_cobble: ['mine', 'cobblestone'],
    craft_stone_tools: ['craft', 'stone_pickaxe'], place_furnace: ['craft', 'furnace'], hunt_food: ['gather', 'food'],
    cook_food: ['craft', 'cooked_food'], make_torches: ['craft', 'torch'], light_base: ['craft', 'torch'],
    place_chest: ['craft', 'chest'], gather_wool: ['gather', 'wool'], make_beds: ['craft', 'bed'], stock_kit: ['store', 'kit'],
    stock_logs: ['gather', 'log'], stock_cobble: ['mine', 'cobblestone'], craft_sword: ['craft', 'stone_sword'],
    tend_farm: ['farm', 'none'], replant_saplings: ['gather', 'sapling'], unload: ['store', 'none'], sleep: ['stay', 'bed'],
    night_mine: ['mine', 'coal_ore'], rest: ['stay', 'none'],
};

// MAX_ASKS: a model answer the bot can't start is logged as impossible and
// the question asked again with it in Failed, at most this many times.
export const MAX_ASKS = 3;
export const FAIL_WINDOW_MS = 5 * 60_000;

export function logChore(path, entry) {
    if (!path) return;
    try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
    } catch { /* logging never stops the bot */ }
}

// Chores decides the next chore. deps:
//   sense() → Promise<situation> (chores_state.js; failed is filled here)
//   client/task (the chores model, optional), stepLog, now()
export class Chores {
    constructor(deps) {
        this.deps = deps;
        this.failures = []; // [{chore, at}]
        this.counters = { asked: 0, model: 0, rules: 0, impossible: 0 };
    }
    now() { return this.deps.now ? this.deps.now() : Date.now(); }
    failed(chore, why = 'failed') {
        if (!CHORES.includes(chore)) return;
        this.failures.push({ chore, at: this.now() });
        this.failures = this.failures.filter(f => this.now() - f.at <= FAIL_WINDOW_MS);
        logChore(this.deps.stepLog, { event: 'ended', chore, outcome: why });
    }
    ended(chore, how, detail) {
        if (how === 'done') logChore(this.deps.stepLog, { event: 'ended', chore, outcome: 'done', detail });
        else this.failed(chore, detail ? `${how}: ${detail}` : how);
    }

    // next returns {chore, rule, source, state, p} or null (no situation).
    async next() {
        const extra = [];
        for (let i = 0; i < MAX_ASKS; i++) {
            const s = await this.deps.sense();
            if (!s) return null;
            s.failed = recentFailed([...this.failures, ...extra], this.now(), FAIL_WINDOW_MS);
            const d = await nextChore(s, this.deps);
            this.counters.asked++;
            if (d.impossible) {
                // a masked or lately failed chore: logged, never swapped for a
                // rule pick; ask again with it in Failed
                this.counters.impossible++;
                logChore(this.deps.stepLog, { event: 'impossible', state: d.state, answer: d.chore, rule: d.rule, source: d.source, p: d.p });
                extra.push({ chore: d.chore, at: this.now() });
                continue;
            }
            this.counters[d.source]++;
            logChore(this.deps.stepLog, { event: 'ask', state: d.state, answer: d.chore, rule: d.rule, source: d.source, p: d.p,
                ruleAnswer: d.ruleChore });
            return d;
        }
        logChore(this.deps.stepLog, { event: 'gave-up', answer: 'rest' });
        return { chore: 'rest', rule: 'rest', source: 'rules', state: null };
    }
}

// The chores setting and its saved state (bots/<name>/laya-chores.json):
// {on, centreKind, chestItems, chestAt, stumps} (stumps: where a felled tree's
// sapling still goes). settingOn is the settings default.
export function loadChoresState(path, settingOn) {
    try {
        const j = JSON.parse(readFileSync(path, 'utf8'));
        return { on: typeof j.on === 'boolean' ? j.on : !!settingOn, centreKind: j.centreKind || null,
            chestItems: Array.isArray(j.chestItems) ? j.chestItems : [], chestAt: j.chestAt || null,
            stumps: Array.isArray(j.stumps) ? j.stumps : [] };
    } catch {
        return { on: !!settingOn, centreKind: null, chestItems: [], chestAt: null, stumps: [] };
    }
}

export function saveChoresState(path, st) {
    try {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, JSON.stringify(st));
    } catch { /* never stops the bot */ }
}

// parseOnOff: !layaChores's argument.
export function parseOnOff(v) {
    const w = String(v ?? '').trim().toLowerCase().replace(/^["']|["']$/g, '');
    if (['on', 'true', 'yes', '1', 'start'].includes(w)) return true;
    if (['off', 'false', 'no', '0', 'stop'].includes(w)) return false;
    return null;
}
