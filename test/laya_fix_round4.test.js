// Fix round 4 (live play 3, 2026-11-11): stoppable jobs, a job kept across a
// restart, fights only with attackers (director v1.3), the craft chain
// without the player kit, the base-light test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { runStoppable, stopped } from '../src/agent/run_token.js';
import { saveJob, loadJob, restoreMessage, jobWords, MAX_AGE_MS } from '../src/agent/laya/job_save.js';
import { JobStack, decide, nextActivity } from '../src/agent/laya/director.js';
import { Attacks, isAttacker, fusing, ATTACK_MS } from '../src/agent/laya/attacks.js';
import { runCraft } from '../src/agent/laya/craft.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

test('runStoppable: returns within ~100 ms of an interrupt though the work never settles', async () => {
    const bot = { interrupt_code: false };
    const t0 = Date.now();
    setTimeout(() => { bot.interrupt_code = true; }, 50);
    const r = await runStoppable(bot, () => new Promise(() => {}), () => 'stopped');
    assert.equal(r, 'stopped');
    assert.ok(Date.now() - t0 < 400, `took ${Date.now() - t0} ms`);
});

test('runStoppable: the given-up work sees stopped() after the interrupt clears; nested runs too', async () => {
    const bot = { interrupt_code: false };
    const seen = [];
    const inner = async () => { await sleep(250); seen.push(stopped(bot)); };
    const work = () => runStoppable(bot, inner); // a chore's run inside its job's
    setTimeout(() => { bot.interrupt_code = true; }, 30);
    await runStoppable(bot, work);
    bot.interrupt_code = false; // the next action clears it
    await sleep(300);
    assert.deepEqual(seen, [true], 'the background work stops at its next check');
    // a run that ends by itself: its value, and its token is cancelled after
    let check = null;
    const v = await runStoppable(bot, async () => { setTimeout(() => { check = stopped(bot); }, 20); return 7; });
    assert.equal(v, 7);
    await sleep(40);
    assert.equal(check, true, 'nothing of a finished run goes on');
});

test('runStoppable: an error with no interrupt propagates; after an interrupt it is the stop value', async () => {
    const bot = { interrupt_code: false };
    await assert.rejects(runStoppable(bot, async () => { throw new Error('boom'); }), /boom/);
    bot.interrupt_code = true;
    assert.equal(await runStoppable(bot, async () => { throw new Error('Digging aborted'); }, () => 'x'), 'x');
});

test('job save: a player job is kept while on the stack, gone when it ends; restored paused after a restart', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jobsave-'));
    const path = join(dir, 'laya-job.json');
    const st = new JobStack();
    st.onChange = s => saveJob(path, s, 1000);
    const target = 35;
    const job = st.start('layaGather', ['coal', 4], { save: () => ({ target }) });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { name: 'layaGather', args: ['coal', 4], saved: { target: 35 }, at: 1000 });
    const m = st.pause('laya_defending');
    assert.ok(existsSync(path), 'kept while a mode has it paused');
    st.done(m);
    st.ended(job, 'done');
    assert.ok(!existsSync(path), 'gone when it ends');
    // a chore (no save) is not kept
    st.start('chore', ['rest'], { chore: 'rest' });
    assert.ok(!existsSync(path));
    st.clear();
    // !stop clears it
    st.start('layaMine', ['iron', 3], { save: () => ({ done: 1 }) });
    assert.ok(existsSync(path));
    st.clear();
    assert.ok(!existsSync(path));
    // load: fresh or old, read once
    writeFileSync(path, JSON.stringify({ name: 'layaGather', args: ['coal', 4], saved: { target: 35 }, at: 1000 }));
    assert.deepEqual(loadJob(path, 1000 + MAX_AGE_MS), { entry: { name: 'layaGather', args: ['coal', 4], saved: { target: 35 }, at: 1000 }, fresh: true });
    assert.equal(loadJob(path), null, 'read once');
    writeFileSync(path, JSON.stringify({ name: 'layaGather', args: ['coal', 4], at: 1000 }));
    assert.equal(loadJob(path, 1001 + MAX_AGE_MS).fresh, false);
    assert.equal(jobWords({ name: 'layaGather', args: ['coal', 4] }), 'get 4 coal');
    assert.equal(jobWords({ name: 'hunt', args: ['cow', 'beef', 3] }), 'hunt for 3 beef');
    assert.equal(jobWords({ name: 'layaFarm', args: ['any', 'any'] }), 'farm any');
    assert.match(restoreMessage({ name: 'layaMine', args: ['iron', 5] }, true), /carry on/);
    assert.match(restoreMessage({ name: 'layaMine', args: ['iron', 5] }, false), /lost my job \(mine 5 iron\)/);
});

