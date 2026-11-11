import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLegacy, LEGACY_COMMANDS } from '../src/harness/legacy.js';

test('the 18 command-model commands are the legacy set (Q10)', () => {
    assert.deepEqual(Object.keys(LEGACY_COMMANDS).sort(), [
        'attack', 'collectBlocks', 'consume', 'craftRecipe', 'followPlayer', 'givePlayer', 'goToPlayer', 'hunt', 'inventory',
        'layaChores', 'layaCraft', 'layaFarm', 'layaGather', 'layaMine', 'putInChest', 'setHomeChest', 'stay', 'stop',
    ]);
});

test('the lines the game scenarios and andy_command send', () => {
    assert.deepEqual(parseLegacy('!layaMine("iron", 3)'), { kind: 'job', job: { kind: 'mine', ore: 'iron', count: 3 } });
    assert.deepEqual(parseLegacy('!layaMine("coal", 2)'), { kind: 'job', job: { kind: 'mine', ore: 'coal', count: 2 } });
    assert.deepEqual(parseLegacy('!layaMine("iron")'), { kind: 'job', job: { kind: 'mine', ore: 'iron', count: 'forever' } });
    assert.deepEqual(parseLegacy('!stop'), { kind: 'stop' });
    assert.deepEqual(parseLegacy('!setHomeChest'), { kind: 'job', job: { kind: 'home' } });
    assert.deepEqual(parseLegacy('!layaChores("off")'), { kind: 'chores', on: false });
    assert.deepEqual(parseLegacy('!layaChores("on")'), { kind: 'chores', on: true });
    assert.deepEqual(parseLegacy('!followPlayer("tester", 3)'), { kind: 'job', job: { kind: 'follow', player: 'tester', distance: 3 } });
    assert.deepEqual(parseLegacy('!layaFarm("wheat", "5")'), { kind: 'job', job: { kind: 'farm', crop: 'wheat', goal: { count: 5 } } });
    assert.deepEqual(parseLegacy('!layaFarm("wheat", 5)'), { kind: 'job', job: { kind: 'farm', crop: 'wheat', goal: { count: 5 } } });
    assert.deepEqual(parseLegacy('!layaFarm()'), { kind: 'job', job: { kind: 'farm', crop: 'any', goal: 'forever' } });
    assert.deepEqual(parseLegacy('!layaFarm'), { kind: 'job', job: { kind: 'farm', crop: 'any', goal: 'forever' } });
});

test('the lines the command model builds (src/agent/laya/command.js)', () => {
    assert.deepEqual(parseLegacy('!goToPlayer("tester", 2)'), { kind: 'job', job: { kind: 'come', player: 'tester', distance: 2 } });
    assert.deepEqual(parseLegacy('!stay(-1)'), { kind: 'job', job: { kind: 'stay', seconds: -1 } });
    assert.deepEqual(parseLegacy('!inventory'), { kind: 'inventory' });
    assert.deepEqual(parseLegacy('!attack("cow")'), { kind: 'job', job: { kind: 'hunt', mob: 'cow', item: null, count: 1 } });
    assert.deepEqual(parseLegacy('!hunt("cow", "beef", 4)'), { kind: 'job', job: { kind: 'hunt', mob: 'cow', item: 'beef', count: 4 } });
    assert.deepEqual(parseLegacy('!layaGather("log", 16)'), { kind: 'job', job: { kind: 'gather', item: 'log', count: 16 } });
    assert.deepEqual(parseLegacy('!collectBlocks("oak_log", 4)'), { kind: 'job', job: { kind: 'gather', item: 'oak_log', count: 4, legacy: 'collectBlocks' } });
    assert.deepEqual(parseLegacy('!layaCraft("stone_pickaxe", 1)'), { kind: 'job', job: { kind: 'craft', item: 'stone_pickaxe', count: 1 } });
    assert.deepEqual(parseLegacy('!craftRecipe("oak_plank", 1)'), { kind: 'job', job: { kind: 'craft', item: 'oak_planks', count: 1, legacy: 'craftRecipe' } });
    assert.deepEqual(parseLegacy('!givePlayer("tester", "coal", 3)'), { kind: 'job', job: { kind: 'give', player: 'tester', item: 'coal', count: 3 } });
    assert.deepEqual(parseLegacy('!putInChest("cobblestone", 64)'), { kind: 'job', job: { kind: 'store', item: 'cobblestone', count: 64 } });
    assert.deepEqual(parseLegacy('!consume("bread")'), { kind: 'job', job: { kind: 'eat', item: 'bread' } });
});

test('unknown or malformed lines are errors to say, never evaluated', () => {
    assert.equal(parseLegacy('!newAction("build a house")'), '!newAction is not a command.');
    assert.equal(parseLegacy('!layaMine("iron", 3, 4)'), 'Command !layaMine was given 3 args, but requires 1-2 args.');
    assert.equal(parseLegacy('!layaMine("iron", 0)'), "Error: Param 'count' must be an element of [1, 64).");
    assert.match(String(parseLegacy('!layaMine("emerald", 2)')), /unknown ore/);
    assert.match(String(parseLegacy('!layaChores("maybe")')), /on or off/);
    assert.equal(parseLegacy('hello'), 'Command is incorrectly formatted');
    assert.match(String(parseLegacy('!stay("x")')), /must be of type int/);
});
