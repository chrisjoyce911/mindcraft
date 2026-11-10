// Checks: pure functions of what a test saw. Each returns {ok, reason}.
// ctx: {
//   snapshots: {before, after, <label>…} each {inventory, position, health, hunger, t},
//   chat: [andy's lines in the test], logs: [laya entries in the test's window],
//   timeline: [{t, action, idle, pos, health, hunger, entities}],
//   waited: {idle, timedOut} (the wait after the action), final: andy's last state,
//   chests: {"x y z": {item: count}}, chestsBefore: same, serverReplies: [lines],
//   tester: {x, y, z} }
import { matches, matchValue } from './logs.js';

// count: items matching a name, "a|b" alternatives or "/regex/".
export function count(inventory = {}, item) {
    const names = Object.keys(inventory);
    let pick;
    if (/^\/.*\/[a-z]*$/s.test(item)) pick = names.filter(n => matchValue(n, item));
    else { const alts = item.split('|').map(s => s.trim()); pick = names.filter(n => alts.includes(n)); }
    return pick.reduce((s, n) => s + (inventory[n] || 0), 0);
}

// bounds checks value against {min, max}; delta values are shown signed.
function bounds(value, { min, max }, what, delta = false) {
    const f = v => (delta && v >= 0 ? `+${v}` : `${v}`);
    if (min != null && !(value >= min)) return { ok: false, reason: `${what} ${f(value)}, wanted ≥ ${f(min)}` };
    if (max != null && !(value <= max)) return { ok: false, reason: `${what} ${f(value)}, wanted ≤ ${f(max)}` };
    return { ok: true, reason: `${what} ${f(value)}` };
}

const re = s => new RegExp(s, 'i');

function snap(ctx, name) {
    const s = ctx.snapshots?.[name];
    if (!s) throw new Error(`no snapshot "${name}"`);
    return s;
}

const fmtPos = p => (p ? `${p.x} ${p.y} ${p.z}` : '?');

export const CHECKS = {
    // {item, min, max, since ('before'), absolute}
    inventory(c, ctx) {
        const after = snap(ctx, c.at || 'after').inventory;
        if (c.absolute) return bounds(count(after, c.item), c, `${c.item} ×`, false);
        const before = snap(ctx, c.since || 'before').inventory;
        return bounds(count(after, c.item) - count(before, c.item), c, c.item, true);
    },
    // {at: "x y z", item, min, max, delta}
    chest(c, ctx) {
        const key = c.at;
        const now = ctx.chests?.[key];
        if (!now) return { ok: false, reason: `chest at ${key} could not be read${ctx.chestErrors?.[key] ? ': ' + ctx.chestErrors[key] : ''}` };
        if (c.delta) return bounds(count(now, c.item) - count(ctx.chestsBefore?.[key] || {}, c.item), c, `chest ${c.item}`, true);
        return bounds(count(now, c.item), c, `chest ${c.item} ×`, false);
    },
    // andy finished: idle after the action, not timed out
    idle(c, ctx) {
        if (ctx.waited?.timedOut) return { ok: false, reason: `still busy at the timeout (${ctx.final?.action?.current || '?'})` };
        return { ok: true, reason: 'idle' };
    },
    // {match, none: true → must not appear}
    reply(c, ctx) {
        const hit = (ctx.chat || []).find(l => re(c.match).test(l));
        if (c.none) return hit ? { ok: false, reason: `andy said "${hit}"` } : { ok: true, reason: `no /${c.match}/` };
        return hit ? { ok: true, reason: `"${hit}"` } : { ok: false, reason: `no reply /${c.match}/ (andy said: ${(ctx.chat || []).slice(-5).map(l => `"${l}"`).join(', ') || 'nothing'})` };
    },
    // {task, match, min (1), max}
    log(c, ctx) {
        const n = (ctx.logs || []).filter(e => (!c.task || e.task === c.task) && matches(e, c.match)).length;
        const want = { min: c.min ?? (c.max == null ? 1 : null), max: c.max };
        return bounds(n, want, `laya-${c.task || '*'} entries matching ${JSON.stringify(c.match ?? {})}:`, false);
    },
    // {axis: x|y|z|dist, since ('before'), during: min|max, min, max}
    position(c, ctx) {
        const from = snap(ctx, c.since || 'before').position;
        if (!from) return { ok: false, reason: 'no start position' };
        const axis = c.axis || 'y';
        const val = p => (axis === 'dist' ? Math.hypot(p.x - from.x, p.z - from.z) : p[axis] - from[axis]);
        let v;
        if (c.during) {
            const vals = (ctx.timeline || []).filter(e => e.pos).map(e => val(e.pos));
            if (!vals.length) return { ok: false, reason: 'no positions seen' };
            v = c.during === 'max' ? Math.max(...vals) : Math.min(...vals);
        } else {
            const to = snap(ctx, c.at || 'after').position;
            if (!to) return { ok: false, reason: 'no end position' };
            v = val(to);
        }
        return bounds(+v.toFixed(2), c, `${axis === 'dist' ? 'moved' : axis}${c.during ? ` (${c.during} during)` : ''} from ${fmtPos(from)}:`, axis !== 'dist');
    },
    // {max, min}: distance andy ↔ tester at the end
    near(c, ctx) {
        const a = ctx.final?.gameplay?.position, t = ctx.tester;
        if (!a || !t) return { ok: false, reason: 'positions unknown' };
        return bounds(+Math.hypot(a.x - t.x, a.y - t.y, a.z - t.z).toFixed(1), c, 'andy to tester', false);
    },
    // {field: health|hunger, since, min, max}
    stat(c, ctx) {
        const field = c.field || 'hunger';
        const after = snap(ctx, c.at || 'after')[field];
        if (c.since) return bounds(after - snap(ctx, c.since)[field], c, `${field} since ${c.since}`, true);
        return bounds(after, c, field, false);
    },
    // {entity}: not near andy at the end
    noEntity(c, ctx) {
        const types = ctx.final?.nearby?.entityTypes || [];
        return types.includes(c.entity) ? { ok: false, reason: `${c.entity} still near andy (${types.join(', ')})` } : { ok: true, reason: `no ${c.entity} near` };
    },
    // {match, final: true → the last action label must match; after: snapshot label}
    actionSeen(c, ctx) {
        if (c.final) {
            const cur = ctx.final?.action?.current || 'Idle';
            return re(c.match).test(cur) ? { ok: true, reason: `doing ${cur}` } : { ok: false, reason: `doing ${cur}, wanted /${c.match}/` };
        }
        const after = c.after ? snap(ctx, c.after).t : -Infinity;
        const labels = [...new Set((ctx.timeline || []).filter(e => e.t >= after).map(e => e.action || 'Idle'))];
        const hit = labels.find(l => re(c.match).test(l));
        return hit ? { ok: true, reason: `saw ${hit}` } : { ok: false, reason: `never saw /${c.match}/ (saw ${labels.join(', ') || 'nothing'})` };
    },
    // {match}: a reply from the server to tester's commands
    serverReply(c, ctx) {
        const hit = (ctx.serverReplies || []).find(l => re(c.match).test(l));
        return hit ? { ok: true, reason: `"${hit}"` } : { ok: false, reason: `server never said /${c.match}/ (said: ${(ctx.serverReplies || []).slice(-4).map(l => `"${l}"`).join(', ') || 'nothing'}). Are cheats on for tester?` };
    },
};

