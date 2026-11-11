// Model share: per Laya task, how many decisions the model made and how many
// the rules made instead (with the vetoes and fallbacks among them), from
// the laya-<task>.jsonl entries in a test's time window. Pure.
//
// Each task logs differently; classify() reads one entry:
//   command  kind run/reply/ignore: model; kind llm (chat, unsure, no
//            answer; with llm off the canned reply): rules, fallback
//   director source model|rules
//   follow   outcome fallback: rules (reason veto: veto, else fallback);
//            stepped/wait: model
//   mine     source model|rules; why veto: veto; why low-confidence,
//            no-answer, stop-early, off-plan, nothing-seen, nothing-to-block,
//            no-torches: fallback; walk-first: rules. Walk, restart and
//            reuse lines aren't decisions.
//   farm     source model (outcome veto: rules, veto); source dry/banned:
//            rules (fallback). Craft-for-farm lines aren't decisions.
//   craft    outcome fallback: rules, fallback; else model
//   defend   model (its fallbacks to the old modes aren't logged)
//   eat      outcome fallback: rules, fallback; else model
//   chores   ask lines by source

export const SHARE_TASKS = ['command', 'director', 'chores', 'follow', 'mine', 'farm', 'craft', 'defend', 'eat'];

const FALLBACK_WHY = new Set(['low-confidence', 'no-answer', 'stop-early', 'off-plan', 'nothing-seen', 'nothing-to-block', 'no-torches']);

// classify returns {by: 'model'|'rules', veto, fallback} for a decision
// entry, or null for a line that isn't one.
export function classify(task, e) {
    const d = (by, extra = {}) => ({ by, veto: false, fallback: false, ...extra });
    switch (task) {
        case 'command':
            if (!e.kind) return null;
            return e.kind === 'llm' ? d('rules', { fallback: true }) : d('model');
        case 'director':
            return e.source ? d(e.source === 'model' ? 'model' : 'rules') : null;
        case 'chores': // ask lines (impossible and ended lines aren't decisions)
            return e.event === 'ask' && e.source ? d(e.source === 'model' ? 'model' : 'rules') : null;
        case 'follow':
            if (!e.outcome) return null;
            if (e.outcome === 'fallback') return d('rules', e.reason === 'veto' ? { veto: true } : { fallback: true });
            return d('model');
        case 'mine':
            if (!e.source) return null;
            if (e.source === 'model') return d('model');
            if (e.why === 'veto' || e.veto) return d('rules', { veto: true });
            return d('rules', { fallback: FALLBACK_WHY.has(e.why) });
        case 'farm':
            if (!e.source) return null;
            if (e.source === 'model') return e.outcome === 'veto' ? d('rules', { veto: true }) : d('model');
            return d('rules', { fallback: true });
        case 'craft':
            if (!e.outcome) return null;
            return e.outcome === 'fallback' ? d('rules', { fallback: true }) : d('model');
        case 'defend':
            return e.outcome ? d('model') : null;
        case 'eat':
            if (!e.outcome) return null;
            return e.outcome === 'fallback' ? d('rules', { fallback: true }) : d('model');
    }
    return null;
}

const empty = () => ({ decisions: 0, model: 0, rules: 0, veto: 0, fallback: 0 });

// modelShare counts entries ([{task, ...}]) per task and in total.
export function modelShare(entries) {
    const tasks = {};
    const total = empty();
    for (const e of entries || []) {
        const c = classify(e.task, e);
        if (!c) continue;
        const t = (tasks[e.task] ||= empty());
        for (const x of [t, total]) {
            x.decisions++;
            x[c.by]++;
            if (c.veto) x.veto++;
            if (c.fallback) x.fallback++;
        }
    }
    return { tasks, total };
}

// addShares sums shares (e.g. a suite's tests).
export function addShares(shares) {
    const out = { tasks: {}, total: empty() };
    for (const s of shares) {
        if (!s) continue;
        for (const [task, c] of Object.entries(s.tasks || {})) {
            const t = (out.tasks[task] ||= empty());
            for (const k of Object.keys(t)) t[k] += c[k] || 0;
        }
        for (const k of Object.keys(out.total)) out.total[k] += s.total?.[k] || 0;
    }
    return out;
}

const pct = (n, d) => (d ? `${Math.round((100 * n) / d)}%` : '—');

// shareBrief: "model 120/150 (80%)" or "no decisions".
export function shareBrief(s) {
    const t = s?.total;
    return t?.decisions ? `model ${t.model}/${t.decisions} (${pct(t.model, t.decisions)})` : 'no decisions';
}

// shareTable: a markdown table, a row per task (in SHARE_TASKS order) and a
// total.
export function shareTable(s) {
    const rows = ['| Task | Decisions | Model | Rules | Vetoed | Fallback | Model share |', '|---|---|---|---|---|---|---|'];
    const row = (name, c) => `| ${name} | ${c.decisions} | ${c.model} | ${c.rules} | ${c.veto} | ${c.fallback} | ${pct(c.model, c.decisions)} |`;
    const names = [...SHARE_TASKS.filter(t => s?.tasks?.[t]), ...Object.keys(s?.tasks || {}).filter(t => !SHARE_TASKS.includes(t))];
    for (const t of names) rows.push(row(t, s.tasks[t]));
    rows.push(row('**total**', s?.total || empty()));
    return rows.join('\n');
}
