/* global process */
/* eslint-disable require-await -- fakes mirror async interfaces */
// TestWorld (start, stop, reset, template, status), its config and
// sites.json, the site checks and the test bot, with a fake docker, fake
// RCON and a temporary data directory. No container is started.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TestWorld, RULES, offlineUuid, mergeOps } from '../tools/test-world/lib/world.js';
import { makeWorldConfig, loadSites, validateSites, SITES_FILE, REPO_ROOT } from '../tools/test-world/lib/config.js';
import { checkSite } from '../tools/test-world/lib/probe.js';
import { Bot, botCommand, botSettings } from '../tools/test-world/lib/bot.js';
import { parseBotArgs } from '../tools/test-world/bot.js';

const SITES = { seed: '1', spawn: { x: 1, y: 70, z: 2 }, sites: { base: { x: 1, y: 70, z: 2 }, farm: { x: 50, y: 63, z: 40 } }, build: ['setblock 1 70 2 chest'] };

// fakeDocker: one container whose state follows compose up/stop, ready
// `readyAfter` pings after it starts.
function fakeEnv({ readyAfter = 2, crash = false } = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
    const config = makeWorldConfig({ TEST_WORLD_DATA: dir }, { exists: () => false });
    const st = { state: null, pings: 0, calls: [], commands: [], logs: [], t: Date.parse('2026-11-10T02:00:00Z'), copies: [] };
    const deps = {
        fs,
        run: async (cmd, args, opts) => {
            st.calls.push({ cmd, args, env: opts?.env });
            if (args[0] === 'inspect') return st.state ? { code: 0, stdout: st.state + '\n' } : { code: 1, stdout: '', stderr: 'No such object' };
            if (args[0] === 'logs') return { code: 0, stdout: 'last lines' };
            if (args.includes('up')) { st.state = crash ? 'exited' : 'running'; st.pings = 0; return { code: 0, stdout: '' }; }
            if (args.includes('stop')) { st.state = 'exited'; return { code: 0, stdout: '' }; }
            return { code: 0, stdout: '' };
        },
        ping: async () => {
            if (st.state !== 'running' || ++st.pings < readyAfter) throw new Error('ECONNREFUSED');
            return { version: '1.21.6' };
        },
        makeRcon: ({ password }) => ({
            connected: true,
            command: async cmd => { st.commands.push(cmd); assert.ok(password); return cmd === 'list' ? 'There are 0 of a max of 8 players online: ' : `ok ${cmd}`; },
            close() {},
        }),
        copyDir: async (from, to) => { st.copies.push([from, to]); fs.cpSync(from, to, { recursive: true }); },
        randomSecret: () => 'sekret',
        sleep: async ms => { st.t += ms; },
        now: () => st.t,
        log: line => st.logs.push(line),
    };
    const world = new TestWorld({ config, sites: SITES, deps });
    return { dir, config, st, world };
}

const put = (file, text = 'x') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('config: data beside the checkout, localhost ports, overrides', () => {
    const c = makeWorldConfig({}, { exists: () => false });
    assert.equal(c.data, path.resolve(REPO_ROOT, '..', 'mindcraft-test-world-data'));
    assert.deepEqual([c.host, c.port, c.rconPort, c.mindserverPort, c.version], ['127.0.0.1', 25566, 25576, 8091, '1.21.6']);
    assert.equal(c.node, process.execPath);
    assert.deepEqual(c.ops, ['tester']);
    const o = makeWorldConfig({ TEST_WORLD_DATA: '~/w', TEST_WORLD_PORT: '30000', TEST_WORLD_NODE: '/n' }, { exists: () => true });
    assert.equal(o.data, path.join(os.homedir(), 'w'));
    assert.equal(o.port, 30000);
    assert.equal(o.node, '/n');
    assert.equal(makeWorldConfig({}, { exists: () => true }).node, '/opt/homebrew/opt/node@20/bin/node');
});

test('the committed sites.json is valid and names the five sites with checks', () => {
    const doc = loadSites(SITES_FILE);
    assert.equal(doc.seed, '1');
    assert.deepEqual(Object.keys(doc.sites), ['base', 'farm', 'dry', 'mine', 'cave']);
    for (const s of Object.values(doc.sites)) assert.ok(s.checks.length > 0);
    assert.ok(doc.build.every(c => !c.startsWith('/')), 'build commands go over RCON without a slash');
    assert.deepEqual(validateSites({ seed: 'x', sites: { Bad: { x: 1, y: 2 }, ok: { x: 1, y: 2, z: 3, checks: [{ type: 'nope' }] } } }), [
        'needs a numeric "seed"', 'site "Bad": name should be lower-case', 'site "Bad": needs numeric z', 'site "ok": unknown check "nope" (known: grass, water, noWater, stone, cave, block)',
    ]);
});

