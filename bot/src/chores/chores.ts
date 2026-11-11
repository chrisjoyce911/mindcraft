// Chores v2 (5.6; skills-spec v1 §1, §7; design §11): when andy is idle with chores on, which run comes next. next()
// senses the situation, rebuilds Last from laya-chores.jsonl's run lines, decides (models/chores decideChores: the
// chores model only when its task is on and the served chores prompt is v2, else rules v2), logs the ask and returns
// the job to start; ended() writes the run line. The on/off setting and the home chest's items are kept in
// bots/<name>/laya-chores.json (home/chores.ts); every home-chest open refreshes the items (chestSeen).
//
// Chores v1.1 stays in the old bot (src/agent/laya/chores*.js) until v2 is served: a v1.1 model served under the
// name chores is never sent a v2 state (why 'not-v2', rules v2 decide).
import type { JobEnd, JobSpec, Vec3Like } from '../types/index.js';
import type { ModelDecider } from '../types/models.js';
import type { ChoreReason, LastRun } from '../types/chores.js';
import type { Act, ActItem } from '../actuators/bot.js';
import { loadChoresState, saveChoresState, type ChoresState } from '../home/chores.js';
import { HOME_PLACE } from '../home/chest.js';
import { homeOnPlace } from '../home/centre.js';
import type { ChoresAskLine, ChoresRunLine } from '../log/jsonl.js';
import {
    CHORES_MIN_CONFIDENCE, choresGoal, choresRules, choresState, decideChores, readChores,
    type ChoresAnswer, type ChoresDecision, type ChoresGoal,
} from '../models/chores/index.js';
import { choreJob, choreLabel } from './map.js';
import { choreReason } from './reasons.js';
import { lastFromFile } from './runs.js';
import { senseChores, type SenseDeps } from './sense.js';

/** decision_models.tasks.chores (settings.js): enabled (and served at v2) asks the model. */
export interface ChoresSettings {
    enabled: boolean;
    min_confidence: number;
    can_place: boolean;
    can_smelt: boolean;
    log_steps: boolean;
}
export const CHORES_DEFAULTS: ChoresSettings = { enabled: false, min_confidence: CHORES_MIN_CONFIDENCE, can_place: true, can_smelt: true, log_steps: true };

/** choresOf: the chores task's settings (missing keys: the defaults). */
export function choresOf(settings: Record<string, unknown>): ChoresSettings {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    const t = dm?.tasks?.chores ?? {};
    const mc = t.min_confidence;
    return {
        enabled: t.enabled === true,
        min_confidence: typeof mc === 'number' && Number.isFinite(mc) && mc >= 0 ? mc : CHORES_DEFAULTS.min_confidence,
        can_place: t.can_place !== false, can_smelt: t.can_smelt !== false, log_steps: t.log_steps !== false,
    };
}

/** The prompt version the chores model must be served at to be asked. */
export const CHORES_PROMPT = 'v2';

export interface ChoresDeps {
    /** bots/<name>/laya-chores.json (on, centreKind, chestItems, chestAt, stumps). */
    stateFile: string;
    /** bots/<name>/logs/laya-chores.jsonl (the ask and run lines). */
    runsFile: string;
    /** settings.chores (on when the state file doesn't say). */
    settingOn: boolean;
    settings(): ChoresSettings;
    /** The chores model client when the task is on, else null. */
    client(): ModelDecider | null;
    /** The served chores prompt version (golaya's prompt_version), or undefined. */
    served(): string | undefined;
    act(): Act | null;
    sense: Omit<SenseDeps, 'state' | 'save' | 'canPlace' | 'canSmelt'>;
    /** Whether a job's kind has a runner (makeRunner probe). */
    canRun(spec: JobSpec): boolean;
    /** Writes a laya-chores.jsonl line. */
    log(line: ChoresAskLine | ChoresRunLine): void;
    note(text: string): void;
    now?: () => number;
}

