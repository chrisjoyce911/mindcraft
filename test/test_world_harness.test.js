/* eslint-disable require-await -- fakes mirror async interfaces */
// The harness on the test world: the world target, server commands over
// RCON, the site step and {site:…} templates, the world/bot MCP tools.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeConfig, useWorld } from '../tools/andy-tests/lib/config.js';
import { expand, parseScenarios, loadScenarios } from '../tools/andy-tests/lib/scenarios.js';
import { runTest } from '../tools/andy-tests/lib/runner.js';
import { defineTools, callTool } from '../tools/andy-tests/lib/tools.js';
import { fakeSession, FakeWorld, MemReport } from './helpers/andy_fakes.js';

const SCENARIOS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'game/scenarios.json');
const SITES = { seed: '1', sites: { base: { x: 166, y: 70, z: 169 }, farm: { x: 208, y: 63, z: 149 } } };

// fakeTestWorld: a TestWorld-like with RCON that moves andy on /tp.
function withTestWorld(f, { rconFails = false, botRunning = false } = {}) {
    const rcon = [];
    const calls = [];
    const world = {
        sites: SITES,
        command: async cmd => {
            if (rconFails) throw new Error('RCON connection closed');
            rcon.push(cmd);
            const m = cmd.match(/^\/?tp (\w+) (\S+) (\S+) (\S+)/);
            if (m && m[1] === 'andy') f.world.andy.gameplay.position = { x: +m[2], y: +m[3], z: +m[4] };
            if (m && m[1] === 'tester') f.world.tester = { x: +m[2], y: +m[3], z: +m[4] };
            return m ? `Teleported ${m[1]} to ${m[2]}, ${m[3]}, ${m[4]}` : cmd.includes('time') ? 'Set the time to 1000' : '';
        },
        status: async () => { calls.push('status'); return { state: 'running', ready: true }; },
        start: async () => { calls.push('start'); return { started: true, ready: true, ms: 9000 }; },
        stop: async () => { calls.push('stop'); return { stopped: true, ms: 1000 }; },
        reset: async () => { calls.push('reset'); return { reset: true, ms: 7000 }; },
    };
    const bot = {
        status: () => ({ running: botRunning, pid: botRunning ? 1 : null }),
        start: o => { calls.push(['bot.start', o]); botRunning = true; return { started: true, pid: 1, log: '/d/logs/bot.log' }; },
        stop: async () => { calls.push('bot.stop'); botRunning = false; return { stopped: true }; },
    };
    f.session.deps.makeWorld = async () => world;
    f.session.deps.makeBot = async () => bot;
    f.mind.restartAgent = async () => { calls.push('start-agent'); return { inGame: true, tries: 1 }; };
    return { rcon, calls };
}

test('config: ANDY_WORLD=test targets the local test world; useWorld switches back', () => {
    const settings = { host: '192.168.1.5', port: -1, mindserver_port: 8090, minecraft_version: '1.21.6' };
    const c = makeConfig(settings, { ANDY_WORLD: 'test', TEST_WORLD_DATA: '/d' });
    assert.deepEqual([c.world, c.host, c.port, c.mindserverPort, c.version], ['test', '127.0.0.1', 25566, 8091, '1.21.6']);
    assert.equal(useWorld(c, 'settings'), true);
    assert.deepEqual([c.world, c.host, c.port, c.mindserverPort], ['settings', '192.168.1.5', -1, 8090]);
    assert.equal(useWorld(c, 'settings'), false);
    assert.throws(() => useWorld(c, 'moon'), /Unknown world/);
    assert.throws(() => makeConfig(settings, { ANDY_WORLD: 'lan' }), /ANDY_WORLD/);
    assert.equal(makeConfig(settings, {}).world, 'settings');
});

test('server commands: RCON on the test world, tester for ~ and @s, tester when RCON fails or off the test world', async () => {
    const f = fakeSession();
    const { rcon } = withTestWorld(f);
    let r = await f.session.serverCommand('/time set day');
    assert.equal(r.via, 'tester'); // still on settings.js's world
    f.session.useWorld('test');
    r = await f.session.serverCommand('/time set day');
    assert.deepEqual(r, { command: '/time set day', via: 'rcon', replies: ['Set the time to 1000'] });
    assert.deepEqual(rcon, ['/time set day']);
    r = await f.session.serverCommand('/summon husk ~5 ~ ~');
    assert.equal(r.via, 'tester');
    assert.ok(f.world.commands.includes('/summon husk ~5 ~ ~'));

    const g = fakeSession();
    withTestWorld(g, { rconFails: true });
    g.session.useWorld('test');
    r = await g.session.serverCommand('/time set day');
    assert.equal(r.via, 'tester');
    assert.match(r.rconError, /closed/);
});

test('useWorld drops the connections to the old world', async () => {
    const f = fakeSession();
    await f.session.connect();
    assert.ok(f.session.mind && f.session.tester);
    const r = f.session.useWorld('test');
    assert.deepEqual([r.world, r.was, r.minecraft, r.mindserver], ['test', 'settings', '127.0.0.1:25566', 'http://localhost:8091']);
    assert.equal(f.session.mind, null);
    assert.equal(f.session.tester, null);
});

