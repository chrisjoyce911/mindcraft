/* eslint-disable require-await -- fakes mirror async interfaces */
// Fakes for the game test harness: a fake clock, a scripted andy (behind a
// fake mindserver client) and a fake tester. No Minecraft, no sockets.
import { EventEmitter } from 'events';
import { Session } from '../../tools/andy-tests/lib/session.js';
import { makeConfig } from '../../tools/andy-tests/lib/config.js';

export class FakeWorld {
    constructor({ t = Date.parse('2026-11-10T04:00:00Z'), pos = { x: 10.5, y: 64, z: -4.5 } } = {}) {
        this.t = t;
        this.andy = {
            name: 'andy',
            gameplay: { position: { ...pos }, health: 20, hunger: 20, dimension: 'overworld', gamemode: 'survival', timeOfDay: 1000, timeLabel: 'Morning' },
            action: { current: 'Idle', isIdle: true },
            inventory: { counts: {}, stacksUsed: 0, totalSlots: 46, equipment: {} },
            nearby: { humanPlayers: ['tester'], botPlayers: [], entityTypes: [] },
            surroundings: {}, modes: { summary: '' },
        };
        this.tester = { x: 12.5, y: 64, z: -4.5 };
        this.chests = {};          // "x y z" → {item: count}
        this.commands = [];        // tester's slash commands
        this.sent = [];            // mindserver messages to andy
        this.said = [];            // tester's chat
        this.jobs = [];            // [{at, fn}] scheduled changes
        this.onMessage = () => {}; // (text, world) → andy reacts
        this.onCommand = cmd => (cmd.startsWith('/time') ? ['Set the time to 1000'] : []);
        this.settings = { decision_models: { tasks: { farm: { enabled: false }, mine: { enabled: true }, command: { enabled: true } } } };
        this.mind = null; this.testerObj = null;
    }
    now() { return this.t; }
    async sleep(ms) {
        const end = this.t + Math.max(1, ms);
        while (this.t < end) {
            this.t = Math.min(end, this.t + 250);
            this.runJobs();
            if (this.t % 1000 < 250) this.mind?.tick();
        }
    }
    runJobs() {
        const due = this.jobs.filter(j => j.at <= this.t);
        this.jobs = this.jobs.filter(j => j.at > this.t);
        for (const j of due) j.fn(this);
    }
    after(ms, fn) { this.jobs.push({ at: this.t + ms, fn }); }
    busy(label) { this.andy.action = { current: label, isIdle: false }; }
    idle() { this.andy.action = { current: 'Idle', isIdle: true }; }
    give(item, n) { const c = this.andy.inventory.counts; c[item] = (c[item] || 0) + n; if (c[item] <= 0) delete c[item]; }
    say(text) { this.mind?.emit('output', text, this.t); }
}

export class FakeMind extends EventEmitter {
    constructor(world) { super(); this.world = world; world.mind = this; this.connected = false; this.url = 'http://localhost:8090'; this.latest = null; }
    async connect() { if (this.fail) throw new Error(this.fail); this.connected = true; this.tick(); }
    tick() {
        if (!this.connected) return;
        const s = JSON.parse(JSON.stringify(this.world.andy));
        this.latest = { t: this.world.t, state: s };
        this.emit('state', s, this.world.t);
    }
    agentStatus() { return { name: 'andy', in_game: true }; }
    state() { return this.latest?.state || null; }
    async freshState() { this.tick(); return this.state(); }
    send(message, from) { this.world.sent.push({ message, from }); this.world.onMessage(message, this.world, 'mindserver'); }
    async getSettings() { return this.world.settings; }
    close() { this.connected = false; }
}

export class FakeTester extends EventEmitter {
    constructor(world) { super(); this.world = world; world.testerObj = this; this.connected = false; this.server = { host: '127.0.0.1', port: 55916, version: '1.21.6' }; }
    async connect() { if (this.fail) throw new Error(this.fail); this.connected = true; }
    async command(cmd, waitMs = 0) {
        this.world.commands.push(cmd);
        const replies = this.world.onCommand(cmd, this.world) || [];
        await this.world.sleep(waitMs);
        return replies;
    }
    chat(text) { this.world.said.push(text); this.world.onMessage(text, this.world, 'game'); }
    position() { return { ...this.world.tester }; }
    async tp(x, y, z) { this.world.tester = { x, y, z }; this.world.commands.push(`/tp tester ${x} ${y} ${z}`); return []; }
    async walkTo(x, y, z) { this.world.tester = { x, y, z }; return { walked: true, position: this.position() }; }
    async chest(x, y, z) {
        const c = this.world.chests[`${x} ${y} ${z}`];
        if (!c) throw new Error(`No chest at ${x} ${y} ${z}`);
        return { ...c };
    }
    close() { this.connected = false; }
}

export class MemReport {
    constructor() { this.events = []; this.text = ''; }
    event(e) { this.events.push(e); }
    md(t) { this.text += t; }
    paths() { return { md: '/tmp/fake.md', jsonl: '/tmp/fake.jsonl' }; }
}

export function fakeSession(world = new FakeWorld(), { logDir = '/nonexistent' } = {}) {
    const config = { ...makeConfig({}, { ANDY_BOT_DIR: '/nonexistent' }), logDir };
    const mind = new FakeMind(world);
    const tester = new FakeTester(world);
    const report = new MemReport();
    const session = new Session({
        config, report,
        deps: { makeMind: async () => mind, makeTester: async () => tester, now: () => world.now(), sleep: ms => world.sleep(ms) },
    });
    return { world, session, mind, tester, report };
}
