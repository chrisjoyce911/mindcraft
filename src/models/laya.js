// Client for Laya decision models: small local models that answer typed
// questions (choice, score, noul) with probabilities in milliseconds.
//
// Which model answers a kind of decision (a "task", such as "follow") is set in
// settings.decision_models, so swapping an untrained, pretrained or trained
// model is a settings change. Both golaya serve (laya-go) and MLX-Serve speak
// the same API: GET /v1/models and POST /v1/decisions.
//
// decide() never throws: on any failure it returns null and counts the reason,
// and the caller falls back.

import agentSettings from '../agent/settings.js';

const LOG_EVERY_MS = 60_000;

// An unreachable server (connection refused, "fetch failed": a golaya
// restart or blip) is retried once at once; if it is still unreachable it
// isn't asked again for a back-off that doubles from BACKOFF_MIN_MS to
// BACKOFF_MAX_MS, so the callers fall back (rules) without waiting each
// time. Entering and leaving back-off is logged.
export const BACKOFF_MIN_MS = 1_000;
export const BACKOFF_MAX_MS = 10_000;

// The failure reasons decide() counts.
export const REASONS = ['disabled', 'timeout', 'unreachable', 'http', 'malformed', 'no_model'];

// normalize turns one server answer into the normal form, or null if it
// doesn't match the question it answers.
export function normalize(question, raw, minConfidence) {
    if (!raw || raw.type !== question.type) return null;
    if (question.type === 'noul') {
        const p = typeof raw.noul === 'number' ? raw.noul : raw.probabilities?.true;
        if (typeof p !== 'number') return null;
        const top = p > 0.5 ? 'true' : 'false';
        const topProbability = p > 0.5 ? p : 1 - p;
        return { type: 'noul', probability: p, top, topProbability, confident: topProbability >= minConfidence };
    }
    const probs = raw.probabilities;
    if (!probs || typeof probs !== 'object') return null;
    const order = Array.isArray(question.criteria) ? question.criteria : Object.keys(question.criteria || {});
    let top = null, topProbability = -1;
    for (const option of order) {
        const p = probs[option];
        if (typeof p !== 'number') return null;
        if (p > topProbability) { top = option; topProbability = p; }
    }
    if (top === null) return null;
    return { type: question.type, top, topProbability, probabilities: { ...probs }, confident: topProbability >= minConfidence };
}

