// The new harness against the frozen contract (test/fixtures/harness-contract).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { io as ioClient, type Socket } from 'socket.io-client';
import { startHarness, type AgentLink } from '../src/harness/server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.resolve(here, '../../../test/fixtures/harness-contract');
const sample = JSON.parse(fs.readFileSync(path.join(FIX, 'full-state.idle.json'), 'utf8')) as { stateUpdate: { andy: Record<string, unknown> }; agentsStatus: unknown[] };

function shape(v: unknown): unknown {
    if (Array.isArray(v)) return 'array';
    if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, shape((v as Record<string, unknown>)[k])]));
    return v === null ? 'null' : typeof v;
}

function fakeAgent(): AgentLink & { messages: [string, string][]; starts: number; inGameFlag: boolean } {
    const a = {
        name: 'andy', messages: [] as [string, string][], starts: 0, inGameFlag: true,
        inGame: () => a.inGameFlag,
        state: () => structuredClone(sample.stateUpdate.andy),
        settings: () => ({ decision_models: { tasks: { mine: { enabled: true } } }, profile: { name: 'andy' } }),
        message: (from: string, m: string) => { a.messages.push([from, m]); },
        start: () => { a.starts++; },
        stop: () => {},
    };
    return a;
}

const once = <T>(s: Socket, ev: string) => new Promise<T>(r => s.once(ev, (...args: unknown[]) => r((args.length > 1 ? args : args[0]) as T)));

test('mindserver contract: agents-status, state-update, send-message, get-settings, start-agent, bot-output', async () => {
    const agent = fakeAgent();
    const h = await startHarness(0, agent, () => {});
    const s = ioClient(`http://localhost:${h.port}`, { reconnection: false });
    try {
        const status = await once<{ name: string; in_game: boolean; socket_connected: boolean }[]>(s, 'agents-status');
        assert.deepEqual(Object.keys(status[0]!).sort(), Object.keys(sample.agentsStatus[0] as object).sort());
        assert.equal(status[0]!.in_game, true);

        s.emit('listen-to-agents');
        const states = await once<Record<string, unknown>>(s, 'state-update');
        assert.deepEqual(shape(states.andy), shape(sample.stateUpdate.andy));

        s.emit('send-message', 'andy', { from: 'tester', message: '!stop' });
        const settings = await new Promise<{ settings?: { decision_models: unknown } }>(r => s.emit('get-settings', 'andy', r));
        assert.ok(settings.settings?.decision_models);
        const missing = await new Promise<{ error?: string }>(r => s.emit('get-settings', 'bob', r));
        assert.equal(missing.error, "Agent 'bob' not found.");
        assert.deepEqual(agent.messages, [['tester', '!stop']]);

        s.emit('start-agent', 'andy');
        await new Promise(r => s.emit('get-settings', 'andy', r));   // in order after start-agent
        const out = once<[string, string]>(s, 'bot-output');
        h.output('Mining 3 iron.');
        assert.deepEqual(await out, ['andy', 'Mining 3 iron.']);
        assert.equal(agent.starts, 1);

        // not in game: no state for the agent, status says so
        agent.inGameFlag = false;
        const st2 = once<{ in_game: boolean }[]>(s, 'agents-status');
        h.statusChanged();
        assert.equal((await st2)[0]!.in_game, false);
        const empty = await once<Record<string, unknown>>(s, 'state-update');
        assert.deepEqual(empty, {});
    } finally {
        s.close();
        await h.close();
    }
});

test('the status page and /state.json are served', async () => {
    const h = await startHarness(0, fakeAgent(), () => {});
    try {
        const page = await (await fetch(`http://localhost:${h.port}/`)).text();
        assert.match(page, /<title>andy status<\/title>/);
        const j = await (await fetch(`http://localhost:${h.port}/state.json`)).json() as { inGame: boolean; state: { action: { isIdle: boolean } } };
        assert.equal(j.inGame, true);
        assert.equal(j.state.action.isIdle, true);
    } finally { await h.close(); }
});