/** A run chosen by next(): its answer, the job, its lease label, the ask's source. */
export interface ChoreRun { answer: ChoresAnswer; goal: ChoresGoal | null; spec: JobSpec; label: string; source: 'model' | 'rules'; startedAt: number }

/** A felled tree's stump is remembered this long (the old STUMP_MS), at most MAX_STUMPS. */
export const STUMP_MS = 20 * 60_000;
export const MAX_STUMPS = 32;

/** The rest a broken ask falls back to (a throw while sensing never stops the bot). */
export const FALLBACK_REST: JobSpec = { kind: 'rest', seconds: 20 };

export class Chores {
    state: ChoresState;
    /** The centre the last run was chosen from. */
    centre: Vec3Like | null = null;
    private readonly now: () => number;

    constructor(private readonly d: ChoresDeps) {
        this.now = d.now ?? Date.now;
        this.state = loadChoresState(d.stateFile, d.settingOn);
    }

    get on(): boolean { return this.state.on; }

    /** reload: the state from the file again (the harness's start-agent after a world reset wrote {"on":false}). */
    reload(): void { this.state = loadChoresState(this.d.stateFile, this.d.settingOn); }

    /** setOn: chores on or off, saved at once. */
    setOn(on: boolean): void {
        this.state.on = on;
        this.save();
    }

    save(): void { saveChoresState(this.d.stateFile, this.state, e => this.d.note(`saving the chores state failed: ${String(e)}`)); }

    /** last: the Last line now, rebuilt from the run lines (at start and on every ask). */
    last(): LastRun[] { return lastFromFile(this.d.runsFile, this.now()); }

