// 6.2b: whispers are heard like chat and answered by whisper (command/reply.ts, core/body.ts forwardMessages).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Replies } from '../src/command/reply.js';
import { forwardMessages } from '../src/core/body.js';

function out() {
    const sent: string[] = [];
    return { sent, say: (t: string) => { sent.push(`say ${t}`); }, whisper: (to: string, t: string) => { sent.push(`whisper ${to} ${t}`); } };
}

test('reply: a whisper is answered by whisper to the whisperer', () => {
    const o = out();
    const r = new Replies(o);
    r.heard('tester', 'whisper');
    r.send('On my way!');
    assert.deepEqual(o.sent, ['whisper tester On my way!']);
    assert.deepEqual(r.route, { kind: 'whisper', to: 'tester' });
});

test('reply: open chat is answered in open chat (the default before anyone speaks)', () => {
    const o = out();
    const r = new Replies(o);
    r.send('hello');
    r.heard('tester', 'chat');
    r.send('On my way!');
    assert.deepEqual(o.sent, ['say hello', 'say On my way!']);
});

test('reply: an open message after a whisper switches back to chat; a later whisper from another goes to them', () => {
    const o = out();
    const r = new Replies(o);
    r.heard('tester', 'whisper');
    r.send('a');
    r.heard('tester', 'chat');
    r.send('b');
    r.heard('steve', 'whisper');
    r.send('c');
    assert.deepEqual(o.sent, ['whisper tester a', 'say b', 'whisper steve c']);
});

test('body: chat and whisper events are forwarded, andy\'s own are dropped', () => {
    const bot = Object.assign(new EventEmitter(), { username: 'andy' });
    const got: string[] = [];
    forwardMessages(bot, (ev, u, m) => got.push(`${ev} ${u} ${m}`));
    bot.emit('whisper', 'tester', 'come here');
    bot.emit('chat', 'tester', 'hi');
    bot.emit('whisper', 'andy', 'self');
    bot.emit('chat', 'andy', 'self');
    assert.deepEqual(got, ['whisper tester come here', 'chat tester hi']);
});
