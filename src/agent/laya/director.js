// The director: the job stack and the one decision point for what andy does
// next (nextActivity). Pure (no mineflayer), tested with fakes.
//
// It follows the shared director spec v1.2 (Mindcraft decision point ↔
// laya-go director model, games/director): the same state text, the same
// question and answer words and the same rules (and rule names) in the same
// order, so the laya-go director model can replace the rules
// (decision_models.tasks.director) with no code change.
// test/laya_director.test.js checks the request against laya-go's golden
// v1.2_sample_request.json byte for byte and the rules on 1000 of its
// situations. v1.2 adds the Player line (a player near the bot attacked by a
// mob), defend-player and flee-ranged. A served model on prompt v1 (v1.1
// data) is sent the v1 text, without the Player line; it can't see the v1.2
// facts, so where a v1.2 rule decides (defend-player, flee-ranged) that
// rule's answer stands.
//
// The job stack holds the current Laya job (!layaMine, !layaFarm,
// !layaCraft, !layaGather) and, when a safety activity (defend, flee, eat,
// heal, unload, unstuck) takes over, that activity on top of it: the job is
// then Paused. When the activity is done it comes off, Job is none, and the
// rules answer `resume`. A player's new command replaces the top job; "stop"
// clears the stack; a death clears it.
//
// nextActivity(s) is called on events (a mode done, idle, a job ended) and
// about every second. The existing modes stay the executors of defend and
// flee (laya_defending, self_defense, cowardice); the agent executes eat,
// heal, unload and resume (agent.js).

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { ORES } from './mine_state.js';

// ACTIVITIES: the Activity question's answers, in the spec's order.
export const ACTIVITIES = ['continue', 'defend', 'flee', 'eat', 'heal', 'unload', 'resume', 'idle'];

export const QUESTIONS = {
    Activity: { criteria: ACTIVITIES.slice(), instructions: 'What should I do now?', type: 'choice' },
};

export const JOB_KINDS = ['follow', 'come', 'stay', 'mine', 'farm', 'craft', 'gather', 'give', 'attack', 'store', 'home'];

// KIND_OF: a command or action name (without '!' or 'action:') → its job kind.
export const KIND_OF = {
    layaMine: 'mine', layaFarm: 'farm', layaCraft: 'craft', layaGather: 'gather',
    followPlayer: 'follow', goToPlayer: 'come', stay: 'stay', givePlayer: 'give', attack: 'attack',
    putInChest: 'store', setHomeChest: 'home', collectBlocks: 'gather', craftRecipe: 'craft', hunt: 'gather',
};

// SAFETY_MODES: modes that pause the job under them on the stack.
export const SAFETY_MODES = new Set(['laya_defending', 'self_defense', 'cowardice', 'self_preservation', 'unstuck']);

export const NEAREST_KINDS = ['zombie', 'skeleton', 'creeper', 'spider'];
// mobKind: a mob's name as the state's Nearest/By kinds name it (strays and
// bogged are skeletons, v1.2), else other.
export const mobKind = name => (name === 'stray' || name === 'bogged' ? 'skeleton' : NEAREST_KINDS.includes(name) ? name : 'other');
export const PLAYER_REACH = 24; // the Player line's reach (v1.2)
export const RANGED_REACH = 16; // flee-ranged's reach (v1.2)
export const DANGERS = ['none', 'fluid', 'fall', 'drowning', 'fire'];
export const LASTS = ['none', 'done', 'failed', 'interrupted', 'blocked'];

let nextId = 1;

// JobStack: entries ({id, name, kind, item, args, remaining(), state:
// 'running'|'paused', type: 'job'|'activity', startedAt}), bottom first.
export class JobStack {
    constructor(now = () => Date.now()) {
        this.items = [];
        this.now = now;
        this.last = 'none'; // how the last job ended (the state's Last)
    }
    top() { return this.items[this.items.length - 1] || null; }
    // job is the topmost job (not an activity).
    job() { for (let i = this.items.length - 1; i >= 0; i--) if (this.items[i].type === 'job') return this.items[i]; return null; }
    get depth() { return this.items.length; }
    has(e) { return this.items.includes(e); }