export function evaluate(check, ctx) {
    try {
        const r = CHECKS[check.type](check, ctx);
        return { type: check.type, ok: !!r.ok, reason: String(r.reason), ...(check.note ? { note: check.note } : {}) };
    } catch (e) {
        return { type: check.type, ok: false, reason: `check error: ${e.message}` };
    }
}

// describeCheck: one line for docs and reports.
export function describeCheck(c) {
    const range = (unit = '') => [c.min != null ? `≥ ${c.min}${unit}` : null, c.max != null ? `≤ ${c.max}${unit}` : null].filter(Boolean).join(' and ');
    switch (c.type) {
    case 'inventory': return c.absolute ? `andy has ${c.item} ${range()}` : `andy's ${c.item} changes by ${range()}${c.since && c.since !== 'before' ? ` since ${c.since}` : ''}`;
    case 'chest': return `chest at ${c.at} ${c.delta ? 'gains' : 'holds'} ${c.item} ${range()}`;
    case 'idle': return 'andy finishes before the timeout';
    case 'reply': return c.none ? `andy never says /${c.match}/` : `andy says /${c.match}/`;
    case 'log': return `laya-${c.task || '*'} log has ${c.min ?? 1}+ entries matching ${JSON.stringify(c.match ?? {})}`;
    case 'position': return `andy's ${c.axis || 'y'} ${c.during ? `(${c.during} during the test) ` : ''}changes by ${range()}`;
    case 'near': return `andy ends ${range(' blocks')} from tester`;
    case 'stat': return `andy's ${c.field} ${c.since ? `changes since ${c.since} by` : 'is'} ${range()}`;
    case 'noEntity': return `no ${c.entity} near andy at the end`;
    case 'actionSeen': return c.final ? `andy is doing /${c.match}/ at the end` : `andy's action /${c.match}/ is seen`;
    case 'serverReply': return `the server replies /${c.match}/`;
    default: return JSON.stringify(c);
    }
}
