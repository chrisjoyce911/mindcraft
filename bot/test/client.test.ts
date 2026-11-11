// models/client.ts: ports test/laya_client.test.js and the served-prompt test of
// test/laya_served_prompt.test.js, plus back-off, retry, check and timeout tests. Fake servers only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AddressInfo } from 'node:net';
import {
    LayaClient, normalize, decisionModels, DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, BACKOFF_MIN_MS, BACKOFF_MAX_MS, SERVED_TTL_MS,
    type LayaClientOptions,
} from '../src/models/client.js';
import type { DecisionModelsConfig, Questions, TaskConfig, NoulAnswer, OptionAnswer } from '../src/types/models.js';

// dist/test/client.test.js → repo root is three levels up
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const golden = JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/laya-follow-v1/request.json'), 'utf8')) as { state: string; questions: Questions };
const MOVES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'wait'];
const quiet = () => {};

interface Reply { model?: string; answers: Record<string, Record<string, unknown>>; [k: string]: unknown }
interface FakeOpts {
    models?: Array<Record<string, unknown>>;
    answer?: (body: Record<string, unknown>) => unknown;
    delayMs?: number;
    status?: number;
    promptHeader?: () => string | undefined;
}
interface Fake { url: string; seen: Array<Record<string, unknown>>; raw: string[]; modelsCalls: number; opts: FakeOpts; close: () => Promise<void> }

// fakeServer answers like golaya serve or MLX-Serve.
async function fakeServer(opts: FakeOpts = {}): Promise<Fake> {
    const fake: Fake = { url: '', seen: [], raw: [], modelsCalls: 0, opts, close: async () => {} };
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => setTimeout(() => {
            const o = fake.opts;
            res.setHeader('content-type', 'application/json');
            if (req.url === '/v1/models') {
                fake.modelsCalls++;
                return res.end(JSON.stringify({ object: 'list', data: o.models ?? [{ id: 'follow-a', capabilities: ['decisions'] }] }));
            }
            if (req.url === '/v1/decisions') {
                fake.raw.push(body);
                const parsed = JSON.parse(body) as Record<string, unknown>;
                fake.seen.push(parsed);
                const p = o.promptHeader?.();
                if (p) res.setHeader('x-laya-prompt-version', p);
                res.statusCode = o.status ?? 200;
                return res.end(JSON.stringify(o.answer ? o.answer(parsed) : reply(parsed)));
            }
            res.statusCode = 404;
            res.end('{}');
        }, fake.opts.delayMs ?? 0));
    });
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    fake.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    fake.close = () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); });
    return fake;
}

// reply answers Move with NE at 0.61 and Hazard at 0.12.
function reply(body: Record<string, unknown>): Reply {
    const probabilities = Object.fromEntries(MOVES.map(m => [m, m === 'NE' ? 0.61 : 0.39 / 8]));
    return {
        model: body.model as string,
        answers: {
            Move: { type: 'choice', confidence: 0, action: { act_probability: 1 }, choice: 'NE', probabilities },
            Hazard: { type: 'noul', confidence: 0, action: { act_probability: 1 }, noul: 0.12 },
        },
        usage: { input_tokens: 300, output_tokens: 0 },
    };
}

function config(url: string, task: Partial<TaskConfig> = {}): DecisionModelsConfig {
    return { servers: { golaya: { url } }, tasks: { follow: { enabled: true, server: 'golaya', model: 'follow-a', timeout_ms: 300, min_confidence: 0.4, ...task } } };
}

// client makes a client with a low timeout floor, so the timeout tests stay fast.
const client = (getConfig: () => DecisionModelsConfig | undefined, opts: Partial<LayaClientOptions> = {}) =>
    new LayaClient({ getConfig, log: quiet, minTimeoutMs: 50, ...opts });

const move = (r: { answers: Record<string, unknown> } | null) => r!.answers.Move as OptionAnswer;
const hazard = (r: { answers: Record<string, unknown> } | null) => r!.answers.Hazard as NoulAnswer;

