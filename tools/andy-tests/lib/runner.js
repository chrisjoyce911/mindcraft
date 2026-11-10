// The runner: one scenario at a time against a Session.
//   1. skip when a Laya task it requires is disabled in andy's settings
//   2. wait for andy to be idle (send !stop if he stays busy)
//   3. take andy's block as {x} {y} {z}; run setup; snapshot "before"
//   4. run the action steps, then wait for andy to be idle (unless wait: false)
//   5. snapshot "after", read chests the checks name, collect chat, server
//      replies and the laya log lines in the test's window; evaluate checks
//   6. cleanup (always)
import { expand, stepKind, coords, describeStep } from './scenarios.js';
import { evaluate, describeCheck, blockKey } from './checks.js';
import { inventoryDiff } from './session.js';
import { brief } from './logs.js';
import { modelShare, addShares, shareBrief, shareTable } from './share.js';
import { brisbane, brisbaneIso, clock } from './time.js';

class StepFailed extends Error {}

// Lost the world or the mindserver: an error, not a test failure, and the
// rest of a suite can't run.
const CONNECTION = /not reachable|No Minecraft world|isn't in game|isn't registered|not in the world|Not connected|No state from|could not join|was kicked/;
export const isConnectionError = msg => CONNECTION.test(String(msg));

function stateTest(spec, s) {
    if (!s) return false;
    const within = (v, { min, max }) => (min == null || v >= min) && (max == null || v <= max);
    if (spec.stat) return within(spec.stat === 'health' ? s.gameplay?.health : s.gameplay?.hunger, spec);
    if (spec.item) {
        const inv = s.inventory?.counts || {};
        const n = spec.item.split('|').reduce((a, k) => a + (inv[k] || 0), 0);
        return within(n, spec);
    }
    if (spec.entity) return (s.nearby?.entityTypes || []).includes(spec.entity) === (spec.present !== false);
    if (spec.action) return new RegExp(spec.action, 'i').test(s.action?.current || 'Idle');
    if (spec.idle != null) return !!s.action?.isIdle === !!spec.idle;
    throw new Error(`waitFor needs stat, item, entity, action or idle: ${JSON.stringify(spec)}`);
}

// Fail fast: a wait (waitFor, waitReply, waitLog) whose condition isn't met
// once andy's action has ended. When andy was busy during the wait and has
// then been idle for idleFail ms (default 30 s; the step's `idleFail`, the
// test's or the file's defaults; false turns it off), the step fails with the
// reason instead of waiting out its timeout. A wait while andy never gets
// busy (eat waiting for hunger to drop) is not affected.
export const IDLE_FAIL_MS = 30000;

async function waitStep(step, ctx, fn, timeout) {
    const s = ctx.session;
    const idleFail = step.idleFail ?? ctx.defaults.idleFail ?? IDLE_FAIL_MS;
    let busy = false, idleSince = null, gaveUp = null;
    const r = await s.waitUntil(async () => {
        const v = await fn();
        if (v) return v;
        if (idleFail === false) return null;
        const st = s.mind?.state?.();
        if (!st) return null;
        const t = s.now();
        if (!st.action?.isIdle) { busy = true; idleSince = null; } else if (busy && idleSince == null) idleSince = t;
        if (busy && idleSince != null && t - idleSince >= idleFail) { gaveUp = { idleMs: t - idleSince }; return gaveUp; }
        return null;
    }, { timeout, poll: step.poll ?? 500 });
    if (r.ok && r.value === gaveUp && gaveUp) return { ok: false, idle: true, ms: r.ms, idleMs: gaveUp.idleMs };
    return r;
}

const waitFailure = (r, what) => (r.idle
    ? `andy's action ended and ${what} ${Math.round(r.idleMs / 1000)}s later (gave up after ${Math.round(r.ms / 1000)}s, not waiting for the timeout)`
    : null);

