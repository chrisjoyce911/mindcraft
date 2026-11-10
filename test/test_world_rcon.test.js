/* global Buffer, setImmediate */
// The RCON client against a fake socket that speaks the server side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'events';
import { Rcon, encode, decode, needsPlayer, plain, LOGIN, COMMAND, AUTH_RESPONSE, RESPONSE } from '../tools/test-world/lib/rcon.js';

// FakeServer: a socket whose writes are answered like a Minecraft server.
class FakeSocket extends EventEmitter {
    constructor({ password = 'pw', reply = cmd => `ran ${cmd}`, chunk = Infinity } = {}) {
        super();
        Object.assign(this, { password, reply, chunk, written: [] });
        setImmediate(() => this.emit('connect'));
    }
    write(buf) {
        for (const p of decode(buf).packets) {
            this.written.push(p);
            let out;
            if (p.type === LOGIN) out = Buffer.concat([encode(p.id, RESPONSE, ''), encode(p.body === this.password ? p.id : -1, AUTH_RESPONSE, '')]);
            else {
                const body = this.reply(p.body);
                const parts = [];
                for (let i = 0; i < body.length; i += 4096) parts.push(encode(p.id, RESPONSE, body.slice(i, i + 4096)));
                if (!parts.length) parts.push(encode(p.id, RESPONSE, ''));
                out = Buffer.concat(parts);
            }
            // deliver in pieces to exercise reassembly
            setImmediate(() => { for (let i = 0; i < out.length; i += this.chunk) this.emit('data', out.subarray(i, i + this.chunk)); });
        }
    }
    end() { this.emit('close'); }
    destroy() {}
}

test('encode and decode round trip, partial packets wait for the rest', () => {
    const a = encode(7, COMMAND, 'time set day');
    assert.equal(a.readInt32LE(0), a.length - 4);
    const both = Buffer.concat([a, encode(8, RESPONSE, 'é')]);
    const { packets, rest } = decode(both.subarray(0, both.length - 3));
    assert.deepEqual(packets, [{ id: 7, type: COMMAND, body: 'time set day' }]);
    assert.equal(rest.length, both.length - 3 - a.length);
    assert.deepEqual(decode(both).packets[1], { id: 8, type: RESPONSE, body: 'é' });
});

test('login, commands in order, colour codes stripped, leading slash dropped', async () => {
    let sock;
    const r = new Rcon({ password: 'pw', connect: () => (sock = new FakeSocket({ chunk: 5, reply: c => (c === 'list' ? '§aThere are 0§r players' : `ran ${c}`) })) });
    const [a, b] = await Promise.all([r.command('/time set day'), r.command('list')]);
    assert.equal(a, 'ran time set day');
    assert.equal(b, 'There are 0 players');
    assert.deepEqual(sock.written.map(p => p.type), [LOGIN, COMMAND, COMMAND]);
    r.close();
});

test('wrong password and missing password fail clearly', async () => {
    const r = new Rcon({ password: 'nope', connect: () => new FakeSocket() });
    await assert.rejects(r.command('list'), /login refused/);
    await assert.rejects(new Rcon({ password: '' }).command('list'), /password missing/);
});

test('long replies over several packets are joined', async () => {
    const long = 'x'.repeat(5000);
    const r = new Rcon({ password: 'pw', connect: () => new FakeSocket({ reply: () => long }) });
    assert.equal((await r.command('help')).length, 5000);
    r.close();
});

test('connection refused is an error naming the port', async () => {
    const r = new Rcon({ password: 'pw', port: 25576, connect: () => { const s = new EventEmitter(); s.write = () => {}; setImmediate(() => s.emit('error', new Error('ECONNREFUSED'))); return s; } });
    await assert.rejects(r.command('list'), /25576.*ECONNREFUSED/);
});

test('commands relative to tester need tester', () => {
    for (const c of ['/summon husk ~5 ~ ~', 'tp @s 1 2 3', '/fill ^ ^ ^1 ^ ^ ^2 air', '/gamemode creative @s']) assert.ok(needsPlayer(c), c);
    for (const c of ['/time set day', '/tp andy 1 64 2', '/give @a bread', '/setblock 1 2 3 chest', '/summon husk 10 64 5']) assert.ok(!needsPlayer(c), c);
    assert.equal(plain('§cRed§r'), 'Red');
});