test('default-off config sends nothing; disabled is not counted as asked', async () => {
    let calls = 0;
    const cfg: DecisionModelsConfig = { servers: { golaya: { url: 'http://127.0.0.1:9' } }, tasks: {
        follow: { enabled: false, server: 'golaya', model: 'follow' }, director: { enabled: false, server: 'golaya', model: 'director' } } };
    const c = client(() => cfg, { fetch: async () => { calls++; throw new Error('no'); } });
    assert.equal(await c.decide('follow', golden.state, golden.questions), null);
    assert.equal(c.stats('follow').failed.disabled, 1);
    assert.equal(c.stats('follow').asked, 0);
    assert.equal(calls, 0);
    assert.equal(await new LayaClient({ getConfig: () => undefined, log: quiet }).decide('follow', 's', {}), null);
});

test('choice and noul answers in the normal form; the request is the golden request', async () => {
    const srv = await fakeServer();
    try {
        const c = client(() => config(srv.url));
        const r = await c.decide('follow', golden.state, golden.questions);
        assert.ok(r);
        assert.equal(r.model, 'follow-a');
        assert.equal(move(r).top, 'NE');
        assert.equal(move(r).topProbability, 0.61);
        assert.equal(move(r).confident, true);
        assert.equal(Object.keys(move(r).probabilities).length, 9);
        assert.equal(hazard(r).probability, 0.12);
        assert.equal(hazard(r).top, 'false');
        assert.equal(hazard(r).confident, true);
        assert.deepEqual(srv.seen[0], { ...golden, model: 'follow-a' });
        // byte for byte, keys in the old order {model, questions, state}
        assert.equal(srv.raw[0], JSON.stringify({ model: 'follow-a', questions: golden.questions, state: golden.state }));
    } finally { await srv.close(); }
});

test('below min_confidence is reported, not hidden', async () => {
    const srv = await fakeServer();
    try {
        const r = await client(() => config(srv.url, { min_confidence: 0.7 })).decide('follow', golden.state, golden.questions);
        assert.equal(move(r).confident, false);
    } finally { await srv.close(); }
});

test('swapping server and model is a settings change', async () => {
    const a = await fakeServer(), b = await fakeServer({ models: [{ id: 'aac6fef/laya-mlx', capabilities: ['decisions'] }] });
    try {
        let cfg = config(a.url);
        const c = client(() => cfg);
        await c.decide('follow', golden.state, golden.questions);
        cfg = { servers: { mlx: { url: b.url } }, tasks: { follow: { ...cfg.tasks.follow!, server: 'mlx', model: 'aac6fef/laya-mlx' } } };
        await c.decide('follow', golden.state, golden.questions);
        assert.equal(a.seen.length, 1);
        assert.equal(b.seen.length, 1);
        assert.equal(b.seen[0]!.model, 'aac6fef/laya-mlx');
    } finally { await a.close(); await b.close(); }
});