// runStep runs one (already expanded) step. ctx: {session, deadline, t0,
// serverReplies, defaults, anchor()}.
export async function runStep(step, ctx) {
    const s = ctx.session;
    const kind = stepKind(step);
    const v = step[kind];
    const left = () => Math.max(0, ctx.deadline - s.now());
    const budget = def => Math.min(step.timeout ?? def, left());
    const times = Math.max(1, step.repeat || 1);
    const out = [];
    for (let i = 0; i < times; i++) {
        switch (kind) {
        case 'cmd': {
            const r = await s.serverCommand(v, step.replyMs ?? 800);
            ctx.serverReplies.push(...r.replies);
            out.push(...r.replies);
            break;
        }
        case 'say': {
            const r = await s.say(v, step.replyMs ?? 500);
            out.push(...r.replies);
            break;
        }
        case 'andy': {
            const r = await s.command(v, step.replyMs ?? 500);
            out.push(...r.replies);
            break;
        }
        case 'wait': await s.sleep(Math.min(v, left())); break;
        case 'waitIdle': {
            const o = typeof v === 'object' ? v : {};
            const r = await s.waitIdle({ timeout: budget(o.timeout ?? 120000), grace: o.grace ?? ctx.defaults.grace, settle: o.settle ?? ctx.defaults.settle });
            if (r.timedOut) throw new StepFailed(`andy was still busy after ${Math.round(r.ms / 1000)}s`);
            break;
        }
        case 'waitFor': {
            const r = await waitStep(step, ctx, () => stateTest(v, s.mind.state()), budget(60000));
            if (!r.ok) throw new StepFailed(waitFailure(r, `${JSON.stringify(v)} was still not true`) || `timed out waiting for ${JSON.stringify(v)}`);
            break;
        }
        case 'waitReply': {
            const from = ctx.tAction ?? ctx.t0;
            const rx = new RegExp(v, 'i');
            const r = await waitStep(step, ctx, () => s.chatSince(from).find(c => rx.test(c.text)), budget(60000));
            if (!r.ok) throw new StepFailed(waitFailure(r, `he still hadn't said /${v}/`) || `andy never said /${v}/`);
            out.push(r.value.text);
            break;
        }
        case 'waitLog': {
            const from = ctx.tAction ?? ctx.t0;
            const r = await waitStep({ poll: 1000, ...step }, ctx, () => s.logs({ task: v.task, since: from, match: v.match, limit: 1 })[0], budget(60000));
            if (!r.ok) throw new StepFailed(waitFailure(r, `there was still no laya-${v.task} entry matching ${JSON.stringify(v.match ?? {})}`) || `no laya-${v.task} entry matching ${JSON.stringify(v.match ?? {})}`);
            break;
        }
        case 'tp': {
            const r = typeof v === 'string' ? await s.tp(coords(v)) : await s.tp(v);
            out.push(...(r.replies || []));
            break;
        }
        case 'walk': {
            const r = typeof v === 'string' ? await s.move({ ...coords(v), timeoutMs: budget(30000) }) : await s.move({ ...v, timeoutMs: budget(30000) });
            out.push(`tester at ${r.position ? `${r.position.x} ${r.position.y} ${r.position.z}` : '?'}${r.walked === false ? ' (teleported)' : ''}`);
            break;
        }
        case 'snapshot': await s.snapshot(v); break;
        case 'anchor': await ctx.anchor(); break;
        case 'reset': {
            if (!s.onTestWorld?.()) { out.push('skipped: not the test world'); break; }
            const r = await s.worldReset({ andyTimeoutMs: budget(90000) });
            if (r.andy && !r.andy.inGame) throw new StepFailed(`andy wasn't back in game after the reset${r.andy.error ? ': ' + r.andy.error : ''}`);
            out.push(`reset in ${(r.ms / 1000).toFixed(1)}s${r.andy ? `, andy back in ${((r.andyMs ?? 0) / 1000).toFixed(1)}s` : ''}`);
            if (r.andy) {
                const st = await s.settleAfterRestart({ watchMs: step.settleMs ?? 10000 });
                if (st.stopped) out.push(`andy started ${st.saw.join(', ') || 'something'} by himself after the restart: stopped`);
            }
            // the template has no player data: tester joins in survival. He
            // left with the old server, so rejoin first (over RCON the
            // command would find no player).
            await s.ensureTester();
            const g = await s.serverCommand(`/gamemode creative ${ctx.vars.tester}`, 800);
            if (g.replies.some(l => /No player was found/i.test(l))) throw new StepFailed(`tester isn't back in the world after the reset: ${g.replies.join(' / ')}`);
            out.push(...g.replies);
            break;
        }
        case 'site': {
            const o = typeof v === 'string' ? { name: v } : v;
            const r = await s.siteTp(o.name, { who: o.who || 'both' });
            if (r.skipped) { out.push(`skipped: ${r.reason}`); break; }
            out.push(`at ${r.at.x} ${r.at.y} ${r.at.z}`);
            if ((o.who || 'both') !== 'tester') await ctx.anchor();
            break;
        }
        default: throw new Error(`unknown step ${JSON.stringify(step)}`);
        }
    }
    return out;
}

