// The tester player: a mineflayer bot in the same world as andy. It runs
// slash commands (the world must allow cheats) and returns the server's
// reply, chats to andy, teleports or walks, and reads chests.
import { EventEmitter } from 'events';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export class Tester extends EventEmitter {
    // deps: {mineflayer, pathfinder (the mineflayer-pathfinder module),
    // Vec3, findServer(host, port, version) → {host, port, version}}
    constructor({ host, port, version, username = 'tester', agent = 'andy', deps, now = Date.now }) {
        super();
        Object.assign(this, { host, port, version, username, agent, deps, now });
        this.bot = null;
        this.server = null;
        this.lines = []; // [{t, text, position}] server/system messages
    }

    get connected() { return !!this.bot?.entity && !this.ended; }

    async connect(timeoutMs = 30000) {
        if (this.connected) return;
        let server;
        try {
            server = await this.deps.findServer(this.host, this.port, this.version);
        } catch (e) {
            throw new Error(`No Minecraft world found at ${this.host}${this.port == -1 ? ' (scanned LAN ports 49000-65000)' : ':' + this.port}: ${e.message} Open the world to LAN with cheats on, or set ANDY_MC_PORT.`);
        }
        this.server = server;
        this.port = server.port; // found once; reconnects skip the scan
        const bot = this.deps.mineflayer.createBot({
            host: server.host, port: server.port, username: this.username, auth: 'offline',
            version: this.version === 'auto' ? server.version : this.version, hideErrors: true,
        });
        this.ended = false;
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => done(new Error(`tester did not spawn in ${timeoutMs} ms`)), timeoutMs);
            const done = err => {
                clearTimeout(timer);
                bot.off?.('spawn', ok);
                if (err) { try { bot.quit?.(); } catch { /* */ } reject(err); } else resolve();
            };
            const ok = () => done();
            bot.once('spawn', ok);
            bot.once('kicked', r => done(new Error(`tester was kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`)));
            bot.once('error', e => done(new Error(`tester could not join ${server.host}:${server.port}: ${e.message}`)));
        });
        this.bot = bot;
        if (this.deps.pathfinder) bot.loadPlugin(this.deps.pathfinder.pathfinder);
        bot.on('end', () => { this.ended = true; this.emit('end'); });
        bot.on('error', e => this.emit('log', `tester error: ${e.message}`)); // an unhandled 'error' would kill the process
        bot.on('kicked', r => { this.ended = true; this.emit('log', `tester kicked: ${typeof r === 'string' ? r : JSON.stringify(r)}`); });
        bot.on('messagestr', (text, position) => {
            if (position === 'chat') return;
            this.lines.push({ t: this.now(), text, position });
            if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
            this.emit('server', text);
        });
        bot.on('chat', (username, message) => {
            if (username === this.agent) this.emit('andy', message, this.now());
        });
        // 6.2b: andy's whisper back (/tell tester …) arrives as player chat, so the messagestr lines above skip it;
        // kept as a server line ("andy whispers to you: …") so a cmd step's replies and serverReply checks see it
        bot.on('whisper', (username, message) => {
            if (username !== this.agent) return;
            const text = `${username} whispers to you: ${message}`;
            this.lines.push({ t: this.now(), text, position: 'whisper' });
            if (this.lines.length > 500) this.lines.splice(0, this.lines.length - 500);
            this.emit('server', text);
        });
    }

    require() {
        if (!this.connected) throw new Error('tester is not in the world (connect first).');
    }

    // command runs a slash command and returns the server's replies in waitMs.
    async command(cmd, waitMs = 1000) {
        this.require();
        const line = cmd.startsWith('/') ? cmd : '/' + cmd;
        const t = this.now();
        this.bot.chat(line);
        await sleep(waitMs);
        return this.lines.filter(l => l.t >= t).map(l => l.text);
    }

    chat(text) {
        this.require();
        this.bot.chat(text);
    }

    position() {
        if (!this.connected) return null;
        const p = this.bot.entity.position;
        return { x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2) };
    }

    tp(x, y, z) {
        return this.command(`/tp ${this.username} ${x} ${y} ${z}`, 600);
    }

    // walkTo walks with the pathfinder (so andy sees a player moving, not
    // jumping), falling back to 1-block teleports.
    async walkTo(x, y, z, timeoutMs = 20000) {
        this.require();
        const bot = this.bot;
        if (this.deps.pathfinder && bot.pathfinder) {
            const { Movements, goals } = this.deps.pathfinder;
            bot.pathfinder.setMovements(new Movements(bot));
            try {
                await Promise.race([
                    bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)),
                    sleep(timeoutMs).then(() => { throw new Error('walk timed out'); }),
                ]);
                return { walked: true, position: this.position() };
            } catch (e) {
                bot.pathfinder.stop();
                this.emit('log', `walk failed (${e.message}); stepping by teleport`);
            }
        }
        const from = this.position();
        const steps = Math.ceil(Math.max(Math.abs(x - from.x), Math.abs(z - from.z)));
        for (let i = 1; i <= steps; i++) {
            const f = i / steps;
            await this.command(`/tp ${this.username} ${(from.x + (x - from.x) * f).toFixed(2)} ${y} ${(from.z + (z - from.z) * f).toFixed(2)}`, 250);
        }
        return { walked: false, position: this.position() };
    }

    // chest teleports on top of the container and opens it: {name: count}.
    async chest(x, y, z) {
        this.require();
        await this.tp(x + 0.5, y + 1, z + 0.5);
        const Vec3 = this.deps.Vec3;
        let block = null;
        for (let i = 0; i < 20 && !block?.name?.match(/chest|barrel/); i++) {
            block = this.bot.blockAt(new Vec3(x, y, z));
            if (!block?.name?.match(/chest|barrel/)) await sleep(250);
        }
        if (!block?.name?.match(/chest|barrel/)) throw new Error(`No chest at ${x} ${y} ${z} (found ${block?.name || 'nothing loaded'}).`);
        const win = await this.bot.openContainer(block);
        try {
            const counts = {};
            for (const it of win.containerItems()) counts[it.name] = (counts[it.name] || 0) + it.count;
            return counts;
        } finally { win.close(); }
    }

    // countBlocks counts blocks whose name matches `name` (a name, or
    // "/regex/") within radius of center {x, y, z}, from what tester has
    // loaded (tester stands near andy in every test, so his area is loaded).
    countBlocks(name, center, radius = 6) {
        this.require();
        const m = String(name).match(/^\/(.*)\/([a-z]*)$/s);
        const test = m ? (n => new RegExp(m[1], m[2] || 'i').test(n)) : (n => n === name);
        const Vec3 = this.deps.Vec3;
        const found = this.bot.findBlocks({ point: new Vec3(center.x, center.y, center.z), matching: b => !!b && test(b.name), maxDistance: radius, count: 4096 });
        return found.length;
    }

    close() {
        try { this.bot?.quit?.(); } catch { /* */ }
        this.bot = null;
        this.ended = true;
    }
}
