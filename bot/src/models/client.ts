// Client for Laya decision models (design §6): a typed port of the old bot's src/models/laya.js.
// Small local models answer typed questions (choice, score, noul) with probabilities. Which model
// answers a kind of decision (a "task", such as "director") is set in settings.decision_models, so
// swapping a model is a settings change. golaya serve (laya-go) and MLX-Serve speak the same API:
// GET /v1/models and POST /v1/decisions.
//
// decide() never throws: on any failure it returns null and counts the reason, and the caller falls
// back to the task's rules. Callers (the director, 3.4) must not block the tick on an answer.
//
// Differences from the old client, on purpose: no module-level state and nothing runs at import (the
// served-prompt cache lives in the client); timeouts are sized from measured latency (below); errors
// carry a typed reason.

import {
    MODEL_FAIL_REASONS,
    type CheckReport, type DecideResult, type DecisionModelsConfig, type DecisionSample, type ModelFailReason,
    type NormalAnswer, type Question, type Questions, type ServerConfig, type TaskConfig, type TaskStats,
} from '../types/models.js';

// Timeouts, measured against golaya serve (127.0.0.1:11235) on 2026-11-12, 15 requests per model
// with the sample requests, training idle:
//
//   model     min     p50     max
//   eat       36 ms   49 ms   115 ms
//   director  60 ms   100 ms  136 ms
//   defend    95 ms   120 ms  186 ms
//   craft     116 ms  185 ms  224 ms
//   command   255 ms  300 ms  346 ms
//   mine      294 ms  346 ms  417 ms
//
// While the Studio trains, answers take 2-4 s. The old 300 ms setting dropped every command and mine
// answer even with training idle. So: 5 s when a task sets none, and a task's timeout_ms below 2.5 s
// (settings.js still says 300) is raised to 2.5 s and logged once per task.
/** Per-request timeout when a task sets no timeout_ms. */
export const DEFAULT_TIMEOUT_MS = 5_000;
/** A task's timeout_ms below this is raised to it (a client option, so tests can lower it). */
export const MIN_TIMEOUT_MS = 2_500;
/** GET /v1/models (discovery, check) waits at least this long. */
export const MODELS_TIMEOUT_MS = 2_000;
/** check()'s sample decision waits at least this long: a first request may load the model. */
export const CHECK_SAMPLE_TIMEOUT_MS = 30_000;

// An unreachable server (connection refused, "fetch failed": a golaya restart or blip) is retried
// once at once; if it is still unreachable it isn't asked again for a back-off that doubles from
// BACKOFF_MIN_MS to BACKOFF_MAX_MS, so the callers fall back without waiting each time. Entering and
// leaving back-off is logged.
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 10_000;
/** A task's failure reason is logged at most once per this long. */
export const LOG_EVERY_MS = 60_000;
/** golaya serve's prompt versions (GET /v1/models prompt_version) are read again after this long. */
export const SERVED_TTL_MS = 10_000;

/** The failure reasons decide() counts. */
export const REASONS = MODEL_FAIL_REASONS;

