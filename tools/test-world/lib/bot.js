/* global process */
// Mindcraft against the test world, without touching settings.js: main.js
// merges the SETTINGS_JSON environment variable over settings.js, so the
// test bot gets host 127.0.0.1, port 25566, version 1.21.6, its own
// mindserver port (8091, beside your own Mindcraft on 8090) and no browser,
// and keeps everything else (the Laya decision_models, only_chat_with, …)
// from the checkout's settings.js. tools/test-world/bot-settings.local.json
// (gitignored), when present, is merged on top: top-level keys replace
// settings.js keys whole, as SETTINGS_JSON does.
import path from 'path';

export const DEFAULT_PROFILES = ['./andy.json'];

export function botSettings(config, local = {}) {
    return {
        host: config.host,
        port: config.port,
        minecraft_version: config.version,
        mindserver_port: config.mindserverPort,
        auto_open_ui: false,
        ...local,
    };
}

export function readLocalSettings(config, fs) {
    if (!fs.existsSync(config.botSettingsLocal)) return {};
    try {
        return JSON.parse(String(fs.readFileSync(config.botSettingsLocal, 'utf8')));
    } catch (e) {
        throw new Error(`${config.botSettingsLocal}: ${e.message}`);
    }
}

// botCommand: what to run, from the repo root. The node binary's directory
// goes first on PATH, as start-bot.sh does, because Mindcraft spawns each
// agent with a bare `node` (and a newer node can't load it).
// ANDY_BOT=new runs the rebuilt bot (bot/dist/src/main.js; build it with
// `npm --prefix bot run build`) with the same settings and profiles; old
// (the default until cut-over) runs main.js.
export const NEW_BOT_ENTRY = 'bot/dist/src/main.js';
export function botEntry(which = process.env.ANDY_BOT) {
    const w = (which || 'old').toLowerCase();
    if (w !== 'old' && w !== 'new') throw new Error(`ANDY_BOT must be new or old, not ${which}`);
    return w === 'new' ? NEW_BOT_ENTRY : 'main.js';
}
export function botCommand(config, { profiles = DEFAULT_PROFILES, local = {}, PATH = process.env.PATH || '', bot = process.env.ANDY_BOT } = {}) {
    const settings = botSettings(config, local);
    return {
        cmd: config.node,
        args: [botEntry(bot), '--profiles', ...profiles],
        cwd: config.repoRoot,
        env: {
            SETTINGS_JSON: JSON.stringify(settings), MINECRAFT_PORT: String(settings.port), MINDSERVER_PORT: String(settings.mindserver_port),
            PATH: [path.dirname(config.node), PATH].filter(Boolean).join(':'),
        },
        settings,
    };
}

// Bot runs and stops the test bot in the background (for the MCP tools):
// its output goes to <data>/logs/bot-<stamp>.log and its pid to <data>/bot.pid.
//   deps: {fs, spawn, kill(pid, sig), sleep, now, stamp()}
export class Bot {
    constructor({ config, deps }) {
        this.config = config;
        this.deps = deps;
    }

    pid() {
        const { fs } = this.deps;
        if (!fs.existsSync(this.config.botPidFile)) return null;
        const pid = Number(String(fs.readFileSync(this.config.botPidFile, 'utf8')).trim());
        return Number.isInteger(pid) && pid > 0 ? pid : null;
    }

    alive(pid = this.pid()) {
        if (!pid) return false;
        try { this.deps.kill(pid, 0); return true; } catch { return false; }
    }

    status() {
        const pid = this.pid();
        return { running: this.alive(pid), pid: this.alive(pid) ? pid : null, mindserverPort: this.config.mindserverPort, log: this.lastLog || null };
    }

    start({ profiles = DEFAULT_PROFILES } = {}) {
        const { fs } = this.deps;
        if (this.alive()) return { started: false, ...this.status(), note: 'already running' };
        const local = readLocalSettings(this.config, fs);
        const c = botCommand(this.config, { profiles, local });
        fs.mkdirSync(this.config.logDir, { recursive: true });
        const log = path.join(this.config.logDir, `bot-${this.deps.stamp()}.log`);
        const child = this.deps.spawn(c.cmd, c.args, { cwd: c.cwd, env: { ...process.env, ...c.env }, log });
        fs.writeFileSync(this.config.botPidFile, String(child.pid) + '\n');
        this.lastLog = log;
        return { started: true, pid: child.pid, log, profiles, mindserverPort: c.settings.mindserver_port, world: `${c.settings.host}:${c.settings.port}` };
    }

    // stop: SIGINT to the bot's process group (main.js and the agent
    // processes it spawned), SIGKILL if it hasn't gone in 10 s.
    async stop() {
        const pid = this.pid();
        const { fs } = this.deps;
        if (!this.alive(pid)) { fs.rmSync(this.config.botPidFile, { force: true }); return { stopped: false, note: 'not running' }; }
        const group = sig => { try { this.deps.kill(-pid, sig); } catch { try { this.deps.kill(pid, sig); } catch { /* gone */ } } };
        group('SIGINT');
        const t0 = this.deps.now();
        while (this.alive(pid) && this.deps.now() - t0 < 10000) await this.deps.sleep(250);
        if (this.alive(pid)) group('SIGKILL');
        fs.rmSync(this.config.botPidFile, { force: true });
        return { stopped: true, pid, ms: this.deps.now() - t0 };
    }
}
