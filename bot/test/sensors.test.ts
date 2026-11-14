// The sensors (3.3): attacks (fix round 4), hurt wiring, the readers, the stuck watch, Sensors.read,
// and the ported pure tests of the old bot (laya_fix_round4 attacks, laya_director situation helpers,
// laya_home_chest homeState, laya_pack homeDistance/countHostiles).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Attacks, ATTACK_MS, fusing, isAttacker } from '../src/sensors/attacks.js';
import { onHurt } from '../src/sensors/hurt.js';
import { armedOf, armorPoints } from '../src/sensors/vitals.js';
import { dangerOf, feel } from '../src/sensors/danger.js';
import { homeFacts, homeState } from '../src/sensors/home.js';
import { countHostiles, homeDistance, packFacts, valuables } from '../src/sensors/pack.js';
import { lightFacts } from '../src/sensors/light.js';
import { playerFact } from '../src/sensors/player.js';
import { mobKind, isHostile } from '../src/sensors/mobs.js';
import { Sensors, factsLine } from '../src/sensors/index.js';
import { StuckWatch } from '../src/core/stuck.js';
import { mobKind as renderMobKind } from '../src/models/director/render.js';
import type { SensorEntity } from '../src/sensors/bot.js';
import { fakeBot, mob } from './fakebot.js';

const pos = (x: number, z: number) => ({ x, y: 64, z });

test('attacks: a mob that hit andy or a player is an attacker for 15 s; one that hit nobody never is', () => {
    let now = 0;
    const a = new Attacks(() => now);
    const zombie: SensorEntity = { id: 1, name: 'zombie', position: pos(2, 0) };
    const skeleton: SensorEntity = { id: 2, name: 'skeleton', position: pos(13, 0) };
    const me = pos(0, 0);
    assert.equal(isAttacker(a, skeleton, me, []), false, 'a skeleton 13 away attacking nobody');
    assert.equal(a.hurt('self', null), false, 'not a mob\'s hit');
    a.hurt('self', zombie);
    assert.equal(isAttacker(a, zombie, me, []), true);
    assert.equal(isAttacker(a, skeleton, me, []), false);
    assert.deepEqual(a.selfFact(now, 5000), { attacked: true, by: 'zombie', entity: zombie });
    now = 6000;
    assert.equal(a.selfFact(now, 5000).attacked, false, 'the Me line: 5 s');
    assert.equal(isAttacker(a, zombie, me, []), true, 'still fought');
    now = ATTACK_MS + 1;
    assert.equal(isAttacker(a, zombie, me, []), false, 'after 15 s with no hit: left alone');
    a.hurt({ player: 'tester' }, skeleton);
    assert.equal(isAttacker(a, skeleton, me, []), true, 'shooting a player');
    a.gone(2);
    assert.equal(isAttacker(a, skeleton, me, []), false);
    // a creeper with its fuse lit near andy or a player
    const meta: unknown[] = [];
    const creeper: SensorEntity = { id: 3, name: 'creeper', position: pos(3, 0), metadata: meta };
    assert.equal(isAttacker(a, creeper, me, []), false);
    meta[16] = 1;
    assert.equal(fusing(creeper), true);
    assert.equal(isAttacker(a, creeper, me, []), true);
    assert.equal(isAttacker(a, { ...creeper, position: pos(20, 0) }, me, [pos(30, 0)]), false, 'fusing far from everyone');
    assert.equal(isAttacker(a, { ...creeper, position: pos(20, 0) }, me, [pos(22, 0)]), true, 'fusing by a player');
    const ignited: SensorEntity = { id: 4, name: 'creeper', position: pos(1, 0), metadata: Object.assign([], { 18: true }) };
    assert.equal(fusing(ignited), true, 'ignited (flint and steel)');
    assert.equal(fusing({ id: 5, name: 'zombie', position: pos(1, 0), metadata: Object.assign([], { 16: 1 }) }), false, 'only creepers fuse');
});

test('attacks: the Me fact needs the mob still valid; the player hit window is 5 s', () => {
    let now = 0;
    const a = new Attacks(() => now);
    const z: SensorEntity = { id: 1, name: 'zombie', position: pos(2, 0) };
    a.hurt('self', z);
    z.isValid = false;
    assert.equal(a.selfFact(now, 5000).attacked, false, 'dead mob: no Me line');
    a.hurt({ player: 'tester' }, { id: 2, name: 'skeleton', position: pos(5, 0) });
    now = 5000;
    assert.equal(a.playerHit('tester', now)?.mob.id, 2);
    now = 5001;
    assert.equal(a.playerHit('tester', now), null);
});