async function runSteps(steps, ctx, record, part) {
    for (const raw of steps) {
        const step = expand(raw, ctx.vars);
        const entry = { part, step: describeStep(step), at: clock(ctx.session.now()) };
        record.push(entry);
        try {
            entry.out = await runStep(step, ctx);
        } catch (e) {
            entry.error = e.message;
            if (isConnectionError(e.message)) throw e;
            if (!step.optional) throw e instanceof StepFailed ? e : new StepFailed(`${part} step "${entry.step}": ${e.message}`);
        }
    }
}

const chestKeys = (checks, vars) => [...new Set(checks.filter(c => c.type === 'chest').map(c => expand(c.at, vars)))];

async function readChests(session, keys) {
    const items = {}, errors = {};
    for (const k of keys) {
        try {
            const { x, y, z } = coords(k);
            items[k] = (await session.chestContents(x, y, z)).items;
        } catch (e) { errors[k] = e.message; }
    }
    return { items, errors };
}

// Blocks the `block` checks need, counted at the end of the action (before
// cleanup). {blockKey: {count, center} | {error}}
async function readBlocks(session, checks, vars) {
    const out = {};
    for (const c of checks.filter(k => k.type === 'block').map(k => expand(k, vars))) {
        const key = blockKey(c);
        if (out[key]) continue;
        try {
            const center = !c.near || c.near === 'andy' ? null : coords(c.near);
            out[key] = await session.countBlocks(c.block, center, c.radius ?? 6);
        } catch (e) { out[key] = { error: e.message }; }
    }
    return out;
}

// via: how a test's action reached andy's job.
//   direct  the action sends andy a !command (no chat line to interpret)
//   model   a chat line the Laya command model turned into a command
//           (laya-command kind "run"); command names what it ran
//   llm     a chat line the command model passed to the LLM (kind "llm")
//   none    no laya-command entry for the chat line (the command task off,
//           or the line not addressed to andy)
// Only the test's own action steps count (not setup or cleanup).
export function viaOf(test, logs = [], tAction = 0) {
    const steps = test.action || [];
    if (!steps.some(st => stepKind(st) === 'say')) return { via: steps.some(st => stepKind(st) === 'andy') ? 'direct' : 'none' };
    const cmds = logs.filter(e => e.task === 'command' && Date.parse(e.time) >= tAction);
    const first = cmds.find(e => e.kind === 'run') || cmds.find(e => e.kind === 'llm') || cmds[0];
    if (!first) return { via: 'none' };
    if (first.kind === 'run') return { via: 'model', command: (first.lines || []).join(' ') || first.command };
    if (first.kind === 'llm') return { via: 'llm', command: `${first.command || 'chat'} → LLM` };
    return { via: 'none', command: first.kind };
}

