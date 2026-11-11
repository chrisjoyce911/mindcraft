// The farm log sessions: fake farms in the old farmWithLaya deps shape (test/laya_farm.test.js setup/setupV2) and a
// set of runs that between them write every laya-farm.jsonl entry shape: model steps (done, failed, harvested), a
// veto and the banned answer the rules replace, low-confidence and no-answer (v1), crafted and craft-failed, the
// rules when unsure (v2), the Unload probability and unload done/failed, a dry wait made a pond, find_water
// no-water / went-to-water / water-unreachable, waits, the seed of the crop asked for, max_bad and the count goal.
// Shared by record-farm.mjs (the old JS writes the fixture) and bot/test/farm.log.test.ts (the new FarmRun must
// write the same lines). Each make() returns a fresh {bot, deps, goal}.
import { readFileSync } from 'fs';

const Y0 = 64;
const golden = JSON.parse(readFileSync(new URL('../../test/fixtures/laya-farm-v1/request.json', import.meta.url), 'utf8'));
// the golden farm's rows (laya-go games/farm/prompt sampleRows) as its state has them
const ROWS = golden.state.split('\n').slice(3);
const CARRY = [{ item: 'hoe', count: 1 }, { item: 'bone_meal', count: 3 }, { item: 'wheat_seeds', count: 12 }, { item: 'carrot', count: 5 }];
const HERDS = [{ kind: 'cow', count: 2 }, { kind: 'pig', count: 3 }];
const PLATEAU = ['XXLLLLLLL', 'XXLLLLLLL', 'XLLLLLLLL', 'LLLLLLLXL', 'LLLLLLLLL', 'LLLLLLLXL', 'LLLLLLLLL', 'LLLLLLLLL', 'LLLLLLLLL'];
const WET_GRASS = ['GGGGWGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG', 'GGGGGGGGG'];

const view = (rows, carry, animals = []) => ({ grid: rows.map(r => [...r]), ys: rows.map(() => Array(9).fill(Y0)), carry, animals });

const reply = (action, target, item, p = 0.9, ms = 3) => {
    const ans = top => ({ type: 'choice', top, topProbability: p, confident: p >= 0.5, probabilities: { [top]: p } });
    return { model: 'fake', ms, answers: { Action: ans(action), Target: ans(target), Item: ans(item) } };
};
const withUnload = (r, p, confident = true) => ({ ...r, answers: { ...r.answers, Unload: { type: 'noul', probability: p, top: p >= 0.5 ? 'true' : 'false', topProbability: Math.max(p, 1 - p), confident } } });

// farm builds a fake farm: the situation read every step, the model's answers in turn, what craft and act do.
function farm({ situation, answers, task = {}, v2 = false, inv = {}, craftOk = () => true, actOk = () => true, water = null, reachWater = true,
    home = null, free = () => 20, goHome = () => true }) {
    let t = 0, i = 0;
    let s = situation;
    const inventory = { ...inv };
    const bot = { interrupt_code: false };
    const deps = {
        client: { decide: async () => answers[Math.min(i++, answers.length - 1)] },
        task: { step_ms: 10, max_steps: answers.length, max_misses: 2, log_steps: true, ...(v2 ? { prompt: 'v2', wait_limit: 3 } : {}), ...task },
        read: () => s,
        act: async action => {
            if (action === 'harvest') inventory.wheat = (inventory.wheat || 0) + 6;
            return actOk(action);
        },
        craft: async (item, count) => {
            const ok = craftOk(item);
            if (ok) { s = { ...s, carry: [...s.carry, { item, count }] }; inventory[item] = (inventory[item] || 0) + count; }
            return ok;
        },
        now: () => t, sleep: async ms => { t += ms; }, log: () => {},
        inventory: () => ({ ...inventory }),
        say: () => {},
    };
    if (v2) Object.assign(deps, {
        position: () => ({ x: 0, y: Y0 + 1, z: 0 }),
        goTo: async () => reachWater,
        findWater: async () => water,
        pack: {
            freeSlots: () => free(), hostiles: () => 0, health: () => 20, food: () => 20,
            home: () => home, goHome: async () => goHome(),
            deposit: async items => { for (const it of items) inventory[it.name] -= it.count; return true; },
            isFood: n => n === 'bread',
        },
    });
    return { bot, deps };
}

