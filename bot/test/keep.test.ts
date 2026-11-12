// 6.2: andy never breaks his base stations: the kept blocks (keep.ts), every Movements' blocksCantBreak gets them
// (keepStations, with the real 1.21.6 registry), and digBlock refuses one without digging.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import minecraftData from 'minecraft-data';
import { KEEP_BLOCKS, keepBlock, keepStations } from '../src/core/keep.js';
import { digBlock } from '../src/actuators/ore.js';
import type { Act } from '../src/actuators/bot.js';

test('keepBlock: the stations and every bed, nothing else', () => {
    for (const n of ['crafting_table', 'furnace', 'chest', 'barrel', 'smoker', 'red_bed', 'white_bed']) assert.equal(keepBlock(n), true, n);
    for (const n of ['stone', 'oak_log', 'coal_ore', 'torch', 'dirt', 'bedrock']) assert.equal(keepBlock(n), false, n);
});

test('keepStations adds every kept block of the 1.21.6 registry to blocksCantBreak', () => {
    const reg = minecraftData('1.21.6');
    const m = keepStations({ blocksCantBreak: new Set<number>([99999]) }, reg);
    for (const n of KEEP_BLOCKS) assert.ok(m.blocksCantBreak.has(reg.blocksByName[n]!.id), n);
    assert.ok(m.blocksCantBreak.has(reg.blocksByName.red_bed!.id));
    assert.ok(!m.blocksCantBreak.has(reg.blocksByName.stone!.id));
    assert.ok(m.blocksCantBreak.has(99999), 'what was there stays');
});

test('digBlock refuses a station and digs nothing', async () => {
    const calls: string[] = [];
    const block = (name: string) => ({ name, boundingBox: 'block', position: { x: 1, y: 2, z: 3 } });
    let at = 'furnace';
    const a = {
        bot: {
            blockAt: () => block(at),
            bestTool: () => null,
            heldItem: null,
            items: () => [],
            dig: async () => { calls.push('dig'); },
            equip: async () => { calls.push('equip'); },
        },
    } as unknown as Act;
    assert.equal(await digBlock(a, { x: 1, y: 2, z: 3 }, new AbortController().signal), false);
    at = 'crafting_table';
    assert.equal(await digBlock(a, { x: 1, y: 2, z: 3 }, new AbortController().signal), false);
    assert.deepEqual(calls, []);
});