test('hurt wiring: source mob, blame within 4, falls and far players ignored, entityGone forgets', () => {
    let now = 0;
    const bot = fakeBot();
    const s = new Sensors(bot, { places: () => ({}), now: () => now, tickMs: 0 });
    const detach = s.attach();
    assert.equal(bot.listeners(), 2);
    const zombie = bot.add(mob(1, 'zombie', 2, 0));
    const skel = bot.add(mob(2, 'skeleton', 10, 0));
    // a source mob
    bot.hurt(bot.entity, skel);
    assert.equal(s.attacks.attacking(skel, now), true);
    assert.equal(s.read().me?.by, 'skeleton');
    // no source: the nearest hostile within 4 of the victim is blamed
    const tester = bot.addPlayer('tester', 9, 3);
    now = 100;
    bot.hurt(tester);
    assert.equal(s.attacks.playerHit('tester', now)?.mob.id, 2, 'the skeleton is 3.2 from tester');
    // a fall (no source, no hostile within 4) is ignored
    const far = bot.addPlayer('far', -20, 0);
    assert.equal(onHurt(bot, s.attacks, far), false);
    // a player 30 away is ignored even with a mob by them
    const away = bot.addPlayer('away', 30, 0);
    bot.add(mob(3, 'zombie', 31, 0));
    assert.equal(onHurt(bot, s.attacks, away), false);
    // a player's hit (source not hostile) is not a mob's
    assert.equal(onHurt(bot, s.attacks, bot.entity, tester), false);
    // a non-player victim is ignored
    assert.equal(onHurt(bot, s.attacks, zombie, skel), false);
    bot.gone(skel);
    assert.equal(s.attacks.attacking(skel, now), false, 'gone: forgotten');
    detach();
    assert.equal(bot.listeners(), 0);
});

test('situation helpers (laya_director)', () => {
    assert.equal(armedOf(['dirt', 'stone_axe', 'iron_sword']), 'sword');
    assert.equal(armedOf(['wooden_axe']), 'axe');
    assert.equal(armedOf(['bow']), 'other');
    assert.equal(armedOf(['wooden_pickaxe']), 'none');
    assert.equal(armorPoints(['iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots']), 15);
    assert.equal(armorPoints(['leather_boots', 'turtle_helmet']), 3);
    assert.equal(armorPoints(['chainmail_helmet', 'iron_chestplate']), 8, 'the defend golden armour');
    assert.equal(dangerOf({ onFire: true, lavaNear: true }), 'fire');
    assert.equal(dangerOf({ headInWater: true, oxygen: 4 }), 'drowning');
    assert.equal(dangerOf({ headInWater: true, oxygen: 18 }), 'none');
    assert.equal(dangerOf({ lavaNear: true }), 'fluid');
    assert.equal(dangerOf({ falling: true }), 'fall');
});

test('homeState (laya_home_chest): the home chest must be a chest', () => {
    const blocks: Record<string, { name: string }> = { '1,64,1': { name: 'chest' }, '2,64,1': { name: 'dirt' } };
    const blockAt = (x: number, y: number, z: number) => blocks[`${x},${y},${z}`] ?? null;
    assert.equal(homeState([1, 64, 1], blockAt), 'ok');
    assert.equal(homeState([2.4, 64.9, 1.2], blockAt), 'gone', 'a fake home chest (no chest there)');
    assert.equal(homeState([9, 64, 9], blockAt), 'unknown', 'not loaded');
    assert.equal(homeState(undefined, blockAt), 'unknown');
    assert.deepEqual(homeFacts({ home_chest: [1, 64, 1] }, pos(4, 5), blockAt), { home: { dist: 5 }, homeGone: false });
    assert.deepEqual(homeFacts({ home_chest: [2, 64, 1] }, pos(4, 5), blockAt), { home: null, homeGone: true });
    assert.deepEqual(homeFacts({ home_chest: [9, 64, 9] }, pos(9, 12), blockAt), { home: { dist: 3 }, homeGone: false }, 'unknown: still home');
    assert.deepEqual(homeFacts({}, pos(0, 0), blockAt), { home: null, homeGone: false });
});

