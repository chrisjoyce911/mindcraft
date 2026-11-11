// Records test/fixtures/laya-logs/branches/command.jsonl from the old bot's handleCommand
// (src/agent/laya/command.js) with a fake client: one line per branch. Run once from the repo root:
//   node tools/laya-logs/record-command.mjs   (rewrites the fixture, with new times)
// bot/test/command.test.ts rebuilds each line from the new bot's decision on the same message and answer.
import { rmSync } from 'fs';
import { handleCommand } from '../../src/agent/laya/command.js';

const out = new URL('../../test/fixtures/laya-logs/branches/command.jsonl', import.meta.url).pathname;
rmSync(out, { force: true });

const answer = (addressed, command, p, item = 'none', tier = 'none', count = 'any', ms = 41) => ({ ms, answers: {
    Addressed: { type: 'noul', probability: addressed },
    Command: { type: 'choice', top: command, topProbability: p },
    Item: { type: 'choice', top: item, topProbability: 0.9 },
    Tier: { type: 'choice', top: tier, topProbability: 0.9 },
    Count: { type: 'choice', top: count, topProbability: 0.9 },
} });
const inv = [{ name: 'oak_log', count: 5 }, { name: 'bread', count: 3 }, { name: 'oak_log', count: 7 }, { name: 'stone_pickaxe', count: 1 },
    { name: 'cobblestone', count: 30 }, { name: 'coal', count: 4 }];
const CASES = [
    ['v2.1', 'andy follow me', null],
    ['v2.1', 'bob follow me', answer(0.0412, 'follow', 0.97)],
    ['v2.1', 'follow me', answer(0.33333, 'follow', 0.97)],
    ['v2.1', 'nice weather andy', answer(0.9, 'chat', 0.8888)],
    ['v2.1', 'andy do the thing', answer(0.95, 'craft', 0.41234)],
    ['v2.1', 'andy gather stuff', answer(0.99, 'gather', 0.9)],
    ['v2.1', 'andy follow me', answer(0.99876, 'follow', 0.99951, 'none', 'none', 'any', 230)],
    ['v2.1', 'andy give me everything', answer(0.97, 'give', 0.95, 'none', 'none', 'all')],
    ['v2.1', 'andy this is your chest', answer(0.97, 'home', 0.95)],
    ['v2.1', 'andy get me 5 beef', answer(0.97, 'gather', 0.95, 'beef', 'none', '5')],
    ['v2.1', 'andy mine some iron', answer(0.97, 'mine', 0.95, 'iron', 'none', 'any')],
    ['v2.1', 'andy store everything', answer(0.97, 'store', 0.95, 'none', 'none', 'all')],
    ['v2.1', 'andy kill the cave spider', answer(0.97, 'attack', 0.95)],
    ['v2.1', 'andy craft a pickaxe', answer(0.97, 'craft', 0.95, 'pickaxe')],
    ['v2.1', 'andy eat something', answer(0.97, 'eat', 0.95)],
    ['v2.2', 'andy do your chores', answer(0.97, 'chores_on', 0.95)],
    ['v2.1', 'andy farm 20 wheat', answer(0.97, 'farm', 0.95, 'wheat', 'none', '20')],
];
for (const [prompt, message, r] of CASES) {
    await handleCommand(message, {
        client: { decide: async () => r }, task: { prompt, no_llm: true }, speaker: 'tester',
        bot: { username: 'andy', inventory: { items: () => inv } },
        has: () => true, arity: n => (n === '!layaMine' ? { min: 1, max: 2 } : { min: 0, max: 3 }), nearestHostile: () => 'zombie',
        execute: async () => '', say: () => {}, logPath: out,
    });
}