test('discovery picks the only decisions model from a mixed list, once per server', async () => {
    const srv = await fakeServer({ models: [
        { id: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit', capabilities: ['chat', 'tool_use'] },
        { id: 'aac6fef/laya-mlx', capabilities: ['decisions'] },
        { id: 'mlx-community/Qwen3-Coder-30B', capabilities: ['chat'] },
    ] });
    try {
        const c = client(() => config(srv.url, { model: '' }));
        assert.ok(await c.decide('follow', golden.state, golden.questions));
        assert.ok(await c.decide('follow', golden.state, golden.questions));
        assert.equal(srv.seen[0]!.model, 'aac6fef/laya-mlx');
        assert.equal(srv.modelsCalls, 1);
    } finally { await srv.close(); }
});

test('no decisions model, or several, is no_model', async () => {
    for (const models of [[{ id: 'chat', capabilities: ['chat'] }], [{ id: 'a', capabilities: ['decisions'] }, { id: 'b', capabilities: ['decisions'] }]]) {
        const srv = await fakeServer({ models });
        try {
            const c = client(() => config(srv.url, { model: '' }));
            assert.equal(await c.decide('follow', golden.state, golden.questions), null);
            assert.equal(c.stats('follow').failed.no_model, 1);
        } finally { await srv.close(); }
    }
});

test('failures return null with their reason and never throw', async () => {
    const cases: Array<[string, FakeOpts]> = [
        ['timeout', { delayMs: 500 }],
        ['http', { status: 500 }],
        ['malformed', { answer: b => { const r = reply(b); delete r.answers.Hazard; return r; } }],
        ['malformed', { answer: b => { const r = reply(b); r.answers.Move!.type = 'noul'; return r; } }],
        ['malformed', { answer: () => 'not an object' }],
    ];
    for (const [reason, opts] of cases) {
        const srv = await fakeServer(opts);
        try {
            const c = client(() => config(srv.url, { timeout_ms: 100 }));
            assert.equal(await c.decide('follow', golden.state, golden.questions), null, reason);
            assert.equal(c.stats('follow').failed[reason as 'http'], 1, reason);
        } finally { await srv.close(); }
    }
    const c = client(() => config('http://127.0.0.1:9'));
    assert.equal(await c.decide('follow', golden.state, golden.questions), null);
    assert.equal(c.stats('follow').failed.unreachable, 1);
    assert.equal(await c.decide('unknown-task', 's', {}), null);
    assert.equal(c.stats('unknown-task').failed.disabled, 1);
});

test('a reply that is not JSON is malformed', async () => {
    const c = client(() => config('http://x'), { fetch: async () => new Response('<html>', { status: 200 }) });
    assert.equal(await c.decide('follow', golden.state, golden.questions), null);
    assert.equal(c.stats('follow').failed.malformed, 1);
});

test('counters', async () => {
    let slow = false;
    const srv = await fakeServer();
    const slowSrv = await fakeServer({ delayMs: 500 });
    try {
        const c = client(() => config(slow ? slowSrv.url : srv.url, { timeout_ms: 100 }));
        await c.decide('follow', golden.state, golden.questions);
        await c.decide('follow', golden.state, golden.questions);
        slow = true;
        await c.decide('follow', golden.state, golden.questions);
        const s = c.stats('follow');
        assert.equal(s.asked, 3);
        assert.equal(s.answered, 2);
        assert.equal(s.failed.timeout, 1);
        assert.ok(s.meanMs >= 0 && s.maxMs >= s.meanMs);
    } finally { await srv.close(); await slowSrv.close(); }
});

test('an unreachable server is asked again once at once; a blip does not fail the decision', async () => {
    const srv = await fakeServer();
    try {
        let calls = 0;
        const c = client(() => config(srv.url), {
            fetch: async (url, init) => { if (++calls === 1) throw new TypeError('fetch failed'); return fetch(url, init); },
        });
        assert.ok(await c.decide('follow', golden.state, golden.questions));
        assert.equal(calls, 2);
        assert.equal(c.stats('follow').failed.unreachable, 0);
    } finally { await srv.close(); }
});

test('back-off: 1 s doubling to 10 s, no request while backing off, logged on enter and leave', async () => {
    let t = 1_000_000, calls = 0, up = false;
    const lines: string[] = [];
    const srv = await fakeServer();
    try {
        const c = client(() => config(srv.url), {
            now: () => t, log: l => lines.push(l),
            fetch: async (url, init) => { calls++; if (!up) throw new TypeError('fetch failed'); return fetch(url, init); },
        });
        assert.equal(await c.decide('follow', golden.state, golden.questions), null);
        assert.equal(calls, 2, 'tried twice');
        assert.ok(lines.some(l => l.includes(`unreachable`) && l.includes(`asking again in ${BACKOFF_MIN_MS / 1000} s`)), lines.join('\n'));
        // within the back-off: no request
        t += 500;
        assert.equal(await c.decide('follow', golden.state, golden.questions), null);
        assert.equal(calls, 2);
        assert.equal(c.stats('follow').failed.unreachable, 2);
        // the back-off doubles each time the server is still down, to the cap
        const waits: number[] = [];
        for (let i = 0; i < 6; i++) {
            t += 20_000;
            lines.length = 0;
            await c.decide('follow', golden.state, golden.questions);
            const m = lines.join('\n').match(/asking again in (\d+) s/);
            waits.push(Number(m?.[1]));
        }
        assert.deepEqual(waits, [2, 4, 8, 10, 10, 10]);
        assert.ok(BACKOFF_MAX_MS === 10_000);
        // the server is back: the next try after the back-off answers and logs it
        up = true;
        t += 20_000;
        lines.length = 0;
        assert.ok(await c.decide('follow', golden.state, golden.questions));
        assert.ok(lines.some(l => l === `[laya] ${srv.url}: reachable again`), lines.join('\n'));
    } finally { await srv.close(); }
});

test('a task failure reason is logged at most once a minute, with the [laya] prefix', async () => {
    let t = 0;
    const lines: string[] = [];
    const srv = await fakeServer({ status: 500 });
    try {
        const c = client(() => config(srv.url), { now: () => t, log: l => lines.push(l) });
        await c.decide('follow', golden.state, golden.questions);
        await c.decide('follow', golden.state, golden.questions);
        assert.equal(lines.filter(l => l.startsWith('[laya] follow: http (HTTP 500')).length, 1);
        t += 61_000;
        await c.decide('follow', golden.state, golden.questions);
        assert.equal(lines.filter(l => l.startsWith('[laya] follow: http')).length, 2);
    } finally { await srv.close(); }
});

test('timeouts: 5 s when unset, a setting below 2.5 s raised to it and logged once, higher settings kept', async () => {
    const lines: string[] = [];
    const cfg: DecisionModelsConfig = { servers: { golaya: { url: 'http://x' } }, tasks: {
        a: { enabled: true, server: 'golaya', model: 'a' },
        b: { enabled: true, server: 'golaya', model: 'b', timeout_ms: 300 },
        c: { enabled: true, server: 'golaya', model: 'c', timeout_ms: 8000 } } };
    const c = new LayaClient({ getConfig: () => cfg, log: l => lines.push(l) });
    assert.equal(DEFAULT_TIMEOUT_MS, 5000);
    assert.equal(MIN_TIMEOUT_MS, 2500);
    assert.equal(c.timeoutFor('a'), 5000);
    assert.equal(c.timeoutFor('b'), 2500);
    assert.equal(c.timeoutFor('b'), 2500);
    assert.equal(c.timeoutFor('c'), 8000);
    assert.equal(c.timeoutFor('nope'), null);
    assert.deepEqual(lines, ['[laya] b: timeout_ms 300 raised to 2500 (measured latency)']);
});

test('decide waits the effective timeout (observed through the abort signal)', async () => {
    let t0 = 0, abortedAfter = -1;
    const c = new LayaClient({ getConfig: () => config('http://x', { timeout_ms: 20 }), log: quiet, minTimeoutMs: 120,
        fetch: (_url, init) => new Promise((_res, rej) => {
            t0 = Date.now();
            init!.signal!.addEventListener('abort', () => { abortedAfter = Date.now() - t0; rej(new DOMException('aborted', 'AbortError')); });
        }) });
    assert.equal(await c.decide('follow', golden.state, golden.questions), null);
    assert.equal(c.stats('follow').failed.timeout, 1);
    assert.ok(abortedAfter >= 100 && abortedAfter < 1000, `aborted after ${abortedAfter} ms`);
});

test('the served prompt version wins over the setting; the setting is the fallback', async () => {
    const srv = await fakeServer({ models: [{ id: 'director', capabilities: ['decisions'], prompt_version: 'v1.2' }, { id: 'command', capabilities: ['decisions'] }] });
    try {
        const cfg: DecisionModelsConfig = { servers: { golaya: { url: srv.url } }, tasks: {
            director: { enabled: true, server: 'golaya', model: 'director', prompt: 'v1', timeout_ms: 1000, min_confidence: 0.5 },
            command: { enabled: true, server: 'golaya', model: 'command', prompt: 'v2.1' },
            eat: { enabled: false, server: 'golaya', model: 'eat', prompt: 'v1' } } };
        const c = client(() => cfg);
        assert.equal(c.promptFor('director'), 'v1', 'nothing read yet: the setting');
        await c.primeServedPrompts();
        assert.equal(c.promptFor('director'), 'v1.2');
        assert.equal(c.promptFor('command'), 'v2.1', 'no prompt_version: the setting');
        assert.equal(c.promptFor('eat'), undefined, 'disabled');
        // the served cache belongs to the client, not the module
        assert.equal(client(() => cfg).promptFor('director'), 'v1');
    } finally { await srv.close(); }
});

test('the decision header names a swapped model\'s prompt version for the next decision', async () => {
    let version = 'v1';
    const srv = await fakeServer({ models: [{ id: 'follow-a', capabilities: ['decisions'], prompt_version: 'v1' }], promptHeader: () => version });
    try {
        const c = client(() => config(srv.url, { prompt: 'v0' }));
        await c.refreshServed(srv.url);
        assert.equal(c.promptFor('follow'), 'v1');
        version = 'v1.2'; // laya-go swaps the model
        await c.decide('follow', golden.state, golden.questions);
        assert.equal(c.promptFor('follow'), 'v1.2');
    } finally { await srv.close(); }
});

test('served prompt versions are read again after the TTL, and a failed read also waits it', async () => {
    let t = 0, reads = 0, fail = false;
    const c = client(() => config('http://x'), {
        now: () => t,
        fetch: async () => {
            reads++;
            if (fail) throw new TypeError('fetch failed');
            return new Response(JSON.stringify({ data: [{ id: 'follow-a', capabilities: ['decisions'], prompt_version: `v${reads}` }] }));
        },
    });
    await c.refreshServed('http://x');
    assert.equal(c.promptFor('follow'), 'v1');
    t += SERVED_TTL_MS / 2;
    c.promptFor('follow');
    assert.equal(reads, 1, 'fresh: no read');
    t += SERVED_TTL_MS;
    assert.equal(c.promptFor('follow'), 'v1', 'stale: the last value, refreshed in the background');
    await c.refreshServed('http://x'); // joins the background read
    assert.equal(reads, 2);
    assert.equal(c.promptFor('follow'), 'v2');
    fail = true;
    t += SERVED_TTL_MS + 1;
    await assert.rejects(c.refreshServed('http://x'));
    const after = reads;
    t += 1000;
    c.promptFor('follow');
    await new Promise(r => setImmediate(r));
    assert.equal(reads, after, 'a failed read waits the TTL too');
});

test('check reports the server, models, model, served prompt and a sample answer', async () => {
    const srv = await fakeServer({ models: [{ id: 'chat', capabilities: ['chat'] }, { id: 'follow-a', capabilities: ['decisions'], prompt_version: 'v1' }] });
    try {
        const r = await client(() => config(srv.url)).check('follow', golden);
        assert.equal(r.reachable, true);
        assert.equal(r.enabled, true);
        assert.deepEqual(r.models, ['follow-a']);
        assert.equal(r.model, 'follow-a');
        assert.equal(r.prompt, 'v1');
        assert.equal(r.error, null);
        assert.equal((r.answer!.answers.Move as OptionAnswer).top, 'NE');
        assert.equal((r.answer!.answers.Hazard as NoulAnswer).probability, 0.12);
        assert.deepEqual(srv.seen[0], { ...golden, model: 'follow-a' });
    } finally { await srv.close(); }
    const down = await client(() => config('http://127.0.0.1:9')).check('follow');
    assert.equal(down.reachable, false);
    assert.ok(down.error);
    const missing = await client(() => config('http://127.0.0.1:9')).check('farm');
    assert.match(missing.error!, /not configured/);
});

test('normalize: noul from probabilities.true, choice over a criteria map, missing option is null', () => {
    const noul = normalize({ type: 'noul', criteria: null }, { type: 'noul', probabilities: { true: 0.8 } }, 0.7) as NoulAnswer;
    assert.deepEqual(noul, { type: 'noul', probability: 0.8, top: 'true', topProbability: 0.8, confident: true });
    const score = normalize({ type: 'score', criteria: { low: 'x', high: 'y' } }, { type: 'score', probabilities: { low: 0.3, high: 0.7 } }, 0) as OptionAnswer;
    assert.equal(score.top, 'high');
    assert.equal(normalize({ type: 'choice', criteria: ['a', 'b'] }, { type: 'choice', probabilities: { a: 1 } }, 0), null);
    assert.equal(normalize({ type: 'choice', criteria: [] }, { type: 'choice', probabilities: {} }, 0), null);
    assert.equal(normalize({ type: 'noul', criteria: null }, null, 0), null);
});

test('decisionModels reads settings.decision_models into the typed config', () => {
    const cfg = decisionModels({ decision_models: {
        servers: { golaya: { url: 'http://127.0.0.1:11235' }, bad: { url: 3 } },
        tasks: { director: { enabled: true, server: 'golaya', model: 'director', prompt: 'v1.3', timeout_ms: 300, min_confidence: 0.5 },
            eat: { enabled: 'yes', server: 'golaya' }, junk: 'x' } } });
    assert.deepEqual(cfg, {
        servers: { golaya: { url: 'http://127.0.0.1:11235' } },
        tasks: { director: { enabled: true, server: 'golaya', model: 'director', prompt: 'v1.3', timeout_ms: 300, min_confidence: 0.5 },
            eat: { enabled: false, server: 'golaya' } } });
    assert.equal(decisionModels({}), undefined);
});
