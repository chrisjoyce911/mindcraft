// The mindserver client (src/mindcraft/mindserver.js), as a plain socket.io
// client like the web UI:
//   emit  listen-to-agents           → state-update {name: full state} every second
//   on    agents-status [{name, in_game, socket_connected, viewerPort}]
//   on    bot-output (agentName, text) — what the agent chats (openChat)
//   emit  send-message (agentName, {from, message}) → the agent's respondFunc,
//         as if `from` had said it (commands, the command model, the LLM)
//   emit  get-settings (agentName, cb) → {settings} or {error}
import { EventEmitter } from 'events';

export class MindClient extends EventEmitter {
    constructor({ port, agent, ioFactory, now = Date.now }) {
        super();
        this.port = port;
        this.agent = agent;
        this.ioFactory = ioFactory;
        this.now = now;
        this.socket = null;
        this.agents = [];
        this.latest = null; // {t, state}
    }

    get url() { return `http://localhost:${this.port}`; }
    get connected() { return !!this.socket?.connected; }

    async connect(timeoutMs = 5000) {
        if (this.connected) return;
        this.socket?.close?.(); // a dropped socket still trying to reconnect
        this.socket = null;
        const socket = this.ioFactory(this.url, { reconnection: true, timeout: timeoutMs });
        // listen before connecting: the mindserver sends agents-status as
        // soon as a client connects
        socket.on('agents-status', agents => { this.agents = agents || []; this.emit('agents', this.agents); });
        socket.on('state-update', states => {
            const s = states?.[this.agent];
            if (s && !s.error) {
                this.latest = { t: this.now(), state: s };
                this.emit('state', s, this.latest.t);
            }
        });
        socket.on('bot-output', (name, text) => {
            if (name === this.agent) this.emit('output', String(text), this.now());
        });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => fail(new Error('timed out')), timeoutMs);
            const fail = err => {
                clearTimeout(timer);
                socket.close?.();
                reject(new Error(`Mindserver not reachable at ${this.url} (${err?.message || err}). Start Mindcraft (npm start in the mindcraft checkout; mindserver_port in settings.js).`));
            };
            socket.once('connect', () => { clearTimeout(timer); resolve(); });
            socket.once('connect_error', fail);
        });
        this.socket = socket;
        socket.emit('listen-to-agents');
        // socket.io reconnects by itself after a mindserver restart: listen again
        socket.io?.on?.('reconnect', () => socket.emit('listen-to-agents'));
    }

    agentStatus() {
        return this.agents.find(a => a.name === this.agent) || null;
    }

    requireInGame() {
        const a = this.agentStatus();
        if (!a) throw new Error(`Agent "${this.agent}" isn't registered with the mindserver at ${this.url}. Is it in settings.js profiles?`);
        if (!a.in_game) throw new Error(`Agent "${this.agent}" isn't in game (mindserver says in_game false). Wait for it to join or restart it.`);
    }

    send(message, from) {
        if (!this.connected) throw new Error('Not connected to the mindserver.');
        this.requireInGame();
        this.socket.emit('send-message', this.agent, { from, message });
    }

    // state: the latest state, or null. freshState waits for one newer than maxAge.
    state() { return this.latest?.state || null; }

    freshState({ maxAge = 2500, timeout = 6000 } = {}) {
        if (this.latest && this.now() - this.latest.t <= maxAge) return Promise.resolve(this.latest.state);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.off('state', on);
                const a = this.agentStatus();
                reject(new Error(`No state from "${this.agent}" in ${timeout} ms` + (a ? ` (in_game ${a.in_game})` : ' (not registered)') + '.'));
            }, timeout);
            const on = s => { clearTimeout(timer); this.off('state', on); resolve(s); };
            this.on('state', on);
        });
    }

    getSettings(timeout = 3000) {
        if (!this.connected) return Promise.reject(new Error('Not connected to the mindserver.'));
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('get-settings timed out')), timeout);
            this.socket.emit('get-settings', this.agent, res => {
                clearTimeout(timer);
                if (res?.error) reject(new Error(res.error)); else resolve(res?.settings || {});
            });
        });
    }

    // restartAgent starts the agent again through the mindserver (after the
    // world it was in restarted) and waits until it is in game.
    async restartAgent({ timeout = 90000, poll = 1000, sleep = ms => new Promise(r => setTimeout(r, ms)) } = {}) {
        if (!this.connected) throw new Error('Not connected to the mindserver.');
        const start = this.now();
        let tries = 0, lastTry = -Infinity;
        for (;;) {
            const a = this.agentStatus();
            if (a?.in_game && tries > 0) return { inGame: true, tries, ms: this.now() - start };
            // ask again every 30 s: a start right after a kick can die early
            if (this.now() - lastTry >= 30000) {
                this.socket.emit('start-agent', this.agent);
                tries++;
                lastTry = this.now();
                await sleep(3000); // give the old status time to go
                continue;
            }
            if (this.now() - start >= timeout) return { inGame: false, tries, ms: this.now() - start, status: a };
            await sleep(poll);
        }
    }

    close() {
        this.socket?.close?.();
        this.socket = null;
        this.latest = null;
    }
}
