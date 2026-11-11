// 5.0: the pinned dependencies and the mineflayer patch (bot/patches/mineflayer+4.39.0.patch).
// It guards against an `npm i` that bumps the versions or drops the patch: the versions, both hunks in
// the installed source, and the dig time mineflayer's own digging plugin gives a stone/iron pickaxe on ore.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const VERSION = '1.21.6';

const pkgVersion = (name: string): string =>
    (JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8')) as { version: string }).version;
const source = (rel: string): string => readFileSync(require.resolve(`mineflayer/lib/plugins/${rel}`), 'utf8');

interface Registry {
    blocksByName: Record<string, { defaultState: number }>;
    itemsByName: Record<string, { id: number }>;
}
interface PBlock { name: string; material: string | null; digTime(...args: unknown[]): number }
const registry = require('minecraft-data')(VERSION) as Registry;
const Block = require('prismarine-block')(VERSION) as { fromStateId(id: number, biome: number): PBlock };
const injectDigging = require('mineflayer/lib/plugins/digging.js') as (bot: unknown) => void;

const block = (name: string): PBlock => {
    const b = registry.blocksByName[name];
    assert.ok(b, `no block ${name}`);
    return Block.fromStateId(b.defaultState, 0);
};
const itemId = (name: string): number => {
    const i = registry.itemsByName[name];
    assert.ok(i, `no item ${name}`);
    return i.id;
};

/** mineflayer's own digging plugin on a bare bot holding `tool` (or nothing), on the ground, survival. */
function digTimeWith(tool: string | null): (b: PBlock) => number {
    const bot = Object.assign(new EventEmitter(), {
        heldItem: tool === null ? null : { type: itemId(tool), enchants: [] },
        inventory: { slots: [] as unknown[] },
        getEquipmentDestSlot: () => 5,
        game: { gameMode: 'survival' },
        entity: { onGround: true, effects: {}, position: null, eyeHeight: 1.62 },
        blockAt: () => null,
    }) as EventEmitter & { digTime?: (b: PBlock) => number };
    injectDigging(bot);
    assert.ok(bot.digTime, 'digging plugin set bot.digTime');
    return bot.digTime;
}

test('deps: mineflayer 4.39.0 and minecraft-data 3.119.0 are installed', () => {
    assert.equal(pkgVersion('mineflayer'), '4.39.0');
    assert.equal(pkgVersion('minecraft-data'), '3.119.0');
});

test('deps: the mineflayer patch is applied (tool-material fix and 500 ms place wait)', () => {
    assert.match(source('digging.js'),
        /if \(block\.material === 'incorrect_for_wooden_tool'\) block\.material = 'mineable\/pickaxe'/);
    const place = source('place_block.js');
    assert.match(place, /timeout: 500,/);
    assert.doesNotMatch(place, /timeout: 5000,/);
});

test('deps: 1.21.6 ores carry the material the patch maps', () => {
    for (const ore of ['iron_ore', 'diamond_ore', 'deepslate_iron_ore']) {
        assert.equal(block(ore).material, 'incorrect_for_wooden_tool', ore);
    }
});

test('deps: a stone/iron pickaxe digs ore at pickaxe speed, not as a bare hand', () => {
    const hand = digTimeWith(null);
    const stone = digTimeWith('stone_pickaxe');
    const iron = digTimeWith('iron_pickaxe');

    // Unpatched, prismarine-block finds no multiplier for a stone pickaxe on this material and
    // times it as a hand that can harvest (4.55 s on iron ore); with the patch it is ~1.15 s.
    const unpatchedStone = block('iron_ore').digTime(itemId('stone_pickaxe'), false, false, false, [], {});
    const ironOre = { hand: hand(block('iron_ore')), stone: stone(block('iron_ore')), iron: iron(block('iron_ore')) };
    assert.ok(ironOre.stone < 2000, `stone pickaxe on iron_ore ${ironOre.stone} ms`);
    assert.ok(ironOre.stone < unpatchedStone / 2, `${ironOre.stone} vs unpatched ${unpatchedStone}`);
    assert.ok(ironOre.stone * 5 < ironOre.hand, `stone ${ironOre.stone} vs hand ${ironOre.hand}`);
    assert.ok(ironOre.iron < ironOre.stone, `iron ${ironOre.iron} vs stone ${ironOre.stone}`);

    const diamondOre = { hand: hand(block('diamond_ore')), iron: iron(block('diamond_ore')) };
    assert.ok(diamondOre.iron < 2000, `iron pickaxe on diamond_ore ${diamondOre.iron} ms`);
    assert.ok(diamondOre.iron * 5 < diamondOre.hand, `iron ${diamondOre.iron} vs hand ${diamondOre.hand}`);

    // harvestTools still decides canHarvest: a wooden pickaxe on iron ore keeps the no-drop penalty.
    const wood = digTimeWith('wooden_pickaxe')(block('iron_ore'));
    assert.ok(wood > ironOre.stone * 2, `wood ${wood} vs stone ${ironOre.stone}`);
});
