// Checks: pure functions of what a test saw. Each returns {ok, reason}.
// ctx: {
//   snapshots: {before, after, <label>…} each {inventory, position, health, hunger, t},
//   chat: [andy's lines in the test], logs: [laya entries in the test's window],
//   timeline: [{t, action, idle, pos, health, hunger, entities}],
//   waited: {idle, timedOut} (the wait after the action), final: andy's last state,
//   chests: {"x y z": {item: count}}, chestsBefore: same, serverReplies: [lines],
//   tester: {x, y, z}, blocks: {blockKey: {count, center} | {error}} }
//   (final.places: andy's remembered places {name: [x, y, z]})
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

// logsOf: the laya entries of a task (any task without one), only those
// logged at or after snapshot c.since when given (e.g. "before": after the
// setup, so a reset's or the setup's own entries don't count).
function logsOf(c, ctx) {
    let logs = (ctx.logs || []).filter(e => !c.task || e.task === c.task);
    if (c.since != null) {
        const t0 = snap(ctx, c.since).t;
        logs = logs.filter(e => Date.parse(e.time) >= t0);
    }
    return logs;
}

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
    // {task, match, min (1), max, before, since}: with before (a match), only
    // the entries logged before the first entry matching it count, and that
    // entry must exist (so "collect steps came before the first down step");
    // since: a snapshot label, only entries from then on count.
    log(c, ctx) {
        let logs = logsOf(c, ctx);
        let upTo = c.since != null ? ` since ${c.since}` : '';
        if (c.before != null) {
            const i = logs.findIndex(e => matches(e, c.before));
            if (i < 0) return { ok: false, reason: `no laya-${c.task || '*'} entry matching ${JSON.stringify(c.before)} to count before` };
            logs = logs.slice(0, i);
            upTo += ` before the first ${JSON.stringify(c.before)}`;
        }
        const n = logs.filter(e => matches(e, c.match)).length;
        const want = { min: c.min ?? (c.max == null ? 1 : null), max: c.max };
        return bounds(n, want, `laya-${c.task || '*'} entries matching ${JSON.stringify(c.match ?? {})}${upTo}:`, false);
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
    // {match, none: true → the server must not say it}: a reply from the
    // server to tester's commands
    serverReply(c, ctx) {
        const hit = (ctx.serverReplies || []).find(l => re(c.match).test(l));
        if (c.none) return hit ? { ok: false, reason: `the server said "${hit}"` } : { ok: true, reason: `server never said /${c.match}/` };
        return hit ? { ok: true, reason: `"${hit}"` } : { ok: false, reason: `server never said /${c.match}/ (said: ${(ctx.serverReplies || []).slice(-4).map(l => `"${l}"`).join(', ') || 'nothing'}). Are cheats on for tester?` };
    },
    // {name, at: "x y z" (optional), none: true → andy must not remember it}:
    // andy remembers the place name (at the end of the test), at exactly at
    // when given, e.g. the home chest a chat message set; none: e.g. no
    // last_death_position (andy never died)
    place(c, ctx) {
        const places = ctx.final?.places;
        if (!places) return { ok: false, reason: "andy's places were not read" };
        const p = places[c.name];
        const has = Array.isArray(p);
        const got = has ? p.map(Math.floor).join(' ') : null;
        if (c.none) return has ? { ok: false, reason: `${c.name} at ${got}` } : { ok: true, reason: `no place ${c.name}` };
        if (!has) return { ok: false, reason: `no place ${c.name} (places: ${Object.keys(places).join(', ') || 'none'})` };
        if (c.at == null) return { ok: true, reason: `${c.name} at ${got}` };
        return got === c.at ? { ok: true, reason: `${c.name} at ${got}` } : { ok: false, reason: `${c.name} at ${got}, wanted ${c.at}` };
    },
    // {task, match, key: [fields] (["skill", "target"]), result: wanted value
    // of `field` ("failed"), field ("result"), max (2)}: no dead end. Among the
    // entries matching match, in order, fails when more than max in a row
    // share the key and all have field = result (the same failed answer
    // max + 1 times in a row). A result value may be "/regex/". except (a
    // match): entries matching it are skipped (they neither count nor break
    // a run), e.g. {reason: "interrupted"}: the director took the body, the
    // answer did not fail. since: a snapshot label, as for log.
    repeat(c, ctx) {
        const key = c.key || ['skill', 'target'];
        const field = c.field || 'result';
        const want = c.result ?? 'failed';
        const max = c.max ?? 2;
        const get = (e, k) => k.split('.').reduce((o, q) => o?.[q], e);
        const logs = logsOf(c, ctx).filter(e => matches(e, c.match) && !(c.except != null && matches(e, c.except)));
        let run = [], worst = [];
        for (const e of logs) {
            const k = JSON.stringify(key.map(f => get(e, f) ?? null));
            if (!matchValue(get(e, field), want)) { run = []; continue; }
            if (run.length && run[0].k !== k) run = [];
            run.push({ k, e });
            if (run.length > worst.length) worst = run.slice();
            if (run.length > max) {
                const what = key.map(f => get(e, f)).join(' ');
                const times = run.map(r => r.e.time || '?').join(', ');
                const why = [...new Set(run.map(r => r.e.reason).filter(Boolean))].join(' | ');
                return { ok: false, reason: `laya-${c.task || '*'} ${what} ${get(e, field)} ${run.length} times in a row (${times})${why ? `: ${why}` : ''}` };
            }
        }
        const top = worst.length ? ` (longest: ${key.map(f => get(worst[0].e, f)).join(' ')} ×${worst.length})` : '';
        return { ok: true, reason: `no ${max + 1} same ${want} answers in a row among ${logs.length} laya-${c.task || '*'} entries${top}` };
    },
    // {block (name or /regex/), near: "andy" (default) | "x y z", radius (6),
    // min (1), max}: blocks of that kind within radius at the end of the
    // action (read before cleanup), e.g. the water of a pond andy made
    block(c, ctx) {
        const b = ctx.blocks?.[blockKey(c)];
        if (!b) return { ok: false, reason: `blocks ${c.block} near ${c.near || 'andy'} were not read` };
        if (b.error) return { ok: false, reason: `blocks ${c.block} near ${c.near || 'andy'} could not be read: ${b.error}` };
        const want = { min: c.min ?? (c.max == null ? 1 : null), max: c.max };
        return bounds(b.count, want, `${c.block} blocks within ${c.radius ?? 6} of ${b.center ? fmtPos(b.center) : c.near || 'andy'}:`, false);
    },
};

