// TestWorld: start, stop, reset and template the local test server (the
// docker compose service in compose.yaml), waiting until it really accepts
// players. Every outside effect goes through deps, so tests use fakes.
//   deps.run(cmd, args, {env}) → {code, stdout, stderr}
//   deps.fs: existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync,
//            rmSync, renameSync
//   deps.copyDir(from, to)           copy a world directory
//   deps.makeRcon({host, port, password}) → {command(cmd), close()}
//   deps.ping(host, port) → {version, players} or throws
//   deps.randomSecret() → string
//   deps.sleep(ms), deps.now(), deps.log(line)
import crypto from 'crypto';
import path from 'path';
import { brisbane } from '../../andy-tests/lib/time.js';

export const RULES = [
    'gamerule doDaylightCycle false',
    'time set day',
    'gamerule doWeatherCycle false',
    'weather clear',
    'gamerule doInsomnia false',
    'gamerule doMobSpawning true',
    'gamerule doTraderSpawning false',
    'gamerule doPatrolSpawning false',
    'gamerule announceAdvancements false',
    'gamerule spawnRadius 0',
    'difficulty easy',
];

// Player state left out of the template, so everyone joins fresh at spawn.
const PLAYER_DIRS = ['playerdata', 'stats', 'advancements'];

// offlineUuid: the UUID an offline-mode server gives a player name
// (a version 3 UUID of "OfflinePlayer:<name>").
export function offlineUuid(name) {
    const h = crypto.createHash('md5').update(`OfflinePlayer:${name}`).digest();
    h[6] = (h[6] & 0x0f) | 0x30;
    h[8] = (h[8] & 0x3f) | 0x80;
    const x = h.toString('hex');
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

// mergeOps adds names as level-4 operators to an ops.json list.
export function mergeOps(list, names) {
    const out = Array.isArray(list) ? list.filter(o => !names.includes(o.name)) : [];
    for (const name of names) out.push({ uuid: offlineUuid(name), name, level: 4, bypassesPlayerLimit: false });
    return out;
}

const IMAGE_RX = /image:\s*(\S+)/;

export class TestWorld {
    constructor({ config, sites, deps }) {
        this.config = config;
        this.sites = sites;
        this.deps = deps;
        this.rcon = null;
    }

    log(msg) { this.deps.log(`[${brisbane(this.deps.now())}] ${msg}`); }

    // ---- secret and docker ----

    ensureData() {
        const { fs } = this.deps;
        const c = this.config;
        for (const d of [c.data, c.serverDir, c.templateDir, c.logDir]) fs.mkdirSync(d, { recursive: true });
        if (!fs.existsSync(c.secretFile)) {
            fs.writeFileSync(c.secretFile, this.deps.randomSecret() + '\n', { mode: 0o600 });
            this.log(`generated the RCON password in ${c.secretFile}`);
        }
        fs.chmodSync(c.secretFile, 0o600);
        const opsFile = path.join(c.serverDir, 'ops.json');
        let ops = [];
        try { ops = JSON.parse(String(fs.readFileSync(opsFile, 'utf8'))); } catch { /* none yet */ }
        fs.writeFileSync(opsFile, JSON.stringify(mergeOps(ops, c.ops || ['tester']), null, 2) + '\n');
    }

    password() {
        const { fs } = this.deps;
        if (!fs.existsSync(this.config.secretFile)) return null;
        return String(fs.readFileSync(this.config.secretFile, 'utf8')).trim();
    }

    composeEnv() {
        const c = this.config;
        return {
            TEST_WORLD_DATA: c.data,
            TEST_WORLD_PORT: String(c.port),
            TEST_WORLD_RCON_PORT: String(c.rconPort),
            TEST_WORLD_SEED: String(this.sites.seed),
        };
    }

    async compose(args) {
        const c = this.config;
        const r = await this.deps.run('docker', ['compose', '-f', c.compose, '-p', c.project, ...args], { env: this.composeEnv() });
        if (r.code !== 0) throw new Error(`docker compose ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim().slice(-800)}`);
        return r;
    }

    // containerState: 'running', 'exited', 'created', … or null (no container).
    async containerState() {
        const r = await this.deps.run('docker', ['inspect', '-f', '{{.State.Status}}', this.config.container], {});
        if (r.code !== 0) return null;
        return r.stdout.trim() || null;
    }

    async containerLogs(lines = 30) {
        const r = await this.deps.run('docker', ['logs', '--tail', String(lines), this.config.container], {});
        return `${r.stdout || ''}${r.stderr || ''}`.trim();
    }

    image() {
        try {
            return String(this.deps.fs.readFileSync(this.config.compose, 'utf8')).match(IMAGE_RX)?.[1] || null;
        } catch { return null; }
    }

    // ---- RCON ----

    async getRcon() {
        if (this.rcon?.connected) return this.rcon;
        this.rcon?.close?.();
        const password = this.password();
        if (!password) throw new Error(`No RCON password at ${this.config.secretFile}: start the test world first (npm run world:start).`);
        this.rcon = this.deps.makeRcon({ host: this.config.host, port: this.config.rconPort, password });
        await this.rcon.connect?.();
        return this.rcon;
    }

    async command(cmd) {
        const rcon = await this.getRcon();
        try {
            return await rcon.command(cmd);
        } catch (e) {
            this.rcon?.close?.();
            this.rcon = null;
            throw e;
        }
    }

    closeRcon() {
        this.rcon?.close?.();
        this.rcon = null;
    }

    // ---- lifecycle ----

    // ready: the server answers a status ping and an RCON "list".
    async ready() {
        try {
            const p = await this.deps.ping(this.config.host, this.config.port);
            const list = await this.command('list');
            return { ok: true, version: p?.version, list };
        } catch (e) {
            this.closeRcon();
            return { ok: false, error: e.message };
        }
    }

    async waitReady({ timeout = 300000, poll = 2000 } = {}) {
        const start = this.deps.now();
        let last = null;
        for (;;) {
            const state = await this.containerState();
            if (state && state !== 'running' && state !== 'created' && state !== 'restarting') {
                throw new Error(`The test world container stopped (${state}). Last log lines:\n${await this.containerLogs()}`);
            }
            const r = await this.ready();
            if (r.ok) return { ...r, ms: this.deps.now() - start };
            last = r.error;
            if (this.deps.now() - start >= timeout) {
                throw new Error(`The test world didn't become ready in ${Math.round(timeout / 1000)} s (${last}). Last log lines:\n${await this.containerLogs()}`);
            }
            await this.deps.sleep(poll);
        }
    }

    async start({ timeout } = {}) {
        const t0 = this.deps.now();
        this.ensureData();
        const state = await this.containerState();
        if (state === 'running') {
            const r = await this.ready();
            if (r.ok) { this.log(`already running on ${this.config.host}:${this.config.port}`); return { started: false, ready: true, ms: 0, list: r.list }; }
        }
        this.log(`starting the test world (seed ${this.sites.seed}) on ${this.config.host}:${this.config.port}`);
        await this.compose(['up', '-d']);
        const r = await this.waitReady({ timeout });
        const ms = this.deps.now() - t0;
        this.log(`ready in ${(ms / 1000).toFixed(1)} s (${r.list})`);
        return { started: true, ready: true, ms, list: r.list };
    }

    async stop() {
        const t0 = this.deps.now();
        this.closeRcon();
        const state = await this.containerState();
        if (!state) { this.log('not running (no container)'); return { stopped: false, ms: 0 }; }
        if (state !== 'running') { this.log(`not running (${state})`); return { stopped: false, ms: 0, state }; }
        this.log('stopping the test world (the server saves the world)');
        await this.compose(['stop', '-t', '60']);
        const ms = this.deps.now() - t0;
        this.log(`stopped in ${(ms / 1000).toFixed(1)} s`);
        return { stopped: true, ms };
    }

    hasTemplate() {
        return this.deps.fs.existsSync(path.join(this.config.templateWorld, 'level.dat'));
    }

    templateInfo() {
        try { return JSON.parse(String(this.deps.fs.readFileSync(this.config.templateInfo, 'utf8'))); } catch { return null; }
    }

    // reset: stop, put the template world in place, start, wait until ready.
    async reset({ timeout } = {}) {
        const t0 = this.deps.now();
        if (!this.hasTemplate()) throw new Error(`No template world at ${this.config.templateWorld}: run npm run world:template first.`);
        const info = this.templateInfo();
        if (info?.seed != null && String(info.seed) !== String(this.sites.seed)) {
            this.log(`warning: the template was made with seed ${info.seed}, sites.json says ${this.sites.seed}; rebuild it with npm run world:template -- --force`);
        }
        const stop = await this.stop();
        const { fs } = this.deps;
        const t1 = this.deps.now();
        fs.rmSync(this.config.worldDir, { recursive: true, force: true });
        await this.deps.copyDir(this.config.templateWorld, this.config.worldDir);
        const copyMs = this.deps.now() - t1;
        this.log(`world replaced with the template in ${(copyMs / 1000).toFixed(1)} s`);
        const start = await this.start({ timeout });
        const ms = this.deps.now() - t0;
        this.log(`reset done in ${(ms / 1000).toFixed(1)} s`);
        return { reset: true, ms, stopMs: stop.ms, copyMs, startMs: start.ms };
    }

    // template: generate the world from the seed, set the rules, generate the
    // chunks round the sites, build the base, optionally check the sites,
    // then stop and snapshot. check: async (world) → {ok, results}.
    async makeTemplate({ force = false, check = null, generateMs = 30000, timeout = 600000 } = {}) {
        const { fs } = this.deps;
        const c = this.config;
        const t0 = this.deps.now();
        if (this.hasTemplate() && !force) throw new Error(`A template already exists at ${c.templateWorld}. Use --force to rebuild it from the seed.`);
        await this.stop();
        this.ensureData();
        fs.rmSync(c.worldDir, { recursive: true, force: true });
        this.log(`generating a new world from seed ${this.sites.seed}`);
        await this.start({ timeout });

        for (const cmd of RULES) this.log(`rcon ${cmd} → ${await this.command(cmd)}`);
        const spawn = this.sites.spawn || this.sites.sites?.base;
        if (spawn) this.log(`rcon setworldspawn → ${await this.command(`setworldspawn ${spawn.x} ${spawn.y} ${spawn.z}`)}`);

        // generate the chunks round each site: forceload ±radius, wait, release
        const radius = this.sites.generateRadius ?? 48;
        const areas = Object.entries(this.sites.sites || {});
        for (const [name, s] of areas) {
            const r = await this.command(`forceload add ${s.x - radius} ${s.z - radius} ${s.x + radius} ${s.z + radius}`);
            this.log(`forceload ${name} → ${r}`);
        }
        if (areas.length) {
            this.log(`waiting ${generateMs / 1000} s for the chunks to generate`);
            await this.deps.sleep(generateMs);
        }

        for (const cmd of this.sites.build || []) this.log(`rcon ${cmd} → ${await this.command(cmd)}`);

        let checked = null;
        if (check) {
            checked = await check(this);
            this.log(`site check: ${checked.ok ? 'all passed' : 'FAILED'}`);
        }
        this.log(`forceload remove all → ${await this.command('forceload remove all')}`);
        this.log(`save-all flush → ${await this.command('save-all flush')}`);
        await this.stop();

        const tmp = c.templateWorld + '.new';
        fs.rmSync(tmp, { recursive: true, force: true });
        await this.deps.copyDir(c.worldDir, tmp);
        for (const d of PLAYER_DIRS) fs.rmSync(path.join(tmp, d), { recursive: true, force: true });
        fs.rmSync(path.join(tmp, 'session.lock'), { force: true });
        fs.rmSync(c.templateWorld, { recursive: true, force: true });
        fs.renameSync(tmp, c.templateWorld);
        const info = {
            seed: String(this.sites.seed), version: c.version, image: this.image(),
            created: brisbane(this.deps.now()), sites: Object.keys(this.sites.sites || {}),
            check: checked ? { ok: checked.ok, results: checked.results } : null,
        };
        fs.writeFileSync(c.templateInfo, JSON.stringify(info, null, 2) + '\n');
        const ms = this.deps.now() - t0;
        this.log(`template saved to ${c.templateWorld} in ${(ms / 1000).toFixed(0)} s`);
        return { template: c.templateWorld, ms, info };
    }

    async status() {
        const c = this.config;
        const state = await this.containerState();
        const out = {
            container: c.container, state: state || 'absent', address: `${c.host}:${c.port}`, rcon: `${c.host}:${c.rconPort}`,
            image: this.image(), seed: String(this.sites.seed), data: c.data,
            template: this.hasTemplate() ? (this.templateInfo() || { present: true }) : null,
            sites: Object.fromEntries(Object.entries(this.sites.sites || {}).map(([k, s]) => [k, `${s.x} ${s.y} ${s.z}`])),
        };
        if (state === 'running') {
            const r = await this.ready();
            out.ready = r.ok;
            if (r.ok) out.players = r.list; else out.error = r.error;
        } else out.ready = false;
        return out;
    }
}
