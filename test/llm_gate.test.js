import test from 'node:test';
import assert from 'node:assert/strict';
import { llmOn, route, deathMessage, NEEDS_LLM } from '../src/agent/llm_gate.js';

const player = { selfPrompt: false, fromOtherBot: false, userCommand: null, commandTask: true };

test('llmOn: on unless settings.llm is false', () => {
    assert.equal(llmOn({}), true);
    assert.equal(llmOn(undefined), true);
    assert.equal(llmOn({ llm: true }), true);
    assert.equal(llmOn({ llm: false }), false);
});

test('route with the LLM on keeps the upstream paths', () => {
    assert.equal(route({ ...player, llm: true }), 'laya');
    assert.equal(route({ ...player, llm: true, commandTask: false }), 'llm');
    assert.equal(route({ ...player, llm: true, userCommand: '!layaMine' }), 'command');
    assert.equal(route({ ...player, llm: true, userCommand: '!newAction' }), 'command');
    assert.equal(route({ ...player, llm: true, selfPrompt: true }), 'llm');
    assert.equal(route({ ...player, llm: true, fromOtherBot: true }), 'llm');
});

test('route with the LLM off: player chat to the command model, nothing else reaches the LLM', () => {
    const off = { ...player, llm: false };
    assert.equal(route(off), 'laya');
    assert.equal(route({ ...off, commandTask: false }), 'canned');
    assert.equal(route({ ...off, userCommand: '!layaMine' }), 'command', 'typed !commands still work');
    assert.equal(route({ ...off, userCommand: '!stop' }), 'command');
    for (const c of NEEDS_LLM) assert.equal(route({ ...off, userCommand: c }), 'refuse', c);
    // interrupt auto-messages, death, timeouts, init_message: system
    assert.equal(route({ ...off, selfPrompt: true }), 'drop');
    assert.equal(route({ ...off, fromOtherBot: true }), 'drop');
    assert.equal(route({ ...off, fromOtherBot: true, userCommand: '!stop' }), 'drop');
    for (const r of [route(off), route({ ...off, commandTask: false }), route({ ...off, selfPrompt: true })])
        assert.notEqual(r, 'llm');
});

test('deathMessage names the block position', () => {
    assert.match(deathMessage({ x: 151.3, y: 31.9, z: -150.2 }, 'andy was shot by Skeleton'), /^I died at 151 31 -151 \(andy was shot by Skeleton\)\./);
    assert.match(deathMessage(null), /unknown place/);
});