// blockKey names one block count a `block` check needs (the runner reads
// them, the check looks them up).
export const blockKey = c => `${c.block}@${c.near || 'andy'}@${c.radius ?? 6}`;

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
    case 'log': return `laya-${c.task || '*'} log has ${c.min ?? 1}+ entries matching ${JSON.stringify(c.match ?? {})}${c.since != null ? ` since ${c.since}` : ''}${c.before != null ? ` before the first ${JSON.stringify(c.before)}` : ''}`;
    case 'position': return `andy's ${c.axis || 'y'} ${c.during ? `(${c.during} during the test) ` : ''}changes by ${range()}`;
    case 'near': return `andy ends ${range(' blocks')} from tester`;
    case 'stat': return `andy's ${c.field} ${c.since ? `changes since ${c.since} by` : 'is'} ${range()}`;
    case 'noEntity': return `no ${c.entity} near andy at the end`;
    case 'actionSeen': return c.final ? `andy is doing /${c.match}/ at the end` : `andy's action /${c.match}/ is seen`;
    case 'serverReply': return c.none ? `the server never replies /${c.match}/` : `the server replies /${c.match}/`;
    case 'place': return c.none ? `andy does not remember ${c.name}` : `andy remembers ${c.name}${c.at != null ? ` at ${c.at}` : ''}`;
    case 'repeat': return `laya-${c.task || '*'}${c.since != null ? ` since ${c.since}` : ''} never has ${(c.max ?? 2) + 1} ${c.result ?? 'failed'} entries in a row with the same ${(c.key || ['skill', 'target']).join('+')}`;
    case 'block': return `${c.block} blocks within ${c.radius ?? 6} of ${c.near || 'andy'} at the end: ${range() || '≥ 1'}`;
    default: return JSON.stringify(c);
    }
}