export class ModelError extends Error {
    constructor(readonly reason: ModelFailReason, message: string) {
        super(message);
        this.name = 'ModelError';
    }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const norm = (url: string): string => url.replace(/\/+$/, '');

/** normalize turns one server answer into the normal form, or null if it doesn't match the question it answers. */
export function normalize(question: Question, raw: unknown, minConfidence: number): NormalAnswer | null {
    if (!isRecord(raw) || raw.type !== question.type) return null;
    if (question.type === 'noul') {
        const p = typeof raw.noul === 'number' ? raw.noul : isRecord(raw.probabilities) ? raw.probabilities.true : undefined;
        if (typeof p !== 'number') return null;
        const top = p > 0.5 ? 'true' : 'false';
        const topProbability = p > 0.5 ? p : 1 - p;
        return { type: 'noul', probability: p, top, topProbability, confident: topProbability >= minConfidence };
    }
    const probs = raw.probabilities;
    if (!isRecord(probs)) return null;
    const c = question.criteria;
    const order: readonly string[] = Array.isArray(c) ? c : Object.keys(c ?? {});
    let top: string | null = null, topProbability = -1;
    const probabilities: Record<string, number> = {};
    for (const [k, v] of Object.entries(probs)) if (typeof v === 'number') probabilities[k] = v;
    for (const option of order) {
        const p = probs[option];
        if (typeof p !== 'number') return null;
        if (p > topProbability) { top = option; topProbability = p; }
    }
    if (top === null) return null;
    return { type: question.type, top, topProbability, probabilities, confident: topProbability >= minConfidence };
}

/** decisionModels reads settings.decision_models into the typed config, dropping malformed entries. */
export function decisionModels(settings: Record<string, unknown> | undefined): DecisionModelsConfig | undefined {
    const dm = settings?.decision_models;
    if (!isRecord(dm)) return undefined;
    const servers: Record<string, ServerConfig> = {};
    if (isRecord(dm.servers)) {
        for (const [name, s] of Object.entries(dm.servers)) if (isRecord(s) && typeof s.url === 'string') servers[name] = { url: s.url };
    }
    const tasks: Record<string, TaskConfig> = {};
    if (isRecord(dm.tasks)) {
        for (const [name, t] of Object.entries(dm.tasks)) {
            if (!isRecord(t) || typeof t.server !== 'string') continue;
            const task: TaskConfig = { enabled: t.enabled === true, server: t.server };
            if (typeof t.model === 'string') task.model = t.model;
            if (typeof t.prompt === 'string') task.prompt = t.prompt;
            if (typeof t.timeout_ms === 'number' && t.timeout_ms > 0) task.timeout_ms = t.timeout_ms;
            if (typeof t.min_confidence === 'number') task.min_confidence = t.min_confidence;
            tasks[name] = task;
        }
    }
    return { servers, tasks };
}

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

export interface LayaClientOptions {
    /** The decision_models settings, read on every call so changes take effect at once. */
    getConfig: () => DecisionModelsConfig | undefined;
    log?: (line: string) => void;
    now?: () => number;
    fetch?: FetchFn;
    /** Floor for a task's timeout_ms (default MIN_TIMEOUT_MS). */
    minTimeoutMs?: number;
}

interface ResolvedTask extends TaskConfig { url: string; timeoutMs: number; minConfidence: number }
interface Counters { asked: number; answered: number; failed: Record<ModelFailReason, number>; totalMs: number; maxMs: number }
interface Served { at: number; prompts: Map<string, string>; pending: Promise<void> | null }

export class LayaClient {
    private readonly getConfig: () => DecisionModelsConfig | undefined;
    private readonly log: (line: string) => void;
    private readonly now: () => number;
    private readonly fetchFn: FetchFn;
    private readonly minTimeoutMs: number;
    private readonly counters = new Map<string, Counters>();
    private readonly backoff = new Map<string, { until: number; ms: number }>(); // server url → back-off
    private readonly discovered = new Map<string, string | ModelError>(); // server url → model id or why not
    private readonly lastLog = new Map<string, number>();
    private readonly raisedLogged = new Set<string>();
    private readonly served = new Map<string, Served>(); // server url → prompt versions

    constructor(opts: LayaClientOptions) {
        this.getConfig = opts.getConfig;
        this.log = opts.log ?? (line => console.warn(line));
        this.now = opts.now ?? Date.now;
        this.fetchFn = opts.fetch ?? ((url, init) => fetch(url, init));
        this.minTimeoutMs = opts.minTimeoutMs ?? MIN_TIMEOUT_MS;
    }

    // ---- decisions ----