// createLayaClient makes a client. getConfig returns the decision_models
// settings ({servers, tasks}); it is read on every call, so changes to the
// settings take effect at once.
export function createLayaClient(getConfig = () => agentSettings.decision_models, { log = console.warn, now = () => Date.now() } = {}) {
    const counters = new Map();
    const backoff = new Map(); // server url -> {until, ms}
    const discovered = new Map(); // server url -> model id (or an Error)
    const lastLog = new Map();

    const statsFor = task => {
        if (!counters.has(task)) {
            counters.set(task, { asked: 0, answered: 0, failed: Object.fromEntries(REASONS.map(r => [r, 0])), totalMs: 0, maxMs: 0 });
        }
        return counters.get(task);
    };

    const fail = (task, reason, detail) => {
        statsFor(task).failed[reason]++;
        const now = Date.now();
        if (reason !== 'disabled' && now - (lastLog.get(task + reason) || 0) > LOG_EVERY_MS) {
            lastLog.set(task + reason, now);
            log(`[laya] ${task}: ${reason}${detail ? ' (' + detail + ')' : ''}`);
        }
        return null;
    };

    // taskConfig returns the task's settings and its server's URL, or null.
    const taskConfig = task => {
        const cfg = getConfig() || {};
        const t = cfg.tasks?.[task];
        const server = t ? cfg.servers?.[t.server] : null;
        if (!t || !server?.url) return null;
        return { ...t, url: server.url.replace(/\/+$/, ''), timeout_ms: t.timeout_ms ?? 300, min_confidence: t.min_confidence ?? 0 };
    };

    const fetchJSON = async (url, options, timeoutMs, onResponse) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
            const text = await resp.text();
            if (resp.ok && onResponse) onResponse(resp);
            if (!resp.ok) {
                const err = new Error(`HTTP ${resp.status}: ${text.slice(0, 200)}`);
                err.reason = 'http';
                throw err;
            }
            try {
                return JSON.parse(text);
            } catch {
                const err = new Error('reply is not JSON');
                err.reason = 'malformed';
                throw err;
            }
        } catch (err) {
            if (err.reason) throw err;
            err.reason = err.name === 'AbortError' ? 'timeout' : 'unreachable';
            throw err;
        } finally {
            clearTimeout(timer);
        }
    };

    // models lists a server's decision models.
    const models = async (url, timeoutMs = 2000) => {
        const list = await fetchJSON(url.replace(/\/+$/, '') + '/v1/models', {}, timeoutMs);
        return (list.data || []).filter(m => (m.capabilities || []).includes('decisions')).map(m => m.id);
    };

    // modelFor returns the task's model, discovering it when none is set.
    const modelFor = async (t, refresh = false) => {
        if (t.model) return t.model;
        if (refresh || !discovered.has(t.url)) {
            try {
                const ids = await models(t.url, Math.max(t.timeout_ms, 1000));
                discovered.set(t.url, ids.length === 1 ? ids[0]
                    : Object.assign(new Error(`server has ${ids.length} decision models (${ids.join(', ') || 'none'}); set the task's model`), { reason: 'no_model' }));
            } catch (err) {
                return Promise.reject(err);
            }
        }
        const m = discovered.get(t.url);
        if (m instanceof Error) throw m;
        return m;
    };

    // decide asks a task's model the questions about state. It returns
    // {model, ms, answers} with every answer in the normal form, or null.
    const decide = async (task, state, questions) => {
        const t = taskConfig(task);
        if (!t || !t.enabled) return fail(task, 'disabled');
        const st = statsFor(task);
        st.asked++;
        const start = Date.now();
        const off = backoff.get(t.url);
        if (off && now() < off.until) return fail(task, 'unreachable', `backing off ${Math.ceil((off.until - now()) / 1000)} s`);
        try {
            const model = await modelFor(t);
            const body = JSON.stringify({ model, questions, state });
            // golaya serve names the prompt version the model expects: a swapped model's
            // version is used from the next decision on.
            const seen = resp => {
                const p = resp.headers?.get?.('x-laya-prompt-version');
                if (p) noteServedPrompt(t.url, model, p);
            };
            const post = () => fetchJSON(t.url + '/v1/decisions', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body,
            }, t.timeout_ms, seen);
            let reply;
            try {
                reply = await post();
            } catch (err) {
                if (err.reason !== 'unreachable') throw err;
                reply = await post(); // once more: most blips are over at once
            }
            if (off) {
                backoff.delete(t.url);
                log(`[laya] ${t.url}: reachable again`);
            }
            const answers = {};
            for (const [name, q] of Object.entries(questions)) {
                const a = normalize(q, reply.answers?.[name], t.min_confidence);
                if (!a) return fail(task, 'malformed', `no usable answer for ${name}`);
                answers[name] = a;
            }
            const ms = Date.now() - start;
            st.answered++;
            st.totalMs += ms;
            st.maxMs = Math.max(st.maxMs, ms);
            return { model: reply.model || model, ms, answers };
        } catch (err) {
            const reason = err.reason || 'unreachable';
            if (reason === 'unreachable') {
                const ms = off ? Math.min(BACKOFF_MAX_MS, off.ms * 2) : BACKOFF_MIN_MS;
                backoff.set(t.url, { until: now() + ms, ms });
                log(`[laya] ${t.url}: unreachable (${err.message}); rules decide, asking again in ${ms / 1000} s`);
            }
            return fail(task, reason, err.message);
        }
    };

    // stats reports a task's counters since the client was made.
    const stats = task => {
        const s = statsFor(task);
        return { asked: s.asked, answered: s.answered, failed: { ...s.failed },
            meanMs: s.answered ? s.totalMs / s.answered : 0, maxMs: s.maxMs };
    };

    // check reports on a task: its server, the server's decision models, the
    // model the task uses, and, given a sample request, the answer and time.
    const check = async (task, sample) => {
        const t = taskConfig(task);
        const out = { task, enabled: !!t?.enabled, url: t?.url ?? null, reachable: false, models: [], model: null, answer: null, error: null };
        if (!t) {
            out.error = 'not configured: the task or its server is missing from decision_models';
            return out;
        }
        try {
            out.models = await models(t.url, Math.max(t.timeout_ms, 2000));
            out.reachable = true;
            out.model = await modelFor(t, true);
            await refreshServed(t.url).catch(() => {});
            out.prompt = servedPrompt(t.url, out.model) ?? null;
        } catch (err) {
            out.error = err.message;
            return out;
        }
        if (sample) {
            const start = Date.now();
            try {
                const reply = await fetchJSON(t.url + '/v1/decisions', {
                    method: 'POST', headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ model: out.model, questions: sample.questions, state: sample.state }),
                }, Math.max(t.timeout_ms, 30_000)); // a first request may load the model
                const answers = {};
                for (const [name, q] of Object.entries(sample.questions)) {
                    answers[name] = normalize(q, reply.answers?.[name], t.min_confidence);
                    if (!answers[name]) throw Object.assign(new Error(`no usable answer for ${name}`), { reason: 'malformed' });
                }
                out.answer = { ms: Date.now() - start, answers };
            } catch (err) {
                out.error = err.message;
            }
        }
        return out;
    };

    return { decide, models, check, stats };
}