test('compose file: pinned image, localhost ports, secret file, EULA noted', () => {
    const text = fs.readFileSync(path.join(REPO_ROOT, 'tools/test-world/compose.yaml'), 'utf8');
    assert.match(text, /image: itzg\/minecraft-server:\d{4}\.\d+\.\d+-java21\n/);
    assert.match(text, /"127\.0\.0\.1:\$\{TEST_WORLD_PORT:-25566\}:25565"/);
    assert.match(text, /"127\.0\.0\.1:\$\{TEST_WORLD_RCON_PORT:-25576\}:25575"/);
    assert.match(text, /RCON_PASSWORD_FILE: \/run\/secrets\/rcon/);
    assert.match(text, /VERSION: "1\.21\.6"/);
    assert.match(text, /EULA: "TRUE"/);
    assert.match(text, /accepted the Minecraft EULA/);
    assert.doesNotMatch(text, /RCON_PASSWORD:/);
});

test('offline UUIDs and ops.json', () => {
    assert.equal(offlineUuid('tester'), 'dd823a0c-b94a-369f-acd6-ddd287e3180e');
    const ops = mergeOps([{ name: 'tester', uuid: 'online' }, { name: 'chris', uuid: 'c' }], ['tester']);
    assert.deepEqual(ops.map(o => [o.name, o.uuid, o.level ?? null]), [['chris', 'c', null], ['tester', 'dd823a0c-b94a-369f-acd6-ddd287e3180e', 4]]);
});

test('start: secret (600), ops, compose up with the seed, waits for ping and RCON', async () => {
    const { world, st, config } = fakeEnv({ readyAfter: 3 });
    const r = await world.start();
    assert.equal(r.ready, true);
    assert.equal(fs.readFileSync(config.secretFile, 'utf8'), 'sekret\n');
    assert.equal(fs.statSync(config.secretFile).mode & 0o777, 0o600);
    assert.equal(JSON.parse(fs.readFileSync(path.join(config.serverDir, 'ops.json'), 'utf8'))[0].uuid, offlineUuid('tester'));
    const up = st.calls.find(c => c.args.includes('up'));
    assert.deepEqual(up.args.slice(0, 4), ['compose', '-f', config.compose, '-p']);
    assert.deepEqual(up.env, { TEST_WORLD_DATA: config.data, TEST_WORLD_PORT: '25566', TEST_WORLD_RCON_PORT: '25576', TEST_WORLD_SEED: '1' });
    assert.ok(st.commands.includes('list'));
    assert.match(st.logs.at(-1), /^\[2026-11-10 12:00:\d\d AEST\] ready in/);
    // already running: no second compose up
    const n = st.calls.length;
    assert.equal((await world.start()).started, false);
    assert.ok(!st.calls.slice(n).some(c => c.args.includes('up')));
});