    /** decide asks a task's model the questions about state: every answer in the normal form, or null. */
    async decide(task: string, state: string, questions: Questions): Promise<DecideResult | null> {
        const t = this.taskConfig(task);
        if (!t || !t.enabled) return this.fail(task, 'disabled');
        const st = this.statsFor(task);
        st.asked++;
        const start = Date.now();
        const off = this.backoff.get(t.url);
        if (off && this.now() < off.until) {
            return this.fail(task, 'unreachable', `backing off ${Math.ceil((off.until - this.now()) / 1000)} s`);
        }
        try {
            const model = await this.modelFor(t);
            const body = JSON.stringify({ model, questions, state });
            // golaya serve names the prompt version the model expects: a swapped model's version is
            // used from the next decision on.
            const seen = (resp: Response): void => {
                const p = resp.headers.get('x-laya-prompt-version');
                if (p) this.noteServedPrompt(t.url, model, p);
            };
            const post = () => this.fetchJSON(t.url + '/v1/decisions', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body,
            }, t.timeoutMs, seen);
            let reply: unknown;
            try {
                reply = await post();
            } catch (err) {
                if (!(err instanceof ModelError) || err.reason !== 'unreachable') throw err;
                reply = await post(); // once more: most blips are over at once
            }
            if (off) {
                this.backoff.delete(t.url);
                this.log(`[laya] ${t.url}: reachable again`);
            }
            const replyAnswers = isRecord(reply) && isRecord(reply.answers) ? reply.answers : {};
            const answers: Record<string, NormalAnswer> = {};
            for (const [name, q] of Object.entries(questions)) {
                const a = normalize(q, replyAnswers[name], t.minConfidence);
                if (!a) return this.fail(task, 'malformed', `no usable answer for ${name}`);
                answers[name] = a;
            }
            const ms = Date.now() - start;
            st.answered++;
            st.totalMs += ms;
            st.maxMs = Math.max(st.maxMs, ms);
            const replyModel = isRecord(reply) && typeof reply.model === 'string' && reply.model ? reply.model : model;
            return { model: replyModel, ms, answers };
        } catch (err) {
            const reason: ModelFailReason = err instanceof ModelError ? err.reason : 'unreachable';
            const message = err instanceof Error ? err.message : String(err);
            if (reason === 'unreachable') {
                const ms = off ? Math.min(BACKOFF_MAX_MS, off.ms * 2) : BACKOFF_MIN_MS;
                this.backoff.set(t.url, { until: this.now() + ms, ms });
                this.log(`[laya] ${t.url}: unreachable (${message}); rules decide, asking again in ${ms / 1000} s`);
            }
            return this.fail(task, reason, message);
        }
    }

    /** models lists a server's decision models. */
    async models(url: string, timeoutMs = MODELS_TIMEOUT_MS): Promise<string[]> {
        const list = await this.fetchJSON(norm(url) + '/v1/models', {}, timeoutMs);
        const data = isRecord(list) && Array.isArray(list.data) ? list.data : [];
        const ids: string[] = [];
        for (const m of data) {
            if (isRecord(m) && typeof m.id === 'string' && Array.isArray(m.capabilities) && m.capabilities.includes('decisions')) ids.push(m.id);
        }
        return ids;
    }

    /** stats reports a task's counters since the client was made. */
    stats(task: string): TaskStats {
        const s = this.statsFor(task);
        return {
            asked: s.asked, answered: s.answered, failed: { ...s.failed },
            meanMs: s.answered ? s.totalMs / s.answered : 0, maxMs: s.maxMs,
        };
    }

    /** timeoutFor is the per-request timeout decide() uses for a task (null when it isn't configured). */
    timeoutFor(task: string): number | null {
        return this.taskConfig(task)?.timeoutMs ?? null;
    }