test('attacks: a mob that hit andy or a player is an attacker for 15 s; one that hit nobody never is', () => {
    let now = 0;
    const a = new Attacks(() => now);
    const pos = (x, z) => ({ x, y: 64, z, distanceTo(o) { return Math.hypot(this.x - o.x, this.z - o.z); } });
    const zombie = { id: 1, name: 'zombie', position: pos(2, 0) };
    const skeleton = { id: 2, name: 'skeleton', position: pos(13, 0) };
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
    a.hurt('tester', skeleton);
    assert.equal(isAttacker(a, skeleton, me, []), true, 'shooting a player');
    a.gone(2);
    assert.equal(isAttacker(a, skeleton, me, []), false);
    // a creeper with its fuse lit near andy or a player
    const creeper = { id: 3, name: 'creeper', position: pos(3, 0), metadata: [] };
    assert.equal(isAttacker(a, creeper, me, []), false);
    creeper.metadata[16] = 1;
    assert.equal(fusing(creeper), true);
    assert.equal(isAttacker(a, creeper, me, []), true);
    assert.equal(isAttacker(a, { ...creeper, position: pos(20, 0) }, me, [pos(30, 0)]), false, 'fusing far from everyone');
    assert.equal(isAttacker(a, { ...creeper, position: pos(20, 0) }, me, [pos(22, 0)]), true, 'fusing by a player');
});

const calm = { job: null, paused: null, health: 20, food: 20, armed: 'axe', armor: 0, hostiles: 0, nearest: null,
    light: 15, night: false, under: false, free: 20, home: 40, valuables: 0, foodItems: 3, danger: 'none', last: 'none' };
const gather = { kind: 'gather', item: 'coal', left: 4 };

test('director v1.3: a skeleton 12 off attacking nobody: the job goes on; a hit is defended', async () => {
    const sk = { hostiles: 1, nearest: { kind: 'skeleton', dist: 12 } };
    assert.deepEqual(decide({ ...calm, ...sk, job: gather }), { activity: 'continue', rule: 'continue' });
    assert.deepEqual(decide({ ...calm, hostiles: 1, nearest: { kind: 'zombie', dist: 5 }, paused: 'gather' }), { activity: 'resume', rule: 'resume-paused' },
        'a zombie 5 off attacking nobody: the paused job is resumed');
    assert.deepEqual(decide({ ...calm, ...sk, job: gather, me: { attacked: true, by: 'skeleton', dist: 12 } }), { activity: 'defend', rule: 'defend' });
    assert.deepEqual(decide({ ...calm, ...sk, health: 6, foodItems: 2, me: { attacked: true, by: 'skeleton', dist: 12 } }), { activity: 'flee', rule: 'flee-low' },
        'attacked at health 6: flee');
    assert.deepEqual(decide({ ...calm, health: 8, hostiles: 1, nearest: { kind: 'zombie', dist: 6 } }), { activity: 'heal', rule: 'heal' },
        'heal no longer waits for a hostile within 8 to go');
    assert.deepEqual(decide({ ...calm, player: { name: 'tester', attacked: true, by: 'zombie', dist: 10 }, job: gather }), { activity: 'defend', rule: 'defend-player' });
    // the state the served v1.3 model sees
    const asked = [];
    const client = { decide: async (t, text) => { asked.push(text); return { answers: { Activity: { top: 'continue', topProbability: 0.9, confident: true } } }; } };
    await nextActivity({ ...calm, ...sk, job: gather, me: { attacked: true, by: 'skeleton', dist: 12.2 } }, { client, task: { prompt: 'v1.3' } });
    assert.match(asked[0], /\nHostiles 1 Nearest skeleton 12\nMe attacked yes by skeleton 12\nPlayer none attacked no by none none\n/);
});

