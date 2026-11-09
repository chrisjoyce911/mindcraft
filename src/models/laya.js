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
export function createLayaClient(getConfig = () => agentSettings.decision_models, { log = console.warn } = {}) {
    const counters = new Map();
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

    const fetchJSON = async (url, options, timeoutMs) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const resp = await fetch(url, { ...options, signal: controller.signal });
            const text = await resp.text();
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
        try {
            const model = await modelFor(t);
            const body = JSON.stringify({ model, questions, state });
            const reply = await fetchJSON(t.url + '/v1/decisions', {
                method: 'POST', headers: { 'content-type': 'application/json' }, body,
            }, t.timeout_ms);
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
            return fail(task, err.reason || 'unreachable', err.message);
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

// laya is the client Mindcraft uses, reading the agent's settings.
export const laya = createLayaClient();

// taskSettings returns a task's settings when it is enabled, or null.
export function taskSettings(task) {
    const t = agentSettings.decision_models?.tasks?.[task];
    return t?.enabled ? t : null;
}