    /**
     * check reports on a task: its server, the server's decision models, the model the task uses, its
     * served prompt version, and, given a sample request, the answer and time.
     */
    async check(task: string, sample?: DecisionSample): Promise<CheckReport> {
        const t = this.taskConfig(task);
        const out: CheckReport = {
            task, enabled: !!t?.enabled, url: t?.url ?? null, reachable: false, models: [], model: null, prompt: null, answer: null, error: null,
        };
        if (!t) {
            out.error = 'not configured: the task or its server is missing from decision_models';
            return out;
        }
        try {
            out.models = await this.models(t.url, Math.max(t.timeoutMs, MODELS_TIMEOUT_MS));
            out.reachable = true;
            const model = await this.modelFor(t, true);
            out.model = model;
            await this.refreshServed(t.url).catch(() => {});
            out.prompt = this.served.get(t.url)?.prompts.get(model) ?? null;
        } catch (err) {
            out.error = err instanceof Error ? err.message : String(err);
            return out;
        }
        if (sample) {
            const start = Date.now();
            try {
                const reply = await this.fetchJSON(t.url + '/v1/decisions', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ model: out.model, questions: sample.questions, state: sample.state }),
                }, Math.max(t.timeoutMs, CHECK_SAMPLE_TIMEOUT_MS));
                const replyAnswers = isRecord(reply) && isRecord(reply.answers) ? reply.answers : {};
                const answers: Record<string, NormalAnswer> = {};
                for (const [name, q] of Object.entries(sample.questions)) {
                    const a = normalize(q, replyAnswers[name], t.minConfidence);
                    if (!a) throw new ModelError('malformed', `no usable answer for ${name}`);
                    answers[name] = a;
                }
                out.answer = { ms: Date.now() - start, answers };
            } catch (err) {
                out.error = err instanceof Error ? err.message : String(err);
            }
        }
        return out;
    }

    // ---- served prompt versions ----
    // golaya serve lists, per model, the prompt version it expects (prompt_version in GET /v1/models)
    // and names it in every decision (X-Laya-Prompt-Version), so laya-go can replace a model with one
    // that expects a newer prompt and andy follows without a settings change. A task's prompt setting
    // is the fallback when the server says nothing.

    /**
     * promptFor is the prompt version to write a task's state in: the served one for the task's model
     * (refreshed in the background when stale), else the task's prompt setting. undefined when the
     * task is not enabled or names neither.
     */
    promptFor(task: string): string | undefined {
        const t = this.taskConfig(task);
        if (!t?.enabled) return undefined;
        const found = this.discovered.get(t.url);
        const model = t.model || (typeof found === 'string' ? found : undefined);
        return (model ? this.servedPrompt(t.url, model) : undefined) ?? t.prompt;
    }

    /** servedPrompt is the version the server last said model expects, refreshing in the background when stale. */
    servedPrompt(url: string, model: string): string | undefined {
        url = norm(url);
        const e = this.served.get(url);
        if (!e || (!e.pending && this.now() - e.at > SERVED_TTL_MS)) this.refreshServed(url).catch(() => {});
        return e?.prompts.get(model);
    }

    /** refreshServed reads a server's prompt versions now (one read at a time per server). */
    refreshServed(url: string, timeoutMs = MODELS_TIMEOUT_MS): Promise<void> {
        url = norm(url);
        const e = this.servedEntry(url);
        if (e.pending) return e.pending;
        e.pending = (async () => {
            try {
                const list = await this.fetchJSON(url + '/v1/models', {}, timeoutMs);
                const prompts = new Map<string, string>();
                const data = isRecord(list) && Array.isArray(list.data) ? list.data : [];
                for (const m of data) {
                    if (isRecord(m) && typeof m.id === 'string' && m.id && typeof m.prompt_version === 'string' && m.prompt_version) {
                        prompts.set(m.id, m.prompt_version);
                    }
                }
                e.prompts = prompts;
            } finally {
                e.at = this.now(); // a failed read also waits SERVED_TTL_MS before the next try
                e.pending = null;
            }
        })();
        return e.pending;
    }

    /** primeServedPrompts reads every configured server's prompt versions, waiting at most timeoutMs. */
    async primeServedPrompts(timeoutMs = MODELS_TIMEOUT_MS): Promise<void> {
        const cfg = this.getConfig();
        const urls = new Set(Object.values(cfg?.servers ?? {}).map(s => norm(s.url)).filter(Boolean));
        await Promise.allSettled([...urls].map(u => this.refreshServed(u, timeoutMs)));
    }

    private noteServedPrompt(url: string, model: string, version: string): void {
        this.servedEntry(norm(url)).prompts.set(model, version);
    }

    private servedEntry(url: string): Served {
        let e = this.served.get(url);
        if (!e) {
            e = { at: 0, prompts: new Map(), pending: null };
            this.served.set(url, e);
        }
        return e;
    }

    // ---- internals ----

    private statsFor(task: string): Counters {
        let c = this.counters.get(task);
        if (!c) {
            const failed = Object.fromEntries(MODEL_FAIL_REASONS.map(r => [r, 0])) as Record<ModelFailReason, number>;
            c = { asked: 0, answered: 0, failed, totalMs: 0, maxMs: 0 };
            this.counters.set(task, c);
        }
        return c;
    }

    private fail(task: string, reason: ModelFailReason, detail?: string): null {
        this.statsFor(task).failed[reason]++;
        const now = this.now();
        const key = `${task}\u0000${reason}`;
        if (reason !== 'disabled' && now - (this.lastLog.get(key) ?? -Infinity) > LOG_EVERY_MS) {
            this.lastLog.set(key, now);
            this.log(`[laya] ${task}: ${reason}${detail ? ' (' + detail + ')' : ''}`);
        }
        return null;
    }

    /** taskConfig returns the task's settings with its server's URL and its effective timeout, or null. */
    private taskConfig(task: string): ResolvedTask | null {
        const cfg = this.getConfig();
        const t = cfg?.tasks[task];
        const server = t ? cfg?.servers[t.server] : undefined;
        if (!t || !server?.url) return null;
        let timeoutMs = t.timeout_ms ?? DEFAULT_TIMEOUT_MS;
        if (timeoutMs < this.minTimeoutMs) {
            if (!this.raisedLogged.has(task)) {
                this.raisedLogged.add(task);
                this.log(`[laya] ${task}: timeout_ms ${timeoutMs} raised to ${this.minTimeoutMs} (measured latency)`);
            }
            timeoutMs = this.minTimeoutMs;
        }
        return { ...t, url: norm(server.url), timeoutMs, minConfidence: t.min_confidence ?? 0 };
    }

    /** modelFor returns the task's model, discovering the server's only decisions model when none is set. */
    private async modelFor(t: ResolvedTask, refresh = false): Promise<string> {
        if (t.model) return t.model;
        if (refresh || !this.discovered.has(t.url)) {
            const ids = await this.models(t.url, Math.max(t.timeoutMs, MODELS_TIMEOUT_MS));
            this.discovered.set(t.url, ids.length === 1 ? ids[0]!
                : new ModelError('no_model', `server has ${ids.length} decision models (${ids.join(', ') || 'none'}); set the task's model`));
        }
        const m = this.discovered.get(t.url)!;
        if (m instanceof ModelError) throw m;
        return m;
    }

    private async fetchJSON(url: string, init: RequestInit, timeoutMs: number, onOk?: (resp: Response) => void): Promise<unknown> {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
        try {
            let resp: Response, text: string;
            try {
                resp = await this.fetchFn(url, { ...init, signal: controller.signal });
                text = await resp.text();
            } catch (err) {
                if (controller.signal.aborted) throw new ModelError('timeout', `no answer in ${timeoutMs} ms`);
                const cause = err instanceof Error && err.cause instanceof Error ? `: ${err.cause.message}` : '';
                throw new ModelError('unreachable', (err instanceof Error ? err.message : String(err)) + cause);
            }
            if (!resp.ok) throw new ModelError('http', `HTTP ${resp.status}: ${text.slice(0, 200)}`);
            onOk?.(resp);
            try {
                return JSON.parse(text) as unknown;
            } catch {
                throw new ModelError('malformed', 'reply is not JSON');
            }
        } finally {
            clearTimeout(timer);
        }
    }
}

/** createLayaClient makes a client (the old bot's factory name). */
export function createLayaClient(opts: LayaClientOptions): LayaClient {
    return new LayaClient(opts);
}