test('pack (laya_pack): home distance, countHostiles, valuables, food items, worn and off-hand', () => {
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }), 5);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 0.2, y: 0, z: 0 }), 1);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }), 1);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }), 999);
    assert.equal(homeDistance({ x: 0, y: 0, z: 0 }, null), null);
    const me: SensorEntity = { id: 0, position: pos(0, 0) };
    const at = (x: number, hostile = true): SensorEntity & { hostile: boolean } => ({ id: x, position: pos(x, 0), hostile });
    assert.equal(countHostiles([at(3), at(20), at(5, false), me, null], me, e => (e as { hostile?: boolean }).hostile === true), 1);
    assert.equal(valuables({ diamond: 2, coal: 5, iron_ingot: 1, dirt: 64 }), 5);
    assert.equal(valuables({ diamond: 5000 }), 999);
    const bot = fakeBot({ items: [{ name: 'bread', count: 3 }, { name: 'spider_eye', count: 2 }, { name: 'coal', count: 4 }, { name: 'iron_sword', count: 1 }],
        slots: { 6: { name: 'iron_chestplate', count: 1 }, 45: { name: 'shield', count: 1 } } });
    const p = packFacts(bot);
    assert.equal(p.foodItems, 3, 'harmful spider eyes not counted');
    assert.equal(p.valuables, 2);
    assert.deepEqual(p.worn, ['iron_chestplate']);
    assert.equal(p.offhand, 'shield');
    assert.equal(p.free, 32);
});

test('mobs: kinds and hostility', () => {
    assert.equal(mobKind('stray'), 'skeleton');
    assert.equal(mobKind('bogged'), 'skeleton');
    assert.equal(mobKind('witch'), 'other');
    assert.equal(mobKind(undefined), 'other');
    assert.equal(renderMobKind, mobKind, 'render re-exports the sensors one');
    assert.equal(isHostile({ id: 1, name: 'zombie', type: 'hostile', position: pos(0, 0) }), true);
    assert.equal(isHostile({ id: 1, name: 'iron_golem', type: 'mob', position: pos(0, 0) }), false);
    assert.equal(isHostile({ id: 1, name: 'cow', type: 'animal', position: pos(0, 0) }), false);
});

test('light: block light, sky light by day only, night 13000–23000, a roof above', () => {
    const bot = fakeBot({ time: 6000 });
    bot.blocks.set('0,64,0', { name: 'air', light: 4, skyLight: 15, boundingBox: 'empty' });
    assert.deepEqual(lightFacts(bot), { light: 15, night: false, under: false, time: 6000 });
    bot.time.timeOfDay = 14000;
    assert.deepEqual(lightFacts(bot), { light: 4, night: true, under: false, time: 14000 });
    bot.time.timeOfDay = 23500;
    assert.equal(lightFacts(bot).night, false, 'dawn');
    bot.blocks.set('0,100,0', { name: 'stone', boundingBox: 'block' });
    assert.equal(lightFacts(bot).under, true, '36 up');
    bot.blocks.delete('0,100,0');
    bot.blocks.set('0,129,0', { name: 'stone', boundingBox: 'block' });
    assert.equal(lightFacts(bot).under, false, 'over 64 up');
});

test('danger reader: lava near, fire, drowning, falling', () => {
    const bot = fakeBot();
    assert.equal(dangerOf(feel(bot)), 'none');
    bot.blocks.set('1,65,0', { name: 'lava' });
    assert.equal(dangerOf(feel(bot)), 'fluid');
    bot.blocks.clear();
    bot.entity.metadata = [1];
    assert.equal(dangerOf(feel(bot)), 'fire');
    bot.entity.metadata = [0];
    bot.blocks.set('0,65,0', { name: 'water' });
    bot.oxygenLevel = 5;
    assert.equal(dangerOf(feel(bot)), 'drowning');
    bot.blocks.clear();
    bot.entity.onGround = false;
    bot.entity.velocity = { x: 0, y: -1, z: 0 };
    assert.equal(dangerOf(feel(bot)), 'fall');
    bot.blocks.set('0,64,0', { name: 'water' });
    assert.equal(dangerOf(feel(bot)), 'none', 'falling into water');
});

test('player fact: a player hit in the last 5 s beats a nearer unhurt one; over 24 ignored', () => {
    let now = 0;
    const bot = fakeBot();
    const a = new Attacks(() => now);
    assert.equal(playerFact(bot, a, now), null);
    bot.addPlayer('near', 3, 0);
    bot.addPlayer('hurt', 10, 0);
    bot.addPlayer('far', 30, 0);
    assert.equal(playerFact(bot, a, now)?.name, 'near');
    const z = bot.add(mob(1, 'zombie', 11, 0));
    a.hurt({ player: 'hurt' }, z);
    const p = playerFact(bot, a, now);
    assert.equal(p?.name, 'hurt');
    assert.equal(p?.attacked?.by, 'zombie');
    a.hurt({ player: 'far' }, z);
    assert.equal(playerFact(bot, a, now)?.name, 'hurt', 'far is out of reach');
    now = 5001;
    assert.equal(playerFact(bot, a, now)?.name, 'near', 'after 5 s: the nearest');
});

