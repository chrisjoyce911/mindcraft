// 5.1 laya-go's craft item table against minecraft-data 3.119's 1.21.6 recipes: for every crafted item, a real
// recipe with the same ingredients (by generic name), the same result count, and the same table flag (a recipe
// wider or taller than 2, or with more than 4 ingredients, needs a crafting table). It catches drift between
// laya-go's table and the game. Smelted items: their source smelts (minecraft-data has no furnace recipes; the
// sources are checked to be items).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CRAFT_ITEMS, FUELS, PICKAXES, itemDef, generic, isCraftItem } from '../src/models/craft/index.js';

const require = createRequire(import.meta.url);
interface Recipe { inShape?: (number | null)[][]; ingredients?: number[]; result: { id: number; count: number } }
const mcData = require('minecraft-data')('1.21.6') as {
    itemsByName: Record<string, { id: number; name: string }>;
    items: Record<number, { name: string }>;
    recipes: Record<number, Recipe[]>;
};

/** The Minecraft item a generic name crafts as (planks: oak_planks). */
const realOf = (g: string) => (g === 'planks' ? 'oak_planks' : g === 'log' ? 'oak_log' : g);

function shape(r: Recipe): { ingredients: Record<string, number>; table: boolean } {
    const ids = r.inShape ? r.inShape.flat().filter((x): x is number => x !== null) : r.ingredients ?? [];
    const wide = r.inShape ? r.inShape.length > 2 || r.inShape.some(row => row.length > 2) : ids.length > 4;
    const ingredients: Record<string, number> = {};
    for (const id of ids) {
        const g = generic(mcData.items[id]!.name);
        ingredients[g] = (ingredients[g] ?? 0) + 1;
    }
    return { ingredients, table: wide };
}

test('every crafted item: a minecraft-data recipe with the same ingredients, result count and table flag', () => {
    let checked = 0;
    for (const name of CRAFT_ITEMS) {
        const def = itemDef(name);
        if (def.kind !== 'crafted') continue;
        const item = mcData.itemsByName[realOf(name)];
        assert.ok(item, `${name} is a Minecraft item`);
        const recipes = mcData.recipes[item.id] ?? [];
        assert.ok(recipes.length, `${name} has a recipe`);
        const want = Object.fromEntries(def.needs.map(([n, c]) => [n, c]));
        const match = recipes.map(shape).find((s, i) =>
            JSON.stringify(Object.entries(s.ingredients).sort()) === JSON.stringify(Object.entries(want).sort())
            && recipes[i]!.result.count === def.result);
        assert.ok(match, `${name}: no recipe of ${JSON.stringify(want)} → ${def.result}; minecraft-data has ` +
            JSON.stringify(recipes.slice(0, 3).map(r => [shape(r).ingredients, r.result.count])));
        assert.equal(match.table, !!def.table, `${name}: table flag`);
        checked++;
    }
    assert.ok(checked >= 35, `checked ${checked} crafted items`);
});

test('gathered and smelted items, the pickaxes and the fuels are Minecraft items', () => {
    for (const name of CRAFT_ITEMS) {
        const def = itemDef(name);
        if (def.kind === 'smelted') {
            assert.ok(isCraftItem(def.source), `${name}'s source ${def.source}`);
            assert.ok(mcData.itemsByName[realOf(def.source)], `${def.source} is an item`);
        }
        assert.ok(mcData.itemsByName[realOf(name)], `${name} is an item`);
        if (def.kind === 'crafted') for (const [n] of def.needs) assert.ok(isCraftItem(n), `${name} needs ${n}, a craft item`);
    }
    for (const n of [...PICKAXES, ...FUELS]) assert.ok(isCraftItem(n));
});
