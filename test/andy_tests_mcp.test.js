import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'stream';
import path from 'path';
import { fileURLToPath } from 'url';
import { createHandler, serve } from '../tools/andy-tests/lib/mcp_protocol.js';
import { defineTools, callTool } from '../tools/andy-tests/lib/tools.js';
import { fakeSession, MemReport } from './helpers/andy_fakes.js';

const SCENARIOS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'game/scenarios.json');
const WANTED = ['connect', 'disconnect', 'andy_status', 'andy_say', 'andy_command', 'server_command', 'tester_tp', 'tester_move',
    'andy_wait_idle', 'andy_chat_log', 'andy_logs', 'inventory_snapshot', 'inventory_diff', 'chest_contents', 'list_tests', 'run_test', 'run_suite'];

function setup() {
    const f = fakeSession();
    const tools = defineTools(f.session, { scenariosPath: SCENARIOS, newReport: () => new MemReport() });
    const handle = createHandler({ tools, call: (n, a) => callTool(tools, f.session, n, a), instructions: 'hi' });
    return { ...f, tools, handle };
}

test('initialize, ping, notifications, unknown methods', async () => {
    const { handle } = setup();
    const init = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'x' } } });
    assert.equal(init.result.protocolVersion, '2025-03-26');
    assert.deepEqual(init.result.capabilities, { tools: { listChanged: false } });
    assert.equal(init.result.serverInfo.name, 'andy');
    assert.equal((await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })).result.protocolVersion, '2025-06-18');
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
    assert.deepEqual((await handle({ jsonrpc: '2.0', id: 3, method: 'ping' })).result, {});
    assert.equal((await handle({ jsonrpc: '2.0', id: 4, method: 'nope' })).error.code, -32601);
});

test('tools/list has every tool with an object schema', async () => {
    const { handle } = setup();
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    assert.deepEqual(r.result.tools.map(t => t.name), WANTED);
    for (const t of r.result.tools) {
        assert.equal(t.inputSchema.type, 'object', t.name);
        assert.ok(t.description.length > 20, t.name);
    }
});

test('tools/call runs against the session and logs the call to the session report', async () => {
    const { handle, world, report } = setup();
    world.onCommand = cmd => (cmd === '/time set day' ? ['Set the time to 1000'] : []);
    const call = async (name, args = {}) => {
        const r = await handle({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name, arguments: args } });
        return { isError: r.result.isError, value: r.result.isError ? r.result.content[0].text : JSON.parse(r.result.content[0].text) };
    };
    const st = await call('andy_status');
    assert.equal(st.isError, false);
    assert.deepEqual(st.value.position, { x: 10.5, y: 64, z: -4.5 });
    assert.deepEqual((await call('server_command', { command: '/time set day', wait_ms: 10 })).value.replies, ['Set the time to 1000']);
    world.onMessage = (m, w) => w.after(100, x => x.say(`ok ${m}`));
    assert.deepEqual((await call('andy_command', { command: '!inventory', wait_ms: 500 })).value.replies, ['ok !inventory']);
    assert.deepEqual(world.sent.at(-1), { message: '!inventory', from: 'tester' });
    assert.deepEqual((await call('andy_say', { text: 'andy hi', wait_ms: 500 })).value.replies, ['ok andy hi']);
    assert.deepEqual((await call('tester_tp', { dx: -2 })).value.to, { x: 8.5, y: 64, z: -4.5 });
    assert.equal((await call('andy_chat_log')).value.length, 2);
    await call('inventory_snapshot', { label: 'a' });
    world.give('coal', 2);
    assert.deepEqual((await call('inventory_diff', { from: 'a' })).value.inventory, { coal: 2 });
    world.chests['1 2 3'] = { coal: 5 };
    assert.deepEqual((await call('chest_contents', { x: 1, y: 2, z: 3 })).value.items, { coal: 5 });
    const quick = (await call('list_tests', { tag: 'quick' })).value;
    assert.ok(quick.some(t => t.name === 'setup-world'));
    const bad = await call('chest_contents', { x: 0, y: 0, z: 0 });
    assert.equal(bad.isError, true);
    assert.match(bad.value, /No chest at 0 0 0/);
    assert.equal((await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'zzz' } })).error.code, -32602);

    const tools = report.events.filter(e => e.type === 'tool').map(e => `${e.tool}:${e.ok}`);
    assert.ok(tools.includes('andy_status:true') && tools.includes('chest_contents:false'));
    assert.match(report.text, /`server_command` \{"command":"\/time set day","wait_ms":10\}/);
});

test('run_test and run_suite through MCP', async () => {
    const { handle, world } = setup();
    world.onCommand = cmd => (cmd.startsWith('/time') ? ['Set the time to 1000'] : cmd.startsWith('/gamerule doDaylightCycle') ? ['Gamerule doDaylightCycle is now set to: false'] : []);
    const r = await handle({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'run_test', arguments: { name: 'setup-world' } } });
    const v = JSON.parse(r.result.content[0].text);
    assert.equal(v.status, 'pass', v.reason);
    assert.ok(world.commands.includes('/gamemode creative tester'));
    const s = await handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'run_suite', arguments: { names: ['setup-world'] } } });
    const sv = JSON.parse(s.result.content[0].text);
    assert.equal(sv.summary.pass, 1);
    assert.equal(sv.report.md, '/tmp/fake.md');
    const none = await handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'run_test', arguments: { name: 'nope' } } });
    assert.equal(none.result.isError, true);
    assert.match(none.result.content[0].text, /No test named nope/);
});

test('serve speaks newline-delimited JSON-RPC', async () => {
    const { handle } = setup();
    const input = new PassThrough(), output = new PassThrough();
    let closed = false;
    serve({ handle, input, output, onClose: () => { closed = true; } });
    const got = [];
    output.on('data', d => got.push(...String(d).trim().split('\n').map(l => JSON.parse(l))));
    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) + '\n{bad json}\n');
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    input.end();
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(got.find(m => m.id === 1).result, {});
    assert.equal(got.find(m => m.error)?.error.code, -32700);
    assert.equal(got.length, 2);
    assert.ok(closed);
});