// disabledTasks: the Laya tasks a test requires that andy's settings turn off.
export function disabledTasks(requires = [], settings = {}) {
    const tasks = settings?.decision_models?.tasks;
    if (!tasks) return [];
    return requires.filter(t => !tasks[t] || tasks[t].enabled === false);
}

export async function runTest(session, test, { defaults = {}, report = null } = {}) {
    defaults = { timeout: 120000, grace: 5000, settle: 3000, ...defaults };
    const started = session.now();
    const timeout = test.timeout ?? defaults.timeout;
    const result = { name: test.name, tags: test.tags || [], status: 'pass', started: brisbaneIso(started), ms: 0, reason: '', steps: [], checks: [] };
    const ctx = {
        session, defaults: { ...defaults, grace: test.grace ?? defaults.grace, settle: test.settle ?? defaults.settle },
        deadline: started + timeout, t0: started, tAction: null, serverReplies: [], vars: { andy: session.config.agent, tester: session.config.tester },
    };
    ctx.anchor = async () => Object.assign(ctx.vars, await session.andyBlock());
    if (session.onTestWorld?.()) {
        try { ctx.vars.sites = (await session.testWorld()).sites?.sites; } catch { /* no sites: {site:…} stays as written */ }
    }

    const finish = () => {
        result.ms = session.now() - started;
        if (result.status !== 'skip') {
            // model share: the model's decisions versus the rules' in the window
            try { result.share = modelShare(session.logs({ since: ctx.t0, until: session.now(), limit: 0, full: true })); } catch { /* no logs */ }
        }
        if (result.status !== 'skip' && !result.via) {
            let logs = [];
            try { logs = session.logs({ task: 'command', since: ctx.tAction ?? ctx.t0, limit: 0, full: true }); } catch { /* no logs */ }
            Object.assign(result, viaOf(test, logs, ctx.tAction ?? ctx.t0));
        }
        if (report) writeTest(report, test, result);
        return result;
    };

    // 1. requirements
    try {
        const off = disabledTasks(test.requires, await session.agentSettings().catch(() => ({})));
        if (off.length) {
            result.status = 'skip';
            result.reason = `Laya task${off.length > 1 ? 's' : ''} ${off.join(', ')} disabled in andy's settings (decision_models.tasks)`;
            return finish();
        }
        // 2. andy idle before we start
        let w = await session.waitIdle({ timeout: 60000, grace: 0, settle: 1000 });
        if (w.timedOut) {
            await session.command('!stop', 500);
            w = await session.waitIdle({ timeout: 15000, grace: 0, settle: 1000 });
            if (w.timedOut) throw new StepFailed('andy stayed busy before the test, even after !stop');
        }
        // 3. setup
        await ctx.anchor();
        result.anchor = { x: ctx.vars.x, y: ctx.vars.y, z: ctx.vars.z };
        await runSteps(test.setup || [], ctx, result.steps, 'setup');
        result.before = await session.snapshot('before');
        const keys = chestKeys(test.checks, ctx.vars);
        const needBefore = test.checks.some(c => c.type === 'chest' && c.delta);
        const chestsBefore = needBefore ? (await readChests(session, keys)).items : {};

        // 4. action
        ctx.tAction = session.now();
        await runSteps(test.action, ctx, result.steps, 'action');
        if (test.wait !== false) {
            result.waited = await session.waitIdle({ timeout: Math.max(0, ctx.deadline - session.now()), grace: ctx.defaults.grace, settle: ctx.defaults.settle });
        } else result.waited = { idle: !!session.mind.state()?.action?.isIdle, timedOut: false };

        // 5. checks
        const final = await session.state();
        result.after = await session.snapshot('after');
        const chests = await readChests(session, keys);
        const blocks = await readBlocks(session, test.checks, ctx.vars);
        const now = session.now();
        const evalCtx = {
            snapshots: session.snapshots,
            chat: session.chatSince(ctx.tAction).map(c => c.text),
            logs: session.logs({ since: ctx.t0, until: now, limit: 0, full: true }),
            timeline: session.timelineSince(ctx.tAction, now),
            waited: result.waited, final, chests: chests.items, chestErrors: chests.errors, chestsBefore,
            serverReplies: ctx.serverReplies,
            tester: session.tester?.position?.() || null,
            blocks,
        };
        result.checks = test.checks.map(c => {
            const ec = expand(c, ctx.vars);
            return { ...evaluate(ec, evalCtx), check: describeCheck(ec) };
        });
        result.replies = evalCtx.chat;
        result.chests = chests.items;
        result.inventoryChange = inventoryDiff(result.before.inventory, result.after.inventory);
        result.logs = evalCtx.logs.map(e => brief(e, 200));
        if (Object.keys(blocks).length) result.blocks = blocks;
        const failed = result.checks.filter(c => !c.ok);
        if (failed.length) { result.status = 'fail'; result.reason = failed.map(c => `${c.type}: ${c.reason}`).join('; '); }
        else result.reason = result.checks.map(c => c.reason).join('; ');
    } catch (e) {
        result.status = e instanceof StepFailed ? 'fail' : 'error';
        result.reason = e.message;
        result.replies = session.chatSince(ctx.tAction ?? ctx.t0).map(c => c.text);
        try { result.logs = session.logs({ since: ctx.t0, limit: 0 }).map(e2 => brief(e2, 200)); } catch { /* */ }
    } finally {
        // 6. cleanup
        if (test.cleanup?.length && result.status !== 'skip') {
            ctx.deadline = session.now() + 60000;
            try { await runSteps(test.cleanup, ctx, result.steps, 'cleanup'); } catch (e) { result.cleanupError = e.message; }
        }
    }
    return finish();
}

