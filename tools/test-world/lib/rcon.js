/* global Buffer */
// A minimal RCON client (Source RCON protocol, as vanilla Minecraft speaks
// it), so no dependency is added to the shared node_modules.
//   packet: int32le length (of the rest), int32le id, int32le type,
//           body (UTF-8), 0x00, 0x00
//   types:  3 login, 2 command, 2 auth response, 0 command response
// Vanilla splits replies over 4096 bytes into several packets: a reply is
// collected until a packet shorter than that arrives (or a short quiet time).
import net from 'net';
import { EventEmitter } from 'events';

export const LOGIN = 3, COMMAND = 2, AUTH_RESPONSE = 2, RESPONSE = 0;
const MAX_BODY = 4096;

export function encode(id, type, body) {
    const b = Buffer.from(String(body), 'utf8');
    const buf = Buffer.alloc(14 + b.length);
    buf.writeInt32LE(10 + b.length, 0);
    buf.writeInt32LE(id, 4);
    buf.writeInt32LE(type, 8);
    b.copy(buf, 12);
    buf.writeUInt8(0, 12 + b.length);
    buf.writeUInt8(0, 13 + b.length);
    return buf;
}

// decode takes whole packets off the front of buf: {packets, rest}.
export function decode(buf) {
    const packets = [];
    let off = 0;
    while (buf.length - off >= 4) {
        const len = buf.readInt32LE(off);
        if (buf.length - off - 4 < len) break;
        const id = buf.readInt32LE(off + 4);
        const type = buf.readInt32LE(off + 8);
        const body = buf.toString('utf8', off + 12, off + 4 + len - 2);
        packets.push({ id, type, body });
        off += 4 + len;
    }
    return { packets, rest: buf.subarray(off) };
}

// Minecraft colour codes (§a) out of replies.
export const plain = s => String(s).replace(/§[0-9a-fk-or]/gi, '');

export class Rcon extends EventEmitter {
    // connect: (port, host) → a net.Socket-like (for tests)
    constructor({ host = '127.0.0.1', port = 25576, password, connect = (p, h) => net.connect(p, h), timeout = 5000 }) {
        super();
        Object.assign(this, { host, port, password, connectFn: connect, timeout });
        this.socket = null;
        this.buf = Buffer.alloc(0);
        this.nextId = 1;
        this.pending = null; // {id, parts, resolve, reject, timer, quiet}
        this.queue = Promise.resolve();
    }

    get connected() { return !!this.socket && !this.closed; }

    async connect() {
        if (this.connected) return;
        if (!this.password) throw new Error('RCON password missing (start the test world once to generate it).');
        this.closed = false;
        const socket = this.connectFn(this.port, this.host);
        this.socket = socket;
        socket.on('data', d => this._data(d));
        socket.on('close', () => { this.closed = true; this._fail(new Error('RCON connection closed')); this.emit('close'); });
        socket.on('error', e => { this.closed = true; this._fail(new Error(`RCON ${this.host}:${this.port}: ${e.message}`)); });
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`RCON ${this.host}:${this.port}: connect timed out`)), this.timeout);
            socket.once('connect', () => { clearTimeout(timer); resolve(); });
            socket.once('error', e => { clearTimeout(timer); reject(new Error(`RCON ${this.host}:${this.port}: ${e.message}`)); });
        });
        const r = await this._request(LOGIN, this.password, true);
        if (r.id === -1) { this.close(); throw new Error('RCON login refused (wrong password?).'); }
    }

    _data(d) {
        this.buf = Buffer.concat([this.buf, d]);
        const { packets, rest } = decode(this.buf);
        this.buf = rest;
        for (const p of packets) this._packet(p);
    }

    _packet(p) {
        const q = this.pending;
        if (!q) return;
        if (q.login) {
            if (p.type !== AUTH_RESPONSE) return; // an empty RESPONSE may come first
            this._done({ id: p.id, body: p.body });
            return;
        }
        if (p.id !== q.id) return;
        q.parts.push(p.body);
        clearTimeout(q.quiet);
        if (Buffer.byteLength(p.body) < MAX_BODY - 10) this._done({ id: p.id, body: q.parts.join('') });
        else q.quiet = setTimeout(() => this._done({ id: p.id, body: q.parts.join('') }), 150);
    }

    _done(v) {
        const q = this.pending;
        if (!q) return;
        clearTimeout(q.timer); clearTimeout(q.quiet);
        this.pending = null;
        q.resolve(v);
    }

    _fail(err) {
        const q = this.pending;
        if (!q) return;
        clearTimeout(q.timer); clearTimeout(q.quiet);
        this.pending = null;
        q.reject(err);
    }

    _request(type, body, login = false) {
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.pending = { id, login, parts: [], resolve, reject, quiet: null, timer: setTimeout(() => this._fail(new Error(`RCON: no reply to "${login ? 'login' : body}" in ${this.timeout} ms`)), this.timeout) };
            this.socket.write(encode(id, type, body));
        });
    }

    // command runs a server command (with or without the leading /) and
    // returns the reply text, colour codes removed. Commands run one at a time.
    command(cmd) {
        const line = String(cmd).replace(/^\//, '');
        const run = async () => {
            await this.connect();
            const r = await this._request(COMMAND, line);
            return plain(r.body);
        };
        const p = this.queue.then(run, run);
        this.queue = p.catch(() => {});
        return p;
    }

    close() {
        this.closed = true;
        try { this.socket?.end?.(); this.socket?.destroy?.(); } catch { /* */ }
        this.socket = null;
    }
}

// Commands that only make sense run by tester: relative to its position or
// itself, or a private message (/msg, /tell, /w: from RCON the sender would be
// "Rcon", not tester). Everything else can go over RCON.
export function needsPlayer(cmd) {
    return /(^|\s)[~^]|@s\b/.test(String(cmd)) || /^\/?(msg|tell|w)\s/.test(String(cmd).trim());
}