    /** stump: a felled tree's base, kept STUMP_MS in the state's stumps (the old plantStumps' window). */
    stump(p: Vec3Like): void {
        const t = this.now();
        const key = (s: Vec3Like) => `${Math.floor(s.x)},${Math.floor(s.y)},${Math.floor(s.z)}`;
        this.state.stumps = [...this.state.stumps.filter(s => key(s) !== key(p) && t - (s.at ?? 0) < STUMP_MS), { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z), at: t }].slice(-MAX_STUMPS);
        this.save();
    }

    /**
     * placed: the place skill put a station: a bed, table or chest may become home (home/centre homeOnPlace); the
     * centre is the one the run was chosen from.
     */
    placed(item: string, at: Vec3Like, by: 'me' | 'player' = 'me'): void {
        const kind = item === 'bed' || item.endsWith('_bed') ? 'bed' : item === 'crafting_table' ? 'table' : item === 'chest' ? 'chest' : null;
        if (!kind) return;
        const pl = this.d.sense.places;
        const r = (n: string) => pl.recall(n);
        const ch = r('chores_centre');
        const centre = this.centre ?? (ch ? { x: ch[0], y: ch[1], z: ch[2] } : null);
        for (const sv of homeOnPlace(kind, at, by, { homeBed: r('home_bed'), playerBed: r('player_bed'), homeChest: r(HOME_PLACE), homeTable: r('home_table'), centre })) {
            if (sv.pos) pl.remember(sv.place, sv.pos); else pl.forget(sv.place);
            if (sv.say) this.d.sense.say(sv.say);
        }
    }

    /** chestSeen: a chest was opened; when it is the home chest its items are the Chest line's from now on. */
    chestSeen(at: Vec3Like, items: readonly ActItem[], home: readonly [number, number, number] | null): void {
        if (!home || Math.floor(home[0]) !== at.x || Math.floor(home[1]) !== at.y || Math.floor(home[2]) !== at.z) return;
        this.state.chestItems = items.map(i => ({ name: i.name, count: i.count }));
        this.state.chestAt = { x: at.x, y: at.y, z: at.z };
        this.save();
    }

    /** modelFor: the client to ask, or null with why ('rules': the task is off; 'not-v2': not served at v2). */
    private modelFor(): { client: ModelDecider | null; why?: 'not-v2' } {
        const client = this.d.client();
        if (!client) return { client: null };
        const served = this.d.served();
        return served === CHORES_PROMPT ? { client } : { client: null, why: 'not-v2' };
    }

    /**
     * next: the run to start now, or null when not in game. A model answer that can't start (no runner) is logged
     * impossible and written as a failed run (so its cooldown applies), then the rules decide.
     */
    async next(): Promise<ChoreRun | null> {
        const a = this.d.act();
        if (!a) return null;
        const set = this.d.settings();
        let sensed;
        try {
            sensed = senseChores(a, {
                ...this.d.sense, state: () => this.state, save: () => this.save(), canPlace: set.can_place, canSmelt: set.can_smelt,
            }, this.last());
            choresState(sensed.situation); // refuses a state outside the spec here, not in the decision
        } catch (e) {
            this.d.note(`chores: sensing failed (${e instanceof Error ? e.message : String(e)}); resting`);
            return { answer: { skill: 'rest', target: 'none' }, goal: null, spec: FALLBACK_REST, label: 'rest_none', source: 'rules', startedAt: this.now() };
        }
        const s = sensed.situation;
        this.centre = sensed.centre;
        const m = this.modelFor();
        let d: ChoresDecision = await decideChores(s, m.client, set.min_confidence);
        const rules = choresRules(s);
        const ruleWords = `${rules.words.Skill} ${rules.words.Target}`;
        // why the rules decided: the task off ('rules') or not served at v2 ('not-v2')
        const why = (x: ChoresDecision) => (x.why === 'rules' && m.why ? m.why : x.why);
        let goal = choresGoal(s, d.step, rules);
        let spec = choreJob(d.step, goal);
        if (d.source === 'model' && !this.d.canRun(spec)) {
            this.logAsk('impossible', d, why(d), ruleWords, goal, 'no runner');
            this.writeRun(d.step, { how: 'failed', reason: 'stuck' }, 0);
            const r = readChores(rules.words)!;
            d = { ...d, step: r, words: rules.words, source: 'rules', why: 'veto' };
            goal = choresGoal(s, r, rules);
            spec = choreJob(r, goal);
        }
        this.logAsk('ask', d, why(d), ruleWords, goal);
        return { answer: d.step, goal, spec, label: choreLabel(d.step), source: d.source, startedAt: this.now() };
    }

    private logAsk(event: 'ask' | 'impossible', d: ChoresDecision, why: string | undefined, ruleAnswer: string, goal: ChoresGoal, reason?: string): void {
        const r = `${d.words.Skill ?? ''} ${d.words.Target ?? ''}`;
        this.d.log({
            event, state: d.state, answer: r, skill: d.step.skill, target: d.step.target,
            rule: d.rule, ruleAnswer, source: d.source, ...(why ? { why } : {}),
            ...(d.asked ? { model: Object.values(d.asked.words).join(' '), p: d.asked.p, ms: d.asked.ms } : {}),
            goal, ...(reason ? { reason } : {}),
        });
        this.d.note(`chores: ${event} → ${r} (${d.source} ${d.rule}${why ? `, ${why}` : ''})`);
    }

    /** ended: the run ended: its run line (Last's source). */
    ended(run: ChoreRun, end: JobEnd): ChoreReason | null {
        const reason = choreReason(end);
        this.writeRun(run.answer, end, (this.now() - run.startedAt) / 60_000);
        this.d.note(`chores: ${run.label} ${reason ? `failed:${reason}` : 'done'}`);
        return reason;
    }

    private writeRun(a: ChoresAnswer, end: JobEnd, minutes: number): void {
        const reason = choreReason(end);
        const detail = 'reason' in end && end.reason !== reason ? end.reason : undefined;
        this.d.log({
            event: 'run', skill: a.skill, target: a.target, result: reason ? 'failed' : 'done', ...(reason ? { reason } : {}),
            minutes: Math.round(minutes * 100) / 100, ...(detail ? { detail: detail.slice(0, 200) } : {}),
        });
    }

    /** homeChestPlace: the saved home chest (for chestSeen). */
    static homeOf(places: { recall(n: string): [number, number, number] | null }) { return places.recall(HOME_PLACE); }
}