// Served prompt versions. golaya serve lists, per model, the prompt version
// it expects (prompt_version in GET /v1/models, from the model folder's
// model-info.json) and names it in every decision (X-Laya-Prompt-Version), so
// laya-go can replace a model with one that expects a newer prompt and
// Mindcraft follows without a settings change. A task's prompt setting is the
// fallback when the server says nothing.
export const SERVED_TTL_MS = 10_000;
const served = new Map(); // server url -> {at, prompts: Map(model -> version), pending}
const norm = url => String(url || '').replace(/\/+$/, '');

// refreshServed reads a server's prompt versions now.
export async function refreshServed(url, timeoutMs = 2000) {
    url = norm(url);
    const e = served.get(url) || { at: 0, prompts: new Map(), pending: null };
    served.set(url, e);
    if (e.pending) return e.pending;
    e.pending = (async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        timer.unref?.();
        try {
            const resp = await fetch(url + '/v1/models', { signal: controller.signal });
            const list = await resp.json();
            const prompts = new Map();
            for (const m of list.data || []) if (m?.id && m.prompt_version) prompts.set(m.id, m.prompt_version);
            e.prompts = prompts;
        } finally {
            clearTimeout(timer);
            e.at = Date.now(); // a failed read also waits SERVED_TTL_MS before the next try
            e.pending = null;
        }
    })();
    return e.pending;
}

// servedPrompt returns the prompt version the server last said model expects
// (undefined when it hasn't said), refreshing in the background when stale.
export function servedPrompt(url, model) {
    url = norm(url);
    const e = served.get(url);
    if (!e || (!e.pending && Date.now() - e.at > SERVED_TTL_MS)) refreshServed(url).catch(() => {});
    return e?.prompts.get(model);
}

// noteServedPrompt records a version the server named in a decision.
export function noteServedPrompt(url, model, version) {
    url = norm(url);
    const e = served.get(url) || { at: 0, prompts: new Map(), pending: null };
    served.set(url, e);
    if (e.prompts.get(model) !== version) e.prompts.set(model, version);
}

// primeServedPrompts reads every configured server's prompt versions, at most timeoutMs.
export async function primeServedPrompts(config = agentSettings.decision_models, timeoutMs = 2000) {
    const urls = new Set(Object.values(config?.servers || {}).map(s => norm(s?.url)).filter(Boolean));
    await Promise.allSettled([...urls].map(u => refreshServed(u, timeoutMs)));
}

// laya is the client Mindcraft uses, reading the agent's settings.
export const laya = createLayaClient();

// taskSettings returns a task's settings when it is enabled, or null. Its
// prompt is the served model's prompt version, read each time prompt is read
// (so a kept task object follows a swap), else the task's prompt setting.
export function taskSettings(task, getConfig = () => agentSettings.decision_models) {
    const cfg = getConfig();
    const t = cfg?.tasks?.[task];
    if (!t?.enabled) return null;
    const url = cfg.servers?.[t.server]?.url;
    const out = { ...t };
    Object.defineProperty(out, 'prompt', {
        enumerable: true, configurable: true,
        get: () => (url && t.model ? servedPrompt(url, t.model) : undefined) ?? t.prompt,
    });
    return out;
}

// The served versions are read as soon as the client is loaded, so the first
// decisions already use them.
primeServedPrompts().catch(() => {});