test('start: a container that dies fails with its last log lines; never ready times out', async () => {
    await assert.rejects(fakeEnv({ crash: true }).world.start(), /stopped \(exited\)[\s\S]*last lines/);
    await assert.rejects(fakeEnv({ readyAfter: 1e9 }).world.start({ timeout: 10000 }), /didn't become ready in 10 s/);
});

test('reset without a template fails and leaves the live world alone', async () => {
    const { world, config, st } = fakeEnv();
    put(path.join(config.worldDir, 'level.dat'), 'live');
    await assert.rejects(world.reset(), /npm run world:template/);
    assert.equal(fs.readFileSync(path.join(config.worldDir, 'level.dat'), 'utf8'), 'live');
    assert.equal(st.calls.length, 0);
});

test('reset: stop, replace the world with the template, start', async () => {
    const { world, config, st } = fakeEnv();
    put(path.join(config.templateWorld, 'level.dat'), 'template');
    put(path.join(config.worldDir, 'level.dat'), 'dirty');
    put(path.join(config.worldDir, 'region/r.0.0.mca'), 'holes');
    st.state = 'running';
    const r = await world.reset();
    assert.equal(r.reset, true);
    assert.equal(fs.readFileSync(path.join(config.worldDir, 'level.dat'), 'utf8'), 'template');
    assert.ok(!fs.existsSync(path.join(config.worldDir, 'region/r.0.0.mca')));
    const order = st.calls.filter(c => c.args[0] === 'compose').map(c => c.args.at(-1) === '-d' ? 'up' : 'stop');
    assert.deepEqual(order, ['stop', 'up']);
    assert.ok(r.ms >= r.startMs);
});

test('template: rules, spawn, forceload, build, check, snapshot without player data', async () => {
    const { world, config, st } = fakeEnv();
    // the "server" writes the world as it runs
    put(path.join(config.worldDir, 'level.dat'), 'old');
    let checked = false;
    const check = async w => {
        checked = true;
        put(path.join(config.worldDir, 'level.dat'), 'new world');
        put(path.join(config.worldDir, 'playerdata/x.dat'));
        put(path.join(config.worldDir, 'session.lock'));
        assert.equal(w, world);
        return { ok: true, results: { base: [{ type: 'grass', ok: true, reason: 'fine' }] } };
    };
    const r = await world.makeTemplate({ check, generateMs: 1000 });
    assert.ok(checked);
    for (const rule of RULES) assert.ok(st.commands.includes(rule), rule);
    assert.ok(st.commands.includes('setworldspawn 1 70 2'));
    assert.ok(st.commands.includes('forceload add -47 -46 49 50'));
    assert.ok(st.commands.indexOf('setblock 1 70 2 chest') > st.commands.indexOf('forceload add 2 -8 98 88'));
    assert.deepEqual(st.commands.slice(-2), ['forceload remove all', 'save-all flush']);
    assert.equal(fs.readFileSync(path.join(config.templateWorld, 'level.dat'), 'utf8'), 'new world');
    assert.ok(!fs.existsSync(path.join(config.templateWorld, 'playerdata')));
    assert.ok(!fs.existsSync(path.join(config.templateWorld, 'session.lock')));
    assert.equal(r.info.seed, '1');
    assert.equal(r.info.check.ok, true);
    assert.equal(JSON.parse(fs.readFileSync(config.templateInfo, 'utf8')).created, r.info.created);
    assert.match(r.info.created, /AEST$/);
    // a second template needs --force
    await assert.rejects(world.makeTemplate(), /--force/);
});

test('status: absent container, then running with players and the template', async () => {
    const { world, st, config } = fakeEnv({ readyAfter: 1 });
    let s = await world.status();
    assert.deepEqual([s.state, s.ready, s.template], ['absent', false, null]);
    assert.deepEqual(s.sites, { base: '1 70 2', farm: '50 63 40' });
    put(path.join(config.templateWorld, 'level.dat'));
    await world.start();
    s = await world.status();
    assert.equal(s.state, 'running');
    assert.equal(s.ready, true);
    assert.match(s.players, /0 of a max of 8/);
    assert.deepEqual(s.template, { present: true });
    assert.ok(st.calls.length > 0);
});

// ---- site checks ----

// A small world: grass at y 63 from x -10..10, z -10..10, air above; water
// at (3, 63, 0); stone hill at x 20..25 up to y 66; a cave at (0, 40, 0).
function fakeView({ water = true } = {}) {
    const blocks = new Map();
    const set = (x, y, z, n) => blocks.set(`${x},${y},${z}`, n);
    for (let x = -10; x <= 30; x++) for (let z = -10; z <= 10; z++) {
        for (let y = 30; y <= 62; y++) set(x, y, z, 'stone');
        set(x, 63, z, x >= 20 ? 'stone' : 'grass_block');
    }
    if (water) set(3, 63, 0, 'water');
    for (let x = 20; x <= 25; x++) for (let z = -3; z <= 3; z++) for (let y = 64; y <= 66; y++) set(x, y, z, 'stone');
    set(0, 40, 0, 'air'); set(0, 41, 0, 'air');
    return {
        blockAt: (x, y, z) => blocks.get(`${x},${y},${z}`) ?? (y > 63 && y < 120 && x >= -10 && x <= 30 && z >= -10 && z <= 10 ? 'air' : null),
        find: (names, s, r, count) => [...blocks.entries()].filter(([, n]) => names.includes(n)).map(([k]) => { const [x, y, z] = k.split(',').map(Number); return { x, y, z }; })
            .filter(p => Math.hypot(p.x - s.x, p.y - s.y, p.z - s.z) <= r).slice(0, count),
    };
}

test('site checks: grass, water, no water, stone, cave, block', () => {
    const v = fakeView();
    const pass = (s, checks) => checkSite(v, { ...s, checks }).map(r => `${r.type}:${r.ok}`);
    assert.deepEqual(pass({ x: 0, y: 64, z: 0 }, [{ type: 'grass', radius: 3 }, { type: 'water', radius: 4 }, { type: 'noWater', radius: 64 }]), ['grass:false', 'water:true', 'noWater:false']);
    assert.deepEqual(pass({ x: -5, y: 64, z: -5 }, [{ type: 'grass', radius: 2 }, { type: 'water', radius: 4 }]), ['grass:true', 'water:false']);
    assert.deepEqual(checkSite(fakeView({ water: false }), { x: 0, y: 64, z: 0, checks: [{ type: 'noWater' }] })[0], { type: 'noWater', ok: true, reason: 'no water within 64' });
    assert.deepEqual(pass({ x: 22, y: 67, z: 0 }, [{ type: 'stone', radius: 4, min: 20 }]), ['stone:true']);
    assert.deepEqual(pass({ x: -5, y: 64, z: -5 }, [{ type: 'stone', radius: 3, min: 5 }]), ['stone:false']);
    assert.deepEqual(pass({ x: 0, y: 40, z: 0 }, [{ type: 'cave' }]), ['cave:true']);
    assert.deepEqual(pass({ x: -5, y: 64, z: -5 }, [{ type: 'cave' }]), ['cave:false']);
    assert.deepEqual(pass({ x: 0, y: 64, z: 0 }, [{ type: 'block', at: '3 -1 0', name: '^water$' }, { type: 'block', at: [0, -1, 0], name: 'chest' }]), ['block:true', 'block:false']);
    const far = checkSite(v, { x: 500, y: 64, z: 0, checks: [{ type: 'grass' }] })[0];
    assert.match(far.reason, /isn't loaded/);
    const r = checkSite(v, { x: 2, y: 64, z: 0, checks: [{ type: 'grass', radius: 1 }] })[0];
    assert.match(r.reason, /only 8\/9 open grass.*3 0: water/);
});

// ---- the test bot ----

test('bot settings: the test world over settings.js, local overrides, node first on PATH', () => {
    const config = makeWorldConfig({ TEST_WORLD_DATA: '/d', TEST_WORLD_NODE: '/opt/node20/bin/node' });
    assert.deepEqual(botSettings(config), { host: '127.0.0.1', port: 25566, minecraft_version: '1.21.6', mindserver_port: 8091, auto_open_ui: false });
    const c = botCommand(config, { profiles: ['./profiles/andy-micro.json'], local: { only_chat_with: ['tester'] }, PATH: '/usr/bin' });
    assert.equal(c.cmd, '/opt/node20/bin/node');
    assert.deepEqual(c.args, ['main.js', '--profiles', './profiles/andy-micro.json']);
    assert.equal(c.cwd, REPO_ROOT);
    assert.deepEqual(JSON.parse(c.env.SETTINGS_JSON).only_chat_with, ['tester']);
    assert.equal(c.env.MINECRAFT_PORT, '25566');
    assert.equal(c.env.MINDSERVER_PORT, '8091');
    assert.equal(c.env.PATH, '/opt/node20/bin:/usr/bin');
    assert.deepEqual(parseBotArgs(['--background', '-p', 'a.json', 'b.json']), { profiles: ['a.json', 'b.json'], background: true, stop: false, print: false });
    assert.deepEqual(parseBotArgs([]).profiles, ['./andy.json']);
    assert.throws(() => parseBotArgs(['--nope']), /unknown option/);
});

test('bot start and stop: pid file, log, process group signals', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twb-'));
    const config = makeWorldConfig({ TEST_WORLD_DATA: dir, TEST_WORLD_NODE: '/n/node' });
    const alive = new Set();
    const signals = [];
    let t = 0;
    const deps = {
        fs,
        spawn: (cmd, args, o) => { alive.add(4242); signals.push(['spawn', cmd, o.cwd, path.dirname(o.log)]); return { pid: 4242 }; },
        kill: (pid, sig) => {
            signals.push([pid, sig]);
            if (sig === 0) { if (!alive.has(Math.abs(pid))) throw new Error('ESRCH'); return; }
            if (sig === 'SIGINT') alive.delete(Math.abs(pid));
        },
        sleep: async ms => { t += ms; }, now: () => t, stamp: () => '2026-11-10_12-00-00',
    };
    const bot = new Bot({ config, deps });
    assert.equal(bot.status().running, false);
    const r = bot.start();
    assert.equal(r.pid, 4242);
    assert.equal(r.log, path.join(dir, 'logs', 'bot-2026-11-10_12-00-00.log'));
    assert.equal(fs.readFileSync(config.botPidFile, 'utf8'), '4242\n');
    assert.equal(bot.start().started, false);
    const s = await bot.stop();
    assert.equal(s.stopped, true);
    assert.ok(signals.some(([p, sig]) => p === -4242 && sig === 'SIGINT'));
    assert.ok(!fs.existsSync(config.botPidFile));
    assert.equal((await bot.stop()).stopped, false);
});