test('stuck watch: only while moving; 20 s still; obsidian 40 s; progress or a new dig target resets', () => {
    const w = new StuckWatch();
    const p = pos(0, 0);
    for (let t = 0; t <= 60_000; t += 1000) assert.equal(w.feed(p, false, null, t), false, 'not moving: never stuck');
    const w2 = new StuckWatch();
    let stuck = false, t = 0;
    for (; t <= 30_000 && !stuck; t += 1000) stuck = w2.feed(p, true, null, t);
    assert.equal(stuck, true);
    assert.equal(t - 1000, 21_000, 'stuck after more than 20 s');
    assert.equal(w2.feed(pos(3, 0), true, null, t), false, 'moved 3: progress');
    const w3 = new StuckWatch();
    const obs = { name: 'obsidian', x: 1, y: 64, z: 0 };
    let first = -1;
    for (let s = 0; s <= 50_000; s += 1000) if (w3.feed(p, true, obs, s) && first < 0) first = s;
    assert.equal(first, 41_000, 'obsidian: twice as long');
    const w4 = new StuckWatch();
    w4.feed(p, true, { name: 'stone', x: 1, y: 64, z: 0 }, 0);
    w4.feed(p, true, { name: 'stone', x: 1, y: 64, z: 0 }, 15_000);
    assert.equal(w4.feed(p, true, { name: 'stone', x: 2, y: 64, z: 0 }, 19_000), false);
    assert.equal(w4.feed(p, true, { name: 'stone', x: 2, y: 64, z: 0 }, 30_000), false, 'a new dig target reset it');
    assert.equal(w4.feed(p, true, { name: 'stone', x: 2, y: 64, z: 0 }, 41_000), true);
});

test('Sensors.read: one snapshot per tick; the facts line', () => {
    let now = 1000;
    const bot = fakeBot({ health: 13.5, food: 12, saturation: 2.345, items: [{ name: 'stone_sword', count: 1 }, { name: 'bread', count: 2 }],
        slots: { 5: { name: 'iron_helmet', count: 1 } } });
    bot.blocks.set('0,64,0', { name: 'air', light: 0, skyLight: 15 });
    const s = new Sensors(bot, { places: () => ({ home_chest: [3, 64, 4] }), now: () => now });
    bot.blocks.set('3,64,4', { name: 'chest' });
    bot.add(mob(1, 'zombie', 5.5, 0.5));
    bot.add(mob(2, 'stray', 0.5, 17.5));
    bot.add({ id: 3, name: 'cow', type: 'animal', position: pos(2, 0) });
    const f = s.read();
    assert.equal(f.hostiles, 1, 'the stray is 17 off: scanned (defend reads 18) but not a Hostile');
    assert.deepEqual(f.nearest, { kind: 'zombie', dist: 5 });
    assert.deepEqual(f.mobs.map(m => m.name), ['zombie', 'stray']);
    assert.equal(f.saturation, 2.3);
    assert.equal(f.armed, 'sword');
    assert.equal(f.armor, 2);
    assert.equal(f.foodItems, 2);
    assert.deepEqual(f.home, { dist: 5 });
    assert.equal(f.stuck, false);
    bot.add(mob(4, 'zombie', 1, 1));
    now = 1100;
    assert.equal(s.read(), f, 'cached within the tick');
    now = 1250;
    assert.equal(s.read().hostiles, 2, 'a new tick');
    assert.equal(factsLine(s.read()), 'health 14 food 12 · hostiles 2 nearest zombie 1 · me none · player none · light 15 night no under no danger none · home 5 stuck no');
});

test('Sensors.read: stuck only while Motion moves', () => {
    let now = 0, moving = false;
    const bot = fakeBot();
    const s = new Sensors(bot, { places: () => ({}), now: () => now, moving: () => moving, tickMs: 0 });
    for (; now <= 25_000; now += 1000) assert.equal(s.read().stuck, false);
    moving = true;
    let stuck = false;
    for (const end = now + 25_000; now <= end && !stuck; now += 1000) stuck = s.read().stuck;
    assert.equal(stuck, true);
});