test('siteTp: andy and tester beside him on the test world, skipped elsewhere', async () => {
    const f = fakeSession();
    withTestWorld(f);
    assert.deepEqual(await f.session.siteTp('farm'), { skipped: true, reason: 'not the test world (use world_start or ANDY_WORLD=test)' });
    f.session.useWorld('test');
    const r = await f.session.siteTp('farm');
    assert.deepEqual(r.at, { x: 208, y: 63, z: 149 });
    assert.deepEqual(f.world.andy.gameplay.position, { x: 208.5, y: 63, z: 149.5 });
    assert.deepEqual(f.world.tester, { x: 210.5, y: 63, z: 149.5 });
    await assert.rejects(f.session.siteTp('moon'), /No site "moon". Sites: base, farm/);
    await f.session.siteTp('base', { who: 'tester' });
    assert.deepEqual(f.world.tester, { x: 166.5, y: 70, z: 169.5 });
    assert.deepEqual(f.world.andy.gameplay.position, { x: 208.5, y: 63, z: 149.5 });
});

test('site templates expand on the test world only', () => {
    const sites = SITES.sites;
    assert.equal(expand('/tp {andy} {site:farm}', { andy: 'andy', sites }), '/tp andy 208 63 149');
    assert.equal(expand('/setblock {site:base.x+3} {site:base.y} {site:base.z-1} chest', { sites }), '/setblock 169 70 168 chest');
    assert.equal(expand('{site:farm}', {}), '{site:farm}');
    assert.equal(expand('{site:nope.x}', { sites }), '{site:nope.x}');
});

const siteDoc = (setup = [{ site: 'farm' }, { cmd: '/setblock {x+3} {y} {z} chest' }, { cmd: '/give {andy} bread {site:farm.y}' }]) => JSON.stringify({ tests: [{
    name: 'farm-here', setup, action: [{ andy: '!inventory' }], wait: false, checks: [],
}] });

test('the site step re-anchors {x} {y} {z} at the site on the test world', async () => {
    const f = fakeSession(new FakeWorld({ pos: { x: 10.5, y: 64, z: -4.5 } }));
    const { rcon } = withTestWorld(f);
    f.session.useWorld('test');
    const { tests, defaults } = parseScenarios(siteDoc());
    const r = await runTest(f.session, tests[0], { defaults });
    assert.equal(r.status, 'pass', r.reason);
    assert.ok(rcon.includes('/setblock 211 63 149 chest'), rcon.join(' | '));
    assert.ok(rcon.includes('/give andy bread 63'));
    assert.match(r.steps[0].out[0], /at 208 63 149/);
});

test('the site step does nothing on another world; the test runs where andy is', async () => {
    const f = fakeSession(new FakeWorld({ pos: { x: 10.5, y: 64, z: -4.5 } }));
    withTestWorld(f);
    const { tests, defaults } = parseScenarios(siteDoc([{ site: 'farm' }, { cmd: '/setblock {x+3} {y} {z} chest' }]));
    const r = await runTest(f.session, tests[0], { defaults });
    assert.equal(r.status, 'pass', r.reason);
    assert.match(r.steps[0].out[0], /skipped: not the test world/);
    assert.ok(f.world.commands.includes('/setblock 13 64 -5 chest'));
});

test('every scenario starts at a site (after an optional world reset), and the file still validates', () => {
    const { tests } = loadScenarios(SCENARIOS);
    // a chores test may first stop andy's own chore, so the site teleport lands
    const quiet = s => s.reset || s.andy === '!layaChores("off")' || s.andy === '!stop';
    const first = t => t.setup.find(s => !quiet(s));
    for (const t of tests) assert.ok(first(t)?.site, t.name);
    for (const t of tests) assert.ok(t.setup.findIndex(s => s.reset) <= 0, `${t.name}: a reset comes first`);
    assert.equal(first(tests.find(t => t.name === 'farm-water')).site, 'farm');
    assert.equal(first(tests.find(t => t.name === 'farm-no-water')).site, 'dry');
    assert.equal(first(tests.find(t => t.name === 'mine-coal')).site, 'mine');
    assert.deepEqual(tests.filter(t => t.setup[0]?.reset).map(t => t.name), ['home-chest-sign', 'mine-coal', 'mine-iron-staircase', 'unload-home-chest',
        'chores-no-trees', 'chores2-no-trees', 'chores-first-day', 'chores2-first-day', 'chores2-first-night']);
});

test('MCP world tools: start switches to the test world, reset restarts andy, bot start/stop', async () => {
    const f = fakeSession();
    const { calls } = withTestWorld(f, { botRunning: true });
    const tools = defineTools(f.session, { scenariosPath: SCENARIOS, newReport: () => new MemReport() });
    const call = (name, args = {}) => callTool(tools, f.session, name, args);
    const st = await call('world_status');
    assert.equal(st.target, 'settings');
    assert.equal(st.bot.running, true);
    const s = await call('world_start');
    assert.equal(s.world, 'test');
    assert.equal(f.session.config.port, 25566);
    const r = await call('world_reset');
    assert.deepEqual(r.andy, { inGame: true, tries: 1 });
    assert.ok(calls.includes('reset') && calls.includes('start-agent'));
    await call('bot_stop');
    const b = await call('bot_start', { profiles: ['./profiles/andy-micro.json'], wait_ms: 5000 });
    assert.equal(b.inGame, true);
    assert.deepEqual(calls.find(c => Array.isArray(c) && c[0] === 'bot.start')[1], { profiles: ['./profiles/andy-micro.json'] });
    assert.equal((await call('use_world', { world: 'settings' })).world, 'settings');
    assert.deepEqual(await call('site_tp', { site: 'farm' }), { skipped: true, reason: 'not the test world (use world_start or ANDY_WORLD=test)' });
    await call('world_stop');
    assert.ok(calls.includes('stop'));
});
