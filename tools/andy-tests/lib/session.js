// A Session holds the connections to the world (tester) and the mindserver,
// connected on first use and kept until disconnect, and everything both the
// MCP server and the scripted runner do with andy.
import { Report } from './report.js';
import { readLogs, brief } from './logs.js';
import { brisbaneIso } from './time.js';
import { useWorld } from './config.js';
import { needsPlayer } from '../../test-world/lib/rcon.js';

const realSleep = ms => new Promise(r => setTimeout(r, ms));
const TIMELINE_MAX = 20000;
const CHAT_MAX = 2000;
const RCON_SETTLE_MS = 500;

export function inventoryDiff(a = {}, b = {}) {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
        const d = (b[k] || 0) - (a[k] || 0);
        if (d) out[k] = d;
    }
    return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class Session {
    // deps: {makeMind() → MindClient-like, makeTester() → Tester-like,
    // makeWorld() → TestWorld-like and makeBot() → Bot-like (the local test
    // world, optional), now(), sleep(ms)}. report: a Report, or created in config.reportDir
    // on first write.
    constructor({ config, deps, report = null, now = Date.now, sleep = realSleep }) {
        this.config = config;
        this.deps = deps;
        this.now = deps.now || now;
        this.sleep = deps.sleep || sleep;
        this._report = report;
        this.mind = null;
        this.tester = null;
        this.chat = [];       // [{t, text, source}] andy's chat
        this.timeline = [];   // [{t, action, idle, pos, health, hunger, entities}]
        this.snapshots = {};
        this._settings = null;
        this._world = null;
        this._bot = null;
    }

    get report() {
        if (!this._report) this._report = new Report(this.config.reportDir, { title: 'Andy session', now: this.now });
        return this._report;
    }

    // ---- connections ----

    async ensureMind() {
        if (this.mind?.connected) return this.mind;
        const mind = this.mind || await this.deps.makeMind();
        await mind.connect();
        if (!this.mind) {
            mind.on('state', (s, t) => this._onState(s, t));
            mind.on('output', (text, t) => this._onChat(text, t, 'mindserver'));
        }
        this.mind = mind;
        return mind;
    }

    async ensureTester() {
        if (this.tester?.connected) return this.tester;
        const tester = this.tester || await this.deps.makeTester();
        await tester.connect();
        if (!this.tester) tester.on('andy', (text, t) => this._onChat(text, t, 'game'));
        this.tester = tester;
        return tester;
    }

    async connect({ tester = true } = {}) {
        const out = {};
        await this.ensureMind();
        out.mindserver = this.mind.url;
        out.agent = this.mind.agentStatus();
        if (tester) {
            await this.ensureTester();
            out.world = this.tester.server ? `${this.tester.server.host}:${this.tester.server.port} (${this.tester.server.version})` : 'connected';
            out.tester = this.tester.position();
        }
        out.target = this.config.world;
        out.report = this.report.paths();
        return out;
    }

    disconnect() {
        this.tester?.close();
        this.mind?.close();
        this.tester = null;
        this.mind = null;
        return { disconnected: true };
    }

    // ---- what andy says and does ----

    _onChat(text, t, source) {
        // the same line arrives from the mindserver and the game: keep one
        const dup = this.chat.some(c => c.text.trim() === text.trim() && c.source !== source && Math.abs(c.t - t) < 3000);
        if (dup) return;
        this.chat.push({ t, text, source });
        if (this.chat.length > CHAT_MAX) this.chat.splice(0, this.chat.length - CHAT_MAX);
    }

    _onState(s, t) {
        this.timeline.push({
            t,
            action: s.action?.current ?? null,
            idle: !!s.action?.isIdle,
            pos: s.gameplay?.position || null,
            health: s.gameplay?.health,
            hunger: s.gameplay?.hunger,
            entities: s.nearby?.entityTypes || [],
        });
        if (this.timeline.length > TIMELINE_MAX) this.timeline.splice(0, this.timeline.length - TIMELINE_MAX);
    }

    chatSince(t) { return this.chat.filter(c => c.t >= t); }
    timelineSince(t, until = Infinity) { return this.timeline.filter(e => e.t >= t && e.t <= until); }

    chatLog({ limit = 30, sinceMs = null } = {}) {
        const from = sinceMs == null ? 0 : this.now() - sinceMs;
        return this.chatSince(from).slice(-limit).map(c => ({ time: brisbaneIso(c.t), text: c.text, source: c.source }));
    }

    async state() {
        const mind = await this.ensureMind();
        return mind.freshState();
    }

    async status() {
        const s = await this.state();
        const out = {
            agent: this.mind.agentStatus(),
            position: s.gameplay?.position,
            health: s.gameplay?.health,
            food: s.gameplay?.hunger,
            dimension: s.gameplay?.dimension,
            gamemode: s.gameplay?.gamemode,
            time: s.gameplay ? `${s.gameplay.timeLabel} (${s.gameplay.timeOfDay})` : undefined,
            action: s.action,
            inventory: s.inventory?.counts,
            slots: s.inventory ? `${s.inventory.stacksUsed} stacks used` : undefined,
            equipment: s.inventory?.equipment,
            surroundings: s.surroundings,
            nearby: s.nearby,
            modes: s.modes?.summary,
        };
        const tp = this.tester?.connected ? this.tester.position() : null;
        if (tp) {
            out.tester = tp;
            if (out.position) out.testerDistance = +dist(tp, out.position).toFixed(1);
        }
        return out;
    }

    async agentSettings() {
        if (this._settings) return this._settings;
        const mind = await this.ensureMind();
        this._settings = await mind.getSettings();
        return this._settings;
    }

    // ---- telling andy things ----

    async waitChat(since, waitMs) {
        if (waitMs > 0) await this.sleep(waitMs);
        return this.chatSince(since).map(c => c.text);
    }

    async say(text, waitMs = 4000) {
        const tester = await this.ensureTester();
        await this.ensureMind().catch(() => null); // for andy's replies; game chat also works
        const t = this.now();
        tester.chat(text);
        return { said: text, replies: await this.waitChat(t, waitMs) };
    }

    async command(line, waitMs = 3000) {
        const mind = await this.ensureMind();
        const t = this.now();
        mind.send(line, this.config.tester);
        return { sent: line, from: this.config.tester, replies: await this.waitChat(t, waitMs) };
    }

    // serverCommand: on the test world over RCON (more reliable than chat,
    // no length limit), except commands relative to tester (~ ^ @s), which
    // tester types; elsewhere, or if RCON fails, tester types it.
    async serverCommand(cmd, waitMs = 1000) {
        let rconError = null;
        if (this.onTestWorld() && !needsPlayer(cmd)) {
            try {
                const reply = await (await this.testWorld()).command(cmd);
                // RCON replies at once; give the change time to reach andy's
                // and tester's clients (tester's chat commands wait anyway)
                await this.sleep(Math.min(waitMs, RCON_SETTLE_MS));
                return { command: cmd, via: 'rcon', replies: String(reply).split('\n').map(l => l.trim()).filter(Boolean) };
            } catch (e) { rconError = e.message; }
        }
        const tester = await this.ensureTester();
        const out = { command: cmd, via: 'tester', replies: await tester.command(cmd, waitMs) };
        if (rconError) out.rconError = rconError;
        return out;
    }

    // ---- the local test world ----

    onTestWorld() { return this.config.world === 'test'; }

    async testWorld() {
        if (!this.deps.makeWorld) throw new Error('The test world is not available in this session.');
        if (!this._world) this._world = await this.deps.makeWorld();
        return this._world;
    }

    async testBot() {
        if (!this.deps.makeBot) throw new Error('The test bot is not available in this session.');
        if (!this._bot) this._bot = await this.deps.makeBot();
        return this._bot;
    }

    // useWorld switches the session between "settings" (your own world,
    // settings.js) and "test" (the local test world), dropping connections
    // to the old one.
    useWorld(world) {
        const old = this.config.world;
        if (useWorld(this.config, world)) {
            this.disconnect();
            this._settings = null;
        }
        const c = this.config;
        return { world: c.world, was: old, minecraft: `${c.host}:${c.port}`, mindserver: `http://localhost:${c.mindserverPort}` };
    }

    async worldStatus() {
        const w = await this.testWorld();
        const out = { target: this.config.world, ...(await w.status()) };
        if (this.deps.makeBot) out.bot = (await this.testBot()).status();
        return out;
    }

    async worldStart() {
        const w = await this.testWorld();
        const r = await w.start();
        return { ...r, ...this.useWorld('test') };
    }

    async worldStop() {
        this.tester?.close();
        this.tester = null;
        const r = await (await this.testWorld()).stop();
        return r;
    }

    // worldReset puts the template world back. Andy is kicked when the server
    // stops; if the test bot is running he is started again through the
    // mindserver and this waits until he is back in game.
    async worldReset({ andyTimeoutMs = 90000 } = {}) {
        const w = await this.testWorld();
        this.useWorld('test');
        this.tester?.close();
        this.tester = null;
        const r = await w.reset();
        const out = { ...r, world: 'test' };
        const bot = this.deps.makeBot ? (await this.testBot()).status() : null;
        if (bot?.running) {
            const t0 = this.now();
            try {
                const mind = await this.ensureMind();
                out.andy = await mind.restartAgent({ timeout: andyTimeoutMs, sleep: this.sleep });
            } catch (e) {
                out.andy = { inGame: false, error: e.message };
            }
            out.andyMs = this.now() - t0;
        }
        this.snapshots = {};
        return out;
    }

    async botStart({ profiles, waitMs = 120000 } = {}) {
        const bot = await this.testBot();
        this.useWorld('test');
        const r = bot.start(profiles ? { profiles } : {});
        if (waitMs > 0) {
            const t0 = this.now();
            const w = await this.waitUntil(async () => {
                try {
                    const mind = await this.ensureMind();
                    return mind.agentStatus()?.in_game ? mind.agentStatus() : null;
                } catch { return null; }
            }, { timeout: waitMs, poll: 1000 });
            r.inGame = w.ok;
            r.waitedMs = this.now() - t0;
            if (!w.ok) r.note = `andy wasn't in game after ${Math.round(waitMs / 1000)} s; see ${r.log || bot.status().log}`;
        }
        return r;
    }

    async botStop() {
        this.mind?.close();
        this.mind = null;
        return (await this.testBot()).stop();
    }

    sites() {
        return this._world?.sites || null;
    }

    // siteTp teleports andy (and/or tester, beside him, 2 blocks east) to a
    // named site of the test world. Off the test world it does nothing.
    async siteTp(name, { who = 'both' } = {}) {
        if (!this.onTestWorld()) return { skipped: true, reason: 'not the test world (use world_start or ANDY_WORLD=test)' };
        const w = await this.testWorld();
        const s = w.sites?.sites?.[name];
        if (!s) throw new Error(`No site "${name}". Sites: ${Object.keys(w.sites?.sites || {}).join(', ')}.`);
        const out = { site: name, at: { x: s.x, y: s.y, z: s.z }, replies: [] };
        const cx = s.x + 0.5, cz = s.z + 0.5;
        if (who === 'both' || who === 'andy') {
            const r = await this.serverCommand(`/tp ${this.config.agent} ${cx} ${s.y} ${cz}`);
            out.replies.push(...r.replies);
            const near = await this.waitUntil(async () => {
                const p = (await this.state()).gameplay?.position;
                return p && Math.abs(p.x - cx) < 2 && Math.abs(p.z - cz) < 2 ? p : null;
            }, { timeout: 10000, poll: 500 });
            out.andy = near.ok ? near.value : null;
            if (!near.ok) throw new Error(`andy didn't arrive at site ${name} (${s.x} ${s.y} ${s.z}): ${out.replies.join(' / ')}`);
        }
        if (who === 'both' || who === 'tester') {
            const tester = await this.ensureTester();
            const r = await this.serverCommand(`/tp ${this.config.tester} ${cx + (who === 'both' ? 2 : 0)} ${s.y} ${cz}`);
            out.replies.push(...r.replies);
            await this.sleep(500);
            out.tester = tester.position();
        }
        return out;
    }

    // ---- moving tester ----

    async andyBlock() {
        const p = (await this.state()).gameplay.position;
        return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
    }

    // tp: absolute {x, y, z}, or relative to andy {dx, dy, dz} (default
    // 2 blocks east, beside him).
    async tp({ x, y, z, dx, dy, dz } = {}) {
        const tester = await this.ensureTester();
        let at;
        if (x != null && y != null && z != null) at = { x, y, z };
        else {
            const a = await this.andyBlock();
            at = { x: a.x + (dx ?? 2) + 0.5, y: a.y + (dy ?? 0), z: a.z + (dz ?? 0) + 0.5 };
        }
        const replies = await tester.tp(at.x, at.y, at.z);
        return { to: at, replies, position: tester.position() };
    }

    // move: walk to {x, y, z}, or by {dx, dz} from where tester stands.
    async move({ x, y, z, dx, dz, timeoutMs = 20000 } = {}) {
        const tester = await this.ensureTester();
        const from = tester.position();
        const to = x != null && z != null ? { x, y: y ?? from.y, z } : { x: from.x + (dx || 0), y: from.y, z: from.z + (dz || 0) };
        const r = await tester.walkTo(to.x, to.y, to.z, timeoutMs);
        return { from, to, ...r };
    }

    async chestContents(x, y, z) {
        const tester = await this.ensureTester();
        return { at: { x, y, z }, items: await tester.chest(x, y, z) };
    }

    // countBlocks: {count, center} of blocks named `name` within radius of
    // center (andy's position when center is null).
    async countBlocks(name, center = null, radius = 6) {
        const tester = await this.ensureTester();
        const c = center || (await this.state())?.gameplay?.position;
        if (!c) throw new Error("andy's position is unknown");
        const at = { x: Math.floor(c.x), y: Math.floor(c.y), z: Math.floor(c.z) };
        return { count: await tester.countBlocks(name, at, radius), center: at };
    }

    // ---- waiting ----

    // waitIdle: done when andy has been idle for `settle` ms after being
    // busy, or is idle after `grace` ms without getting busy, or at timeout.
    async waitIdle({ timeout = 120000, grace = 5000, settle = 3000, poll = 500 } = {}) {
        const mind = await this.ensureMind();
        const start = this.now();
        let sawBusy = false, idleSince = null, last = null;
        const actions = [];
        for (;;) {
            const s = mind.state();
            const t = this.now();
            if (s) {
                const label = s.action?.current ?? null;
                if (label !== last) { actions.push(label); last = label; }
                if (!s.action?.isIdle) { sawBusy = true; idleSince = null; } else if (idleSince == null) idleSince = t;
            }
            const elapsed = t - start;
            const idleFor = idleSince == null ? 0 : t - idleSince;
            if (sawBusy && idleSince != null && idleFor >= settle) return this._waited(start, true, false, sawBusy, actions);
            if (!sawBusy && idleSince != null && elapsed >= grace) return this._waited(start, true, false, sawBusy, actions);
            if (elapsed >= timeout) return this._waited(start, false, true, sawBusy, actions);
            await this.sleep(Math.min(poll, Math.max(1, timeout - elapsed)));
        }
    }

    _waited(start, idle, timedOut, busy, actions) {
        return { idle, timedOut, wasBusy: busy, ms: this.now() - start, actions, chat: this.chatSince(start).map(c => c.text) };
    }

    // waitUntil polls fn() (sync or async) until it returns a truthy value.
    async waitUntil(fn, { timeout = 60000, poll = 500 } = {}) {
        const start = this.now();
        for (;;) {
            const v = await fn();
            if (v) return { ok: true, ms: this.now() - start, value: v };
            if (this.now() - start >= timeout) return { ok: false, ms: this.now() - start };
            await this.sleep(poll);
        }
    }

    // ---- inventory snapshots ----

    async snapshot(label = 'snap') {
        const s = await this.state();
        const snap = {
            label, t: this.now(), time: brisbaneIso(this.now()),
            inventory: { ...(s.inventory?.counts || {}) },
            position: s.gameplay?.position, health: s.gameplay?.health, hunger: s.gameplay?.hunger,
            action: s.action?.current,
        };
        this.snapshots[label] = snap;
        return snap;
    }

    async diff(from, to = null) {
        const a = this.snapshots[from];
        if (!a) throw new Error(`No snapshot "${from}". Snapshots: ${Object.keys(this.snapshots).join(', ') || 'none'}.`);
        const b = to ? this.snapshots[to] : await this.snapshot('now');
        if (!b) throw new Error(`No snapshot "${to}".`);
        return { from: a.label, to: b.label, inventory: inventoryDiff(a.inventory, b.inventory), health: (b.health ?? 0) - (a.health ?? 0), hunger: (b.hunger ?? 0) - (a.hunger ?? 0), position: a.position && b.position ? { dx: +(b.position.x - a.position.x).toFixed(2), dy: +(b.position.y - a.position.y).toFixed(2), dz: +(b.position.z - a.position.z).toFixed(2) } : null };
    }

    // ---- logs ----

    logs({ task = null, since = null, until = null, sinceMs = null, match = null, limit = 20, full = false } = {}) {
        const from = since ?? (sinceMs != null ? this.now() - sinceMs : null);
        const entries = readLogs(this.config.logDir, { task, since: from, until, match, limit });
        return full ? entries : entries.map(e => brief(e, 400));
    }
}