    // start puts a new job on top, replacing the top job (a player's new
    // command replaces it); returns it.
    start(name, args = [], extra = {}) {
        this.replaceTop();
        const job = { id: nextId++, name, kind: KIND_OF[name] || null, item: (name === 'hunt' ? args[1] : args[0]) ?? null, args, type: 'job',
            state: 'running', startedAt: this.now(), ...extra };
        this.items.push(job);
        this.last = 'none';
        return job;
    }
    // pause pushes a safety activity over the current job (only when there
    // is one): the job is Paused. Returns the entry or null.
    pause(activity) {
        const job = this.job();
        if (!job) return null;
        this.paused(job);
        const e = { id: nextId++, name: activity, args: [], type: 'activity', state: 'running', startedAt: this.now() };
        this.items.push(e);
        return e;
    }
    // done takes an entry off (an activity finished).
    done(e) {
        const i = this.items.indexOf(e);
        if (i >= 0) this.items.splice(i, 1);
    }
    // ended: a job ended by itself ('done', 'failed', 'blocked').
    ended(job, how) {
        if (!this.has(job)) return;
        this.done(job);
        this.last = how;
    }
    // paused: the job was interrupted; it waits to be resumed.
    paused(job) {
        if (!this.has(job) || job.state === 'paused') return;
        job.state = 'paused';
        job.pausedAt = this.now();
        this.last = 'interrupted';
    }
    resumed(job) { if (this.has(job)) job.state = 'running'; }
    // replaceTop: a player's new command replaces the top job.
    replaceTop() {
        this.items = this.items.filter(e => e.type !== 'activity');
        if (this.top()?.type === 'job') this.items.pop();
    }
    clear() { this.items = []; this.last = 'none'; }

    // running is the job running now ({kind, item, left}) or null; paused
    // the paused job's kind or null.
    running() {
        const j = this.job();
        return j && j.state === 'running' && this.top() === j ? jobView(j) : null;
    }
    pausedKind() {
        const j = this.job();
        return j && j.state === 'paused' ? j.kind : null;
    }
}

