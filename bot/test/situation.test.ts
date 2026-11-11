// Facts → model situations (3.3): sensors read a fake world built to match each 3.2 golden sample, and
// the adapters must render the exact golden state text.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Sensors } from '../src/sensors/index.js';
import { directorSituation, directorState } from '../src/models/director/index.js';
import { eatSituation, eatState } from '../src/models/eat/index.js';
import { defendSituation, defendState } from '../src/models/defend/index.js';
import { fakeBot, mob } from './fakebot.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const golden = (dir: string): string => (JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures', dir, 'request.json'), 'utf8')) as { state: string }).state;

test('director: a world like laya-go\'s sample renders the v1.3 golden state', () => {
    const now = 1000;
    const bot = fakeBot({ health: 14, food: 12, free: 5,
        items: [{ name: 'iron_sword', count: 1 }, { name: 'bread', count: 4 }, { name: 'raw_iron', count: 3 }, { name: 'cobblestone', count: 64 }],
        slots: { 5: { name: 'chainmail_helmet', count: 1 }, 6: { name: 'iron_chestplate', count: 1 } } });
    bot.blocks.set('0,64,0', { name: 'cave_air', light: 4, skyLight: 0, boundingBox: 'empty' });
    bot.blocks.set('0,70,0', { name: 'stone', boundingBox: 'block' });
    const s = new Sensors(bot, { places: () => ({ home_chest: [18.5, 64, 0.5] }), now: () => now });
    s.attach();
    const zombie = bot.add(mob(1, 'zombie', 6.5, 0.5));
    bot.add(mob(2, 'skeleton', 0.5, 10.5));
    const chris = bot.addPlayer('chrisjoyce911', -11.5, 0.5);
    bot.hurt(bot.entity, zombie);
    bot.hurt(chris, zombie);
    assert.equal(directorState(directorSituation(s.read(), { kind: 'mine', item: 'iron_ore', left: 6 }), 'v1.3'), golden('laya-director-v13'));
});

test('director: fix round 4: a skeleton 12 off that hit andy; Me and Player lines', () => {
    let now = 0;
    const bot = fakeBot();
    const s = new Sensors(bot, { places: () => ({}), now: () => now, tickMs: 0 });
    s.attach();
    const sk = bot.add(mob(1, 'skeleton', 12.7, 0.5));
    let text = directorState(directorSituation(s.read()));
    assert.match(text, /\nHostiles 1 Nearest skeleton 13\nMe attacked no by none none\nPlayer none attacked no by none none\n/);
    assert.equal(s.read().mobs[0]?.attacker, false, 'attacking nobody');
    sk.position = { x: 12.2, y: 64, z: 0.5 };
    bot.hurt(bot.entity, sk);
    text = directorState(directorSituation(s.read()));
    assert.match(text, /\nHostiles 1 Nearest skeleton 12\nMe attacked yes by skeleton 12\nPlayer none attacked no by none none\n/);
    assert.equal(s.read().mobs[0]?.attacker, true);
    now = 5001;
    assert.match(directorState(directorSituation(s.read())), /\nMe attacked no by none none\n/, 'the Me line: 5 s');
    assert.equal(s.read().mobs[0]?.attacker, true, 'still an attacker for 15 s');
    now = 15_001;
    assert.equal(s.read().mobs[0]?.attacker, false);
});

test('eat: the golden sample\'s pack renders the eat v1 golden state; a hostile within 8 is danger', () => {
    const now = 0;
    const bot = fakeBot({ health: 14.7, food: 12, saturation: 0,
        items: [{ name: 'apple', count: 2 }, { name: 'golden_apple', count: 1 }, { name: 'apple', count: 1 }, { name: 'rotten_flesh', count: 2 }, { name: 'stone', count: 64 }] });
    const s = new Sensors(bot, { places: () => ({}), now: () => now, tickMs: 0 });
    bot.add(mob(1, 'zombie', 9.5, 0.5));
    assert.equal(eatState(eatSituation(s.read())), golden('laya-eat-v1'));
    bot.add(mob(2, 'zombie', 7.5, 0.5));
    assert.match(eatState(eatSituation(s.read())), /Danger yes/);
});

test('defend: only attackers, night ≥ 13000, shield in the off-hand: the defend v1 golden state', () => {
    const now = 0;
    const bot = fakeBot({ health: 14, food: 12, time: 23500,
        items: [{ name: 'bow', count: 1 }, { name: 'iron_sword', count: 1 }, { name: 'arrow', count: 12 }, { name: 'golden_apple', count: 1 }, { name: 'dirt', count: 3 }],
        slots: { 5: { name: 'chainmail_helmet', count: 1 }, 6: { name: 'iron_chestplate', count: 1 }, 45: { name: 'shield', count: 1 } } });
    const s = new Sensors(bot, { places: () => ({}), now: () => now, tickMs: 0 });
    s.attach();
    const zombie = bot.add(mob(1, 'zombie', 2.5, -1.5, { health: 20 }));
    const skel = bot.add(mob(2, 'skeleton', -11.5, 4.5));
    bot.add(mob(3, 'zombie', 3.5, 3.5)); // attacking nobody: left out
    bot.add(mob(4, 'zombie', 30.5, 0.5));
    bot.add({ id: 5, name: 'cow', type: 'animal', position: { x: 1.5, y: 64, z: 1.5 } });
    const tester = bot.addPlayer('tester', -12.5, 9.5);
    bot.hurt(bot.entity, zombie);
    bot.hurt(tester, skel);
    const f = s.read();
    assert.equal(f.night, false, 'the director\'s night ends at 23000');
    assert.equal(defendState(defendSituation(f)), golden('laya-defend-v1'));
    bot.addPlayer('chris', 4, 0);
    assert.match(defendState(defendSituation(s.read())), /Player yes/);
});