export async function runSuite(session, tests, { defaults = {}, report = null, onResult = () => {}, onStart = () => {} } = {}) {
    const results = [];
    const started = session.now();
    report?.event({ type: 'suite-start', tests: tests.map(t => t.name) });
    let fatal = null;
    for (const t of tests) {
        if (fatal) {
            const r = { name: t.name, tags: t.tags, status: 'error', ms: 0, reason: `not run: ${fatal}` };
            results.push(r); onResult(r); continue;
        }
        onStart(t);
        const r = await runTest(session, t, { defaults, report });
        results.push(r);
        onResult(r);
        // lost the world or the mindserver: the rest can't run
        if (r.status === 'error' && isConnectionError(r.reason)) fatal = r.reason;
    }
    const summary = {
        pass: results.filter(r => r.status === 'pass').length,
        fail: results.filter(r => r.status === 'fail').length,
        error: results.filter(r => r.status === 'error').length,
        skip: results.filter(r => r.status === 'skip').length,
        ms: session.now() - started,
    };
    summary.share = addShares(results.map(r => r.share));
    report?.event({ type: 'suite-end', summary });
    if (report) writeSummary(report, results, summary);
    const table = summaryRows(results);
    if (report?.json) report.json({ started: brisbaneIso(started), finished: brisbaneIso(session.now()), world: session.config.world || 'settings', summary, tests: table });
    return { summary, results: table.map(({ test, result, seconds, via, command, reason, share }) => ({ name: test, status: result, seconds, via, command, reason, share })), report: report?.paths() };
}

// summaryRows: the machine-readable per-test summary (stable keys, diffed by
// compare.js): test, result (pass|fail|error|skip), seconds, via, command,
// reason.
export function summaryRows(results) {
    return results.map(r => ({
        test: r.name, result: r.status, seconds: +((r.ms || 0) / 1000).toFixed(1),
        via: r.via ?? (r.status === 'skip' ? 'skip' : 'none'), ...(r.command ? { command: r.command } : {}), reason: r.reason || '',
        ...(r.share ? { share: r.share } : {}),
    }));
}

// ---- report sections ----

const fence = s => '```\n' + s + '\n```\n';

