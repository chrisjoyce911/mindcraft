import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createLayaClient } from '../src/models/laya.js';
import { run as runCheck, loadSample } from '../src/models/laya_check.js';
import rootSettings from '../settings.js';

const golden = JSON.parse(readFileSync(new URL('./fixtures/laya-follow-v1/request.json', import.meta.url), 'utf8'));
const MOVES = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'wait'];

// fakeServer answers like golaya serve or MLX-Serve. answer(body) returns the
// decisions reply; models is the /v1/models list; delayMs slows every reply.
async function fakeServer({ models = [{ id: 'follow-a', capabilities: ['decisions'] }], answer, delayMs = 0, status = 200 } = {}) {
    const seen = [];
    const server = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => setTimeout(() => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/v1/models') return res.end(JSON.stringify({ object: 'list', data: models }));
            if (req.url === '/v1/decisions') {
                const parsed = JSON.parse(body);
                seen.push(parsed);
                res.statusCode = status;
                return res.end(JSON.stringify(answer ? answer(parsed) : reply(parsed)));
            }
            res.statusCode = 404;
            res.end('{}');
        }, delayMs));
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${server.address().port}`;
    return { url, seen, close: () => new Promise(r => server.close(r)) };
}

// reply answers Move with NE at 0.61 and Hazard at 0.12.
function reply(body) {
    const probabilities = Object.fromEntries(MOVES.map(m => [m, m === 'NE' ? 0.61 : 0.39 / 8]));
    return {
        model: body.model,
        answers: {
            Move: { type: 'choice', confidence: 0, action: { act_probability: 1 }, choice: 'NE', probabilities },
            Hazard: { type: 'noul', confidence: 0, action: { act_probability: 1 }, noul: 0.12 },
        },
        usage: { input_tokens: 300, output_tokens: 0 },
    };
}

function config(url, task = {}) {
    return { servers: { golaya: { url } }, tasks: { follow: { enabled: true, server: 'golaya', model: 'follow-a', timeout_ms: 300, min_confidence: 0.4, ...task } } };
}

test('default settings send nothing', async () => {
    assert.equal(rootSettings.decision_models.tasks.follow.enabled, false);
    for (const t of Object.values(rootSettings.decision_models.tasks)) assert.equal(t.enabled, false);
    const client = createLayaClient(() => rootSettings.decision_models, { log: () => {} });
    assert.equal(await client.decide('follow', golden.state, golden.questions), null);
    assert.equal(client.stats('follow').failed.disabled, 1);
    assert.equal(client.stats('follow').asked, 0);
});

test('choice and noul answers in the normal form', async () => {
    const srv = await fakeServer();
    try {
        const client = createLayaClient(() => config(srv.url), { log: () => {} });
        const r = await client.decide('follow', golden.state, golden.questions);
        assert.equal(r.model, 'follow-a');
        assert.equal(r.answers.Move.top, 'NE');
        assert.equal(r.answers.Move.topProbability, 0.61);
        assert.equal(r.answers.Move.confident, true);
        assert.equal(Object.keys(r.answers.Move.probabilities).length, 9);
        assert.equal(r.answers.Hazard.probability, 0.12);
        assert.equal(r.answers.Hazard.top, 'false');
        assert.equal(r.answers.Hazard.confident, true);
        // the request is exactly laya-go's golden request, with the task's model
        assert.deepEqual(srv.seen[0], { ...golden, model: 'follow-a' });
    } finally { await srv.close(); }
});

test('below min_confidence is reported, not hidden', async () => {
    const srv = await fakeServer();
    try {
        const client = createLayaClient(() => config(srv.url, { min_confidence: 0.7 }), { log: () => {} });
        const r = await client.decide('follow', golden.state, golden.questions);
        assert.equal(r.answers.Move.confident, false);
    } finally { await srv.close(); }
});

test('swapping server and model is a settings change', async () => {
    const a = await fakeServer(), b = await fakeServer({ models: [{ id: 'aac6fef/laya-mlx', capabilities: ['decisions'] }] });
    try {
        let cfg = config(a.url);
        const client = createLayaClient(() => cfg, { log: () => {} });
        await client.decide('follow', golden.state, golden.questions);
        cfg = { servers: { mlx: { url: b.url } }, tasks: { follow: { ...cfg.tasks.follow, server: 'mlx', model: 'aac6fef/laya-mlx' } } };
        await client.decide('follow', golden.state, golden.questions);
        assert.equal(a.seen.length, 1);
        assert.equal(b.seen.length, 1);
        assert.equal(b.seen[0].model, 'aac6fef/laya-mlx');
    } finally { await a.close(); await b.close(); }
});

test('discovery picks the only decisions model from a mixed list', async () => {
    const srv = await fakeServer({ models: [
        { id: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit', capabilities: ['chat', 'tool_use'] },
        { id: 'aac6fef/laya-mlx', capabilities: ['decisions'] },
        { id: 'mlx-community/Qwen3-Coder-30B', capabilities: ['chat'] },
    ] });
    try {
        const client = createLayaClient(() => config(srv.url, { model: '' }), { log: () => {} });
        const r = await client.decide('follow', golden.state, golden.questions);
        assert.ok(r);
        assert.equal(srv.seen[0].model, 'aac6fef/laya-mlx');
    } finally { await srv.close(); }
});

test('no decisions model, or several, is no_model', async () => {
    for (const models of [[{ id: 'chat', capabilities: ['chat'] }], [{ id: 'a', capabilities: ['decisions'] }, { id: 'b', capabilities: ['decisions'] }]]) {
        const srv = await fakeServer({ models });
        try {
            const client = createLayaClient(() => config(srv.url, { model: '' }), { log: () => {} });
            assert.equal(await client.decide('follow', golden.state, golden.questions), null);
            assert.equal(client.stats('follow').failed.no_model, 1);
        } finally { await srv.close(); }
    }
});

test('failures return null with their reason and never throw', async () => {
    const cases = [
        ['timeout', { delayMs: 500 }],
        ['http', { status: 500 }],
        ['malformed', { answer: b => { const r = reply(b); delete r.answers.Hazard; return r; } }],
        ['malformed', { answer: b => { const r = reply(b); r.answers.Move.type = 'noul'; return r; } }],
    ];
    for (const [reason, opts] of cases) {
        const srv = await fakeServer(opts);
        try {
            const client = createLayaClient(() => config(srv.url), { log: () => {} });
            assert.equal(await client.decide('follow', golden.state, golden.questions), null, reason);
            assert.equal(client.stats('follow').failed[reason], 1, reason);
        } finally { await srv.close(); }
    }
    const client = createLayaClient(() => config('http://127.0.0.1:9'), { log: () => {} });
    assert.equal(await client.decide('follow', golden.state, golden.questions), null);
    assert.equal(client.stats('follow').failed.unreachable, 1);
    assert.equal(await client.decide('unknown-task', 's', {}), null);
    assert.equal(client.stats('unknown-task').failed.disabled, 1);
});

test('counters', async () => {
    let slow = false;
    const srv = await fakeServer();
    const slowSrv = await fakeServer({ delayMs: 500 });
    try {
        const client = createLayaClient(() => config(slow ? slowSrv.url : srv.url), { log: () => {} });
        await client.decide('follow', golden.state, golden.questions);
        await client.decide('follow', golden.state, golden.questions);
        slow = true;
        await client.decide('follow', golden.state, golden.questions);
        const s = client.stats('follow');
        assert.equal(s.asked, 3);
        assert.equal(s.answered, 2);
        assert.equal(s.failed.timeout, 1);
        assert.ok(s.meanMs >= 0 && s.maxMs >= s.meanMs);
    } finally { await srv.close(); await slowSrv.close(); }
});

test('laya:check reports the follow sample', async () => {
    const srv = await fakeServer({ models: [
        { id: 'chat', capabilities: ['chat'] }, { id: 'follow-a', capabilities: ['decisions'] }] });
    try {
        const lines = [];
        const status = await runCheck(['follow'], config(srv.url), l => lines.push(l));
        const report = lines.join('\n');
        assert.equal(status, 0);
        assert.match(report, /reachable/);
        assert.match(report, /models\s+follow-a/);
        assert.match(report, /sample .*Move NE 0\.61/);
        assert.match(report, /sample .*Hazard 0\.12/);
        assert.match(report, /sample .* in \d+ ms/);
        assert.deepEqual(srv.seen[0], { ...loadSample('follow'), model: 'follow-a' });
    } finally { await srv.close(); }
    const lines = [];
    assert.equal(await runCheck(['follow'], config('http://127.0.0.1:9'), l => lines.push(l)), 1);
    assert.match(lines.join('\n'), /NOT reachable/);
    assert.equal(await runCheck(['follow'], { ...config('http://127.0.0.1:9'), tasks: { follow: { ...config('x').tasks.follow, enabled: false, server: 'golaya' } } }, () => {}), 0);
});