export const SESSIONS = [
    // v1: harvest (harvested), plant, a veto, the banned answer → the rules, low-confidence, no answer, a wait
    { goal: 60000, make: () => farm({ situation: view(ROWS, CARRY, HERDS), answers: [
        reply('harvest', 'W2 N1', 'none'), reply('plant', 'E1 N2', 'carrot'), reply('till', 'E0 S0', 'hoe'), reply('till', 'E0 S0', 'hoe'),
        reply('harvest', 'W2 N1', 'none', 0.3), null, reply('wait', 'none', 'none')] }) },
    // v1: the starter kit (hoe crafted, seeds craft-failed), a missing water bucket crafted, bone meal fails
    { goal: 60000, make: () => farm({ situation: view(ROWS, [], HERDS), craftOk: item => item !== 'wheat_seeds', actOk: () => false,
        answers: [reply('water', 'E1 N2', 'none'), reply('bone_meal', 'W1 N1', 'bone_meal'), reply('bone_meal', 'W1 N1', 'bone_meal')] }) },
    // v1: no hoe to be had
    { goal: 60000, make: () => farm({ situation: view(ROWS, [], HERDS), craftOk: () => false, answers: [reply('wait', 'none', 'none')] }) },
    // v1: two no-answers in a row stop
    { goal: 60000, make: () => farm({ situation: view(ROWS, CARRY, HERDS), answers: [null, null, null] }) },
    // v2: the dry plateau, no water near
    { goal: { crop: 'any' }, make: () => farm({ v2: true, situation: view(PLATEAU, [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]),
        answers: [reply('wait', 'none', 'none', 1)] }) },
    // v2: walks to water once, still dry
    { goal: { crop: 'any' }, make: () => farm({ v2: true, situation: view(PLATEAU, [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]),
        water: { x: 30, y: 63, z: 4 }, answers: [reply('find_water', 'none', 'none'), reply('find_water', 'none', 'none')] }) },
    // v2: water it can't reach
    { goal: { crop: 'any' }, make: () => farm({ v2: true, situation: view(PLATEAU, [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]),
        water: { x: 30, y: 63, z: 4 }, reachWater: false, answers: [reply('find_water', 'none', 'none')] }) },
    // v2: a dry wait made a pond (done), then failed ponds, banned, until max_bad
    { goal: { crop: 'any' }, make: () => {
        let n = 0;
        return farm({ v2: true, situation: view(PLATEAU, [{ item: 'hoe', count: 1 }, { item: 'water_bucket', count: 1 }, { item: 'wheat_seeds', count: 3 }]),
            task: { max_steps_open: 12 }, actOk: () => n++ === 0, answers: [reply('wait', 'none', 'none'), ...Array(11).fill(reply('pond', 'W1 N1', 'water_bucket'))] });
    } },
    // v2: a pond with no water bucket to be had on dry ground: craft-failed, then find water (none)
    { goal: { crop: 'any' }, make: () => farm({ v2: true, situation: view(PLATEAU, [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 3 }]),
        craftOk: () => false, answers: [reply('pond', 'E0 N1', 'water_bucket')] }) },
    // v2: unsure → the rules; the Unload probability; a full pack unloads (done), a failed unload; the count reached
    { goal: { crop: 'wheat', count: 12 }, make: () => {
        let free = 0, trips = 0;
        return farm({ v2: true, situation: view(ROWS, CARRY, HERDS), home: { x: 10, y: Y0 + 1, z: 10 }, free: () => free,
            inv: { iron_hoe: 1, wheat: 60, wheat_seeds: 40, bread: 2 },
            goHome: () => { trips++; if (trips === 1) { free = 20; return true; } return false; },
            // the failed unload comes after a harvest, so there is wheat to put in (the new bot never unloads an empty pack)
            answers: [withUnload(reply('wait', 'none', 'none', 0.2), 0.1, false), withUnload(reply('harvest', 'W2 N1', 'none'), 0.1),
                withUnload(reply('harvest', 'W2 N1', 'none'), 0.9), withUnload(reply('harvest', 'W2 N1', 'none', 0.3), 0.2)] });
    } },
    // v2: the crop asked for: its seed is planted (the answer's item logged); the wet grass waits until wait_limit
    { goal: { crop: 'carrots' }, make: () => farm({ v2: true, situation: view(ROWS, CARRY, HERDS), task: { max_steps_open: 1 },
        answers: [reply('plant', 'E1 N2', 'wheat_seeds')] }) },
    { goal: { crop: 'any' }, make: () => farm({ v2: true, situation: view(WET_GRASS, [{ item: 'hoe', count: 1 }, { item: 'wheat_seeds', count: 1 }]),
        answers: Array(5).fill(withUnload(reply('wait', 'none', 'none'), 0.05)) }) },
];