export function writeTest(report, test, r) {
    report.event({ type: 'test', ...r });
    const lines = [`## ${r.status.toUpperCase()} ${r.name} (${(r.ms / 1000).toFixed(1)}s)`, ''];
    if (test.description) lines.push(test.description, '');
    lines.push(`- Started: ${r.started.replace('T', ' ').replace('+10:00', ' AEST')}`);
    if (r.anchor) lines.push(`- Andy at: ${r.anchor.x} ${r.anchor.y} ${r.anchor.z}`);
    lines.push(`- Result: ${r.reason || '—'}`);
    if (r.via) lines.push(`- Via: ${r.via}${r.command ? ` (${r.command})` : ''}`);
    if (r.share) lines.push(`- Model share: ${shareBrief(r.share)}`);
    if (r.cleanupError) lines.push(`- Cleanup error: ${r.cleanupError}`);
    lines.push('');
    if (r.steps.length) {
        lines.push('| Part | At | Step | Output |', '|---|---|---|---|');
        for (const s of r.steps) lines.push(`| ${s.part} | ${s.at} | \`${s.step.replace(/\|/g, '\\|')}\` | ${(s.error ? `**${s.error}**` : (s.out || []).join(' / ')).replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 300)} |`);
        lines.push('');
    }
    if (r.share?.total?.decisions) lines.push('Model share (Laya decisions in the window):', '', shareTable(r.share), '');
    if (r.checks.length) {
        lines.push('Checks:', '');
        for (const c of r.checks) lines.push(`- ${c.ok ? 'ok' : '**FAIL**'} ${c.check}: ${c.reason}`);
        lines.push('');
    }
    if (r.replies?.length) lines.push('Andy said:', '', ...r.replies.map(l => `> ${l}`), '');
    if (r.before && r.after) {
        lines.push(`Inventory before: ${fmtInv(r.before.inventory)}`, '', `Inventory after: ${fmtInv(r.after.inventory)}`, '', `Change: ${fmtInv(r.inventoryChange, true)}`, '');
    }
    if (r.blocks) for (const [k, v] of Object.entries(r.blocks)) lines.push(`Blocks ${k}: ${v.error ? 'unread: ' + v.error : `${v.count} around ${v.center.x} ${v.center.y} ${v.center.z}`}`, '');
    if (r.chests && Object.keys(r.chests).length) for (const [k, v] of Object.entries(r.chests)) lines.push(`Chest ${k}: ${fmtInv(v)}`, '');
    if (r.logs?.length) {
        const byTask = {};
        for (const e of r.logs) (byTask[e.task] ||= []).push(e);
        lines.push(`Laya log lines in the window: ${Object.entries(byTask).map(([t, l]) => `${t} ${l.length}`).join(', ')}`, '');
        const show = r.logs.slice(-15).map(e => JSON.stringify(e).slice(0, 400)).join('\n');
        lines.push(fence(show));
    }
    report.md(lines.join('\n') + '\n');
}

const fmtInv = (inv = {}, signed = false) => Object.entries(inv).map(([k, v]) => `${k} ${signed && v > 0 ? '+' : ''}${v}`).join(', ') || 'nothing';

function writeSummary(report, results, s) {
    const lines = [`## Summary`, '', `${s.pass} passed, ${s.fail} failed, ${s.error} errors, ${s.skip} skipped in ${(s.ms / 1000).toFixed(0)}s (finished ${brisbane()}).`, '', '| Test | Result | Seconds | Via | Model share | Why |', '|---|---|---|---|---|---|'];
    for (const r of results) lines.push(`| ${r.name} | ${r.status.toUpperCase()} | ${((r.ms || 0) / 1000).toFixed(1)} | ${r.via || '—'}${r.command ? ` \`${r.command.replace(/\|/g, '\\|')}\`` : ''} | ${r.share ? shareBrief(r.share) : '—'} | ${(r.reason || '').replace(/\|/g, '\\|').slice(0, 200)} |`);
    if (s.share) lines.push('', '### Model share, all tests', '', shareTable(s.share));
    report.md(lines.join('\n') + '\n');
}

