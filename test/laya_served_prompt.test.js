// The prompt version a task writes comes from the server (laya-go one name per model).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createLayaClient, taskSettings, refreshServed, servedPrompt } from '../src/models/laya.js';
import { nextActivity } from '../src/agent/laya/director.js';

// server answers /v1/models with models and decisions with the header for the current version.
async function server(models) {
    const state = { models };
    const srv = http.createServer((req, res) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            res.setHeader('content-type', 'application/json');
            if (req.url === '/v1/models') return res.end(JSON.stringify({ object: 'list', data: state.models }));
            const { model } = JSON.parse(body);
            const p = state.models.find(m => m.id === model)?.prompt_version;
            if (p) res.setHeader('x-laya-prompt-version', p);
            res.end(JSON.stringify({ model, answers: { Activity: { type: 'choice', probabilities: { continue: 0.01, defend: 0.01, flee: 0.01, eat: 0.01, heal: 0.01, unload: 0.01, resume: 0.01, idle: 0.93 } } } }));
        });
    });
    await new Promise(r => srv.listen(0, '127.0.0.1', r));
    return { url: `http://127.0.0.1:${srv.address().port}`, state, close: () => new Promise(r => srv.close(r)) };
}

const cfgFor = url => ({ servers: { golaya: { url } }, tasks: {
    director: { enabled: true, server: 'golaya', model: 'director', prompt: 'v1', timeout_ms: 1000, min_confidence: 0.5 },
    command: { enabled: true, server: 'golaya', model: 'command', prompt: 'v2.1' },
    eat: { enabled: false, server: 'golaya', model: 'eat' },
} });

const calm = { job: null, paused: null, health: 20, food: 20, armed: 'sword', armor: 0, hostiles: 0, nearest: null, light: 15, night: false,
    under: false, free: 20, home: 40, valuables: 0, foodItems: 3, danger: 'none', last: 'none', player: { name: 'tester', attacked: false, by: 'none', dist: 5 } };

test('the served prompt version wins over the setting; the setting is the fallback', async () => {
    const srv = await server([{ id: 'director', capabilities: ['decisions'], prompt_version: 'v1.2' }, { id: 'command', capabilities: ['decisions'] }]);
    try {
        const cfg = cfgFor(srv.url);
        await refreshServed(srv.url);
        assert.equal(taskSettings('director', () => cfg).prompt, 'v1.2');
        assert.equal(taskSettings('command', () => cfg).prompt, 'v2.1', 'no prompt_version: the setting');
        assert.equal(taskSettings('eat', () => cfg), null);
        assert.equal({ ...taskSettings('director', () => cfg) }.prompt, 'v1.2', 'a copy carries the value');
    } finally { await srv.close(); }
});

test('the director follows a swap: v1 text, then the v1.2 Player line after the server says so', async () => {
    const srv = await server([{ id: 'director', capabilities: ['decisions'], prompt_version: 'v1' }]);
    try {
        const cfg = cfgFor(srv.url);
        await refreshServed(srv.url);
        const task = taskSettings('director', () => cfg); // kept, as the agent keeps it
        const asked = [];
        const real = createLayaClient(() => cfg, { log: () => {} });
        const client = { decide: (t, text, q) => { asked.push(text); return real.decide(t, text, q); } };
        let d = await nextActivity(calm, { client, task });
        assert.equal(d.source, 'model');
        assert.ok(!/\nPlayer /.test(asked[0]), 'v1: no Player line');
        // laya-go replaces director with a v1.2 model; the next decision's header says so.
        srv.state.models = [{ id: 'director', capabilities: ['decisions'], prompt_version: 'v1.2' }];
        await nextActivity(calm, { client, task }); // still written as v1; its answer names v1.2
        assert.equal(servedPrompt(srv.url, 'director'), 'v1.2');
        await nextActivity(calm, { client, task });
        assert.match(asked[2], /\nPlayer tester attacked no/);
    } finally { await srv.close(); }
});

test('laya:check reports the served prompt', async () => {
    const { run } = await import('../src/models/laya_check.js');
    const srv = await server([{ id: 'command', capabilities: ['decisions'], prompt_version: 'v2.2' }]);
    try {
        const lines = [];
        await run(['command'], cfgFor(srv.url), l => lines.push(l));
        assert.match(lines.join('\n'), /uses {5}command, prompt v2\.2 \(served\)/);
    } finally { await srv.close(); }
});