// itemWord is a job's item as laya-go's director names it: a mine job's
// ore block (iron → iron_ore), a farm of any crop none.
export function itemWord(kind, item) {
    if (item == null || item === '' || item === 'any') return NONE;
    if (kind === 'mine' && ORES[item]) return ORES[item].blocks[0];
    return String(item).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

// jobView is a job as the Job line shows it.
export function jobView(j) {
    const rem = typeof j.remaining === 'function' ? j.remaining() : null;
    const n = j.args?.[1];
    const left = rem != null ? Math.max(0, rem) : n == null || n === 'any' ? 'any' : Number.isFinite(+n) ? +n : 'any';
    return { kind: j.kind, item: itemWord(j.kind, j.item), left };
}

const NONE = 'none';
const word = v => (v == null || v === '' ? NONE : String(v).replace(/\s+/g, '_'));
const cap = (n, c) => Math.max(0, Math.min(c, Math.round(n)));
// laya-go's caps: MaxLeft 999, MaxValuables 99, MaxFood (food items) 99
const left = l => (l === 'any' ? 'any' : cap(l, 999));

// directorState writes the situation as the spec's state text. s:
//   job {kind, item, left} | null, paused (kind) | null,
//   health, food, armed (none|sword|axe|other), armor 0–20,
//   hostiles, nearest {kind, dist} | null, light 0–15, night, under,
//   free, home (dist) | null, valuables, foodItems, danger, last,
//   player {name, attacked, by, dist} | null (v1.2: the nearest player
//   within 24 a mob hit in the last 5 s, else the nearest within 24)
// prompt 'v1' leaves the Player line out (a model trained on v1.1 data).
export function directorState(s, prompt = 'v1.2') {
    const j = s.job;
    const kind = j?.kind && JOB_KINDS.includes(j.kind) ? j.kind : null;
    const near = s.nearest && s.hostiles > 0 ? `${mobKind(s.nearest.kind)} ${cap(s.nearest.dist, 16)}` : 'none none';
    return ['Director.',
        `Job ${kind || 'none'} ${kind ? word(j.item) : 'none'} left ${kind ? left(j.left) : 0}`,
        `Paused ${JOB_KINDS.includes(s.paused) ? s.paused : 'none'}`,
        `Health ${cap(s.health, 20)} Food ${cap(s.food, 20)} Armed ${s.armed || 'none'} Armor ${cap(s.armor || 0, 20)}`,
        `Hostiles ${cap(s.hostiles, 9)} Nearest ${near}`,
        ...(prompt === 'v1' ? [] : [playerLine(s.player)]),
        `Light ${cap(s.light, 15)} Night ${s.night ? 'yes' : 'no'} Under ${s.under ? 'yes' : 'no'}`,
        `Pack ${cap(s.free, 36)} Home ${s.home == null ? 'none' : cap(s.home, 99)} Valuables ${cap(s.valuables || 0, 99)}`,
        `Food items ${cap(s.foodItems || 0, 99)}`,
        `Danger ${DANGERS.includes(s.danger) ? s.danger : 'none'}`,
        `Last ${LASTS.includes(s.last) ? s.last : 'none'}`,
    ].join('\n');
}

// playerLine is the v1.2 Player line: "Player <name> attacked <yes|no> by
// <kind|none> <dist>", or "Player none attacked no by none none".
export function playerLine(p) {
    if (!p || !p.name || !(p.dist <= PLAYER_REACH)) return 'Player none attacked no by none none';
    const name = String(p.name).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    return `Player ${name} attacked ${p.attacked ? 'yes' : 'no'} by ${p.attacked ? mobKind(p.by) : 'none'} ${cap(p.dist, PLAYER_REACH)}`;
}

// RULES are the rule names, in order (laya-go games/director/rules).
export const RULES = ['flee-danger', 'flee-hostile', 'flee-creeper', 'flee-low', 'flee-ranged', 'defend', 'defend-player', 'heal',
    'eat-hungry', 'unload-full', 'unload-near', 'unload-valuables', 'resume-paused', 'continue', 'resume-failed', 'idle-failed', 'eat-idle', 'idle'];
// V12_RULES decide on facts a prompt v1 model can't see.
export const V12_RULES = new Set(['flee-ranged', 'defend-player']);

// decide is the spec's rules (v1.2), in order: {activity, rule}.
export function decide(s) {
    const within = d => s.hostiles > 0 && !!s.nearest && Math.min(s.nearest.dist, 16) <= d;
    const r = (activity, rule) => ({ activity, rule });
    const job = !!s.job, paused = !!s.paused, home = s.home != null;
    if (s.danger === 'fluid' || s.danger === 'fire' || s.danger === 'drowning') return r('flee', 'flee-danger');
    if (within(4) && (s.health <= 6 || (s.armed === 'none' && s.health <= 10))) return r('flee', 'flee-hostile');
    if (within(3) && s.nearest.kind === 'creeper') return r('flee', 'flee-creeper');
    if (within(8) && s.health <= 6) return r('flee', 'flee-low'); // v1.1
    // v1.2: a skeleton in range, low and nothing to eat: healing in its sight kills
    if (within(RANGED_REACH) && mobKind(s.nearest.kind) === 'skeleton' && s.health <= 6 && !(s.foodItems > 0)) return r('flee', 'flee-ranged');
    if (within(8) && s.health > 6) return r('defend', 'defend');
    // v1.2: a player near is attacked, unless the bot is hungry with food to eat
    if (s.player?.attacked && s.player.dist <= PLAYER_REACH && !(s.food <= 6 && s.foodItems > 0)) return r('defend', 'defend-player');
    if (s.health <= 8 && !within(8)) return r('heal', 'heal');
    if (s.food <= 6 && s.foodItems > 0) return r('eat', 'eat-hungry');
    if (job || paused) { // v1.1: never unload while idle
        if (s.free <= 2 && home) return r('unload', 'unload-full');
        if (s.free <= 6 && home && s.home <= 24) return r('unload', 'unload-near');
        if (s.valuables >= 4 && (s.health <= 8 || s.hostiles >= 2 || s.food <= 6) && home) return r('unload', 'unload-valuables');
    }
    const stuck = s.last === 'failed' || s.last === 'blocked';
    if (!job && paused) return r('resume', 'resume-paused');
    if (job && !stuck) return r('continue', 'continue');
    if (job && paused) return r('resume', 'resume-failed');
    if (job) return r('idle', 'idle-failed'); // a failed job, nothing paused
    // rule 10, nothing to do: eat when not full
    if (s.food < 18 && s.health < 20 && s.foodItems > 0) return r('eat', 'eat-idle');
    return r('idle', 'idle');
}

// nextActivity is the decision point: the director model when deps.client
// and deps.task are given and its answer is confident, else the rules.
// Returns {activity, rule, source, state, p}.
export async function nextActivity(s, deps = {}) {
    const prompt = deps.task?.prompt === 'v1' ? 'v1' : 'v1.2';
    const text = directorState(s, prompt);
    const rule = decide(s);
    if (deps.client && deps.task && !(prompt === 'v1' && V12_RULES.has(rule.rule))) {
        const r = await deps.client.decide('director', text, QUESTIONS).catch(() => null);
        const a = r?.answers?.Activity;
        // an answer that can't be acted on (defend with no hostile near and
        // no player attacked) is the rules' to answer, as the mine task's
        // nonsense answers are
        const nothing = a?.top === 'defend' && !(s.hostiles > 0) && !s.player?.attacked;
        if (a?.confident && ACTIVITIES.includes(a.top) && !nothing)
            return { activity: a.top, rule: rule.rule, source: 'model', state: text, p: a.topProbability, ruleActivity: rule.activity };
        if (nothing) return { ...rule, source: 'rules', state: text, why: 'nothing-to-defend', model: a.top, p: a.topProbability };
    }
    return { ...rule, source: 'rules', state: text };
}

// Situation helpers (pure; the agent feeds them from mineflayer).

const WEAPON = { sword: /_sword$/, axe: /_axe$/, other: /^(trident|bow|crossbow|mace)$/ };
// armedOf: the best weapon kind among item names.
export function armedOf(names) {
    for (const k of ['sword', 'axe', 'other']) if (names.some(n => WEAPON[k].test(n))) return k;
    return 'none';
}

const ARMOR = { leather: [1, 3, 2, 1], golden: [2, 5, 3, 1], chainmail: [2, 5, 4, 1], iron: [2, 6, 5, 2], diamond: [3, 8, 6, 3], netherite: [3, 8, 6, 3] };
const PIECES = ['helmet', 'chestplate', 'leggings', 'boots'];
// armorPoints: the armor bar (0–20) for worn item names.
export function armorPoints(worn) {
    let n = 0;
    for (const name of worn) {
        if (name === 'turtle_helmet') { n += 2; continue; }
        const m = /^(\w+?)_(helmet|chestplate|leggings|boots)$/.exec(name || '');
        if (m && ARMOR[m[1]]) n += ARMOR[m[1]][PIECES.indexOf(m[2])];
    }
    return Math.min(20, n);
}

// dangerOf: the Danger word from what the bot feels: {onFire, inFire,
// oxygen (0–20), headInWater, lavaNear, falling}.
export function dangerOf(f) {
    if (f.onFire || f.inFire) return 'fire';
    if (f.headInWater && f.oxygen != null && f.oxygen < 10) return 'drowning';
    if (f.lavaNear) return 'fluid';
    if (f.falling) return 'fall';
    return 'none';
}

// HARMFUL foods aren't counted or eaten.
export const HARMFUL = new Set(['pufferfish', 'poisonous_potato', 'spider_eye', 'suspicious_stew']);

// logDecision appends one decision to path; never throws.
export function logDecision(path, entry) {
    if (!path) return;
    try {
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
    } catch { /* logging never stops the bot */ }
}

// Director ties it together for the agent. deps:
//   read() → the situation without job, paused and last (the stack's)
//   current() → the running non-Laya action's job view ({kind, item,
//     left}) or null, when no Laya job runs
//   idle() → nothing runs; perform(activity, job) runs eat/heal/unload as
//     the agent's action (the job, if any, is paused under it);
//     resume(job) runs the paused job again; stop(activity) ends the
//     running eat/heal/unload when the director answers something else
//   client/task (the director model, optional), stepLog, now(), warn(err)
//   chore() (optional) → Promise: with chores on, start and run the next
//     chore as a job (laya/chores.js); called when the answer is idle,
//     nothing runs and the stack is empty
//   choresOn() → whether chores are on
// defend with no hostile near the bot but a player attacked (defend-player)
// and flee from a skeleton out of the modes' reach (flee-ranged) are
// performed as activities too (perform('defend'), perform('flee')); other
// defend and flee answers stay the modes'.
export class Director {
    constructor(deps) {
        this.deps = deps;
        this.stack = new JobStack(deps.now);
        this.last = null;
        this.busy = false;
        this.performing = null;
    }

    situation() {
        return { ...this.deps.read(), job: this.stack.running() || this.deps.current?.() || null,
            paused: this.stack.pausedKind(), last: this.stack.last };
    }

    // tick decides once, logs it and acts on it. event: why it was called
    // ('tick', 'idle', 'mode-done', 'job-ended', ...).
    async tick(event = 'tick') {
        if (this.busy) return null;
        this.busy = true;
        try {
            const s = this.situation();
            const d = await nextActivity(s, this.deps);
            const quiet = event === 'tick' && d.activity === 'idle' && this.last?.activity === 'idle';
            if (!quiet) logDecision(this.deps.stepLog, { event, state: d.state, answer: d.activity, rule: d.rule, source: d.source, p: d.p,
                ...(d.why ? { why: d.why, model: d.model } : {}) });
            this.last = d;
            this.act(d.activity, s);
            return d;
        } finally {
            this.busy = false;
        }
    }

    // act runs an answer (not awaited: it runs as the agent's action). s:
    // the situation it was decided on.
    act(activity, s = {}) {
        if (this.performing) {
            // the director answered something else: the running eat, heal
            // or unload ends (a resumed job runs on), and its -done tick
            // acts on the new answer
            if (activity !== this.performing && this.performing !== 'resume' && !this.stopping) {
                this.stopping = true;
                Promise.resolve(this.deps.stop?.(this.performing)).catch(err => this.deps.warn?.(err))
                    .finally(() => { this.stopping = false; });
            }
            return;
        }
        const run = p => {
            this.performing = activity;
            Promise.resolve(p()).catch(err => this.deps.warn?.(err)).finally(() => {
                this.performing = null;
                this.tick(`${activity}-done`).catch(err => this.deps.warn?.(err));
            });
        };
        const near = !!s.nearest && s.hostiles > 0 && Math.min(s.nearest.dist, 16) <= 8;
        const performed = activity === 'eat' || activity === 'heal' || activity === 'unload'
            || (activity === 'defend' && !near && !!s.player?.attacked)
            || (activity === 'flee' && !near && !!s.nearest && mobKind(s.nearest.kind) === 'skeleton');
        if (activity === 'resume') {
            const job = this.stack.job();
            if (job?.state === 'paused' && this.deps.idle()) run(() => this.deps.resume(job));
        } else if (activity === 'idle') {
            if (this.choring || !this.deps.chore || !this.deps.choresOn?.() || this.stack.depth > 0 || !this.deps.idle()) return;
            this.choring = true;
            Promise.resolve().then(() => this.deps.chore()).catch(err => this.deps.warn?.(err))
                .finally(() => { this.choring = false; });
        } else if (performed) {
            const laya = this.stack.running();
            // a non-Laya action (follow, come, ...) isn't stopped for these
            if (!laya && !this.deps.idle()) return;
            run(async () => {
                const e = this.stack.pause(activity);
                try { await this.deps.perform(activity); } finally { if (e) this.stack.done(e); }
            });
        }
        // continue: nothing to do; other defend and flee: the modes act
    }
}