// a craft deps fake: inventory counts by generic name, the chest (as the
// task may use it: the kit already left out), steps done
function craftFake(have, chest, answers = []) {
    const did = [];
    const items = () => Object.entries(have).filter(([, n]) => n > 0).map(([name, count]) => ({ name, count }));
    const recipes = { planks: [4, { log: 1 }], stick: [4, { planks: 2 }], stone_sword: [1, { cobblestone: 2, stick: 1 }], torch: [4, { coal: 1, stick: 1 }] };
    return {
        did,
        deps: {
            client: answers.length ? { decide: async () => {
                const [action, item, count, p = 0.9] = answers.shift() || ['done', 'none', 1];
                return { answers: { Action: { top: action, topProbability: p }, Item: { top: item, topProbability: p }, Count: { top: String(count), topProbability: p } }, ms: 1 };
            } } : null,
            task: { log_steps: false },
            items,
            near: () => ({ table: true, furnace: true, chest: true }),
            readChest: async () => ({ ...chest }),
            act: {
                craft: async (g, times) => {
                    const [out, needs] = recipes[g];
                    for (const [n, c] of Object.entries(needs)) { if ((have[n] || 0) < c * times) return false; }
                    for (const [n, c] of Object.entries(needs)) have[n] -= c * times;
                    have[g] = (have[g] || 0) + out * times;
                    did.push(`craft ${g}`);
                    return true;
                },
                take: async g => { did.push(`take ${g}`); return false; },
                gather: async g => { did.push(`gather ${g}`); return false; },
                smelt: async () => false, place: async () => false, store: async () => false,
            },
            log: () => {},
        },
    };
}

test('craft: 80 logs, 1 plank, 0 sticks, the kit sword in the chest: logs → planks → sticks → the stone sword', async () => {
    // the model's "take stick" (live play 3, p 0.92): not in the chest → the recipe rules
    const f = craftFake({ log: 80, planks: 1, cobblestone: 122 }, {}, [['take', 'stick', 1]]);
    const r = await runCraft('stone_sword', 1, f.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(f.did, ['craft planks', 'craft stick', 'craft stone_sword']);
    assert.ok(!f.did.some(d => d.startsWith('take')), 'never reaches for the kit');
});

test('craft: torches with no sticks; the model says done short of the goal; rules only (no model) chain too', async () => {
    let f = craftFake({ log: 80, planks: 1, coal: 31, torch: 14 }, {}, [['done', 'none', 1, 0.999]]);
    let r = await runCraft('torch', 18, f.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(f.did, ['craft planks', 'craft stick', 'craft torch']);
    f = craftFake({ log: 3, cobblestone: 2 }, {});
    r = await runCraft('stone_sword', 1, f.deps);
    assert.equal(r.ok, true, r.reason);
    assert.deepEqual(f.did, ['craft planks', 'craft stick', 'craft stone_sword']);
});

test('light_base: the sensor and the actuator share one dark-spot test', async () => {
    const { darkSpot } = await import('../src/agent/laya/chores_actions.js');
    const b = (name, light, box = 'empty') => ({ name, light, boundingBox: box });
    assert.equal(darkSpot(b('air', 3)), true);
    assert.equal(darkSpot(b('leaf_litter', 0)), true);
    assert.equal(darkSpot(b('air', 8)), false, 'lit');
    assert.equal(darkSpot(b('water', 0)), false);
    assert.equal(darkSpot(b('wall_torch', 0)), false, 'a torch is there');
    assert.equal(darkSpot(b('stone', 0, 'block')), false);
    assert.equal(darkSpot(null), false);
});

test('director: defend-player is performed only when no attacker is within the mode\'s reach (never both)', async () => {
    const { Director } = await import('../src/agent/laya/director.js');
    const performed = [];
    const hit = { name: 'tester', attacked: true, by: 'zombie', dist: 12 };
    let sit = { ...calm, player: hit, hostiles: 1, nearest: { kind: 'zombie', dist: 11 } };
    // the fight ends the attack (as killing the zombie would)
    const d = new Director({ read: () => sit, idle: () => true, now: () => 0,
        perform: async a => { performed.push(a); sit = { ...sit, player: { ...hit, attacked: false, by: 'none' } }; } });
    await d.tick();
    await sleep(5);
    assert.deepEqual(performed, ['defend'], 'the attacker is out of the mode\'s reach: the director goes');
    sit = { ...sit, player: hit, nearest: { kind: 'zombie', dist: 5 }, attackerNear: true };
    await d.tick();
    await sleep(5);
    assert.deepEqual(performed, ['defend'], 'the mode fights it: the director does not');
});

test('ActionManager.stop waits only for the action it set out to stop', async () => {
    const { ActionManager } = await import('../src/agent/action_manager.js');
    let killed = false;
    const agent = { bot: { interrupt_code: false, output: '', emit() {} }, requestInterrupt() {}, clearBotLogs() {}, cleanKill() { killed = true; },
        self_prompter: { isActive: () => false }, isIdle: () => false, history: { add() {} } };
    const am = new ActionManager(agent);
    am.executing = true; am.runId = 1;
    const p = am.stop();
    setTimeout(() => { am.runId = 2; }, 50); // the old one ended, a newer one started at once
    await p;
    assert.equal(killed, false);
});
