import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlan, cellAt, firstLevel } from '../src/agent/laya/mine_plan.js';
import { ORES } from '../src/agent/laya/mine_state.js';

// follow walks a plan perfectly for n answers and returns them, with the
// feet after each (a step lands on its target, a walk on its cell).
function follow(plan, feet, n, { abandonWhen = () => false } = {}) {
    const out = [];
    for (let i = 0; i < n; i++) {
        const r = plan.next(feet);
        if (r.done) { out.push({ done: r.done }); break; }
        if (r.walk) feet = r.walk;
        else if (abandonWhen(r, feet)) { plan.abandon(); out.push({ abandoned: r.step, segment: r.segment, feet }); continue; }
        else feet = r.target;
        out.push({ ...r, feet: { ...feet } });
    }
    return { out, feet };
}

const iron = { lo: ORES.iron.lo, hi: ORES.iron.hi };

test('staircase to the first level: down N from Y 70 to 24, then the main tunnel', () => {
    const plan = createPlan({ x: 0, y: 70, z: 0, heading: 'N' }, iron);
    const { out } = follow(plan, { x: 0, y: 70, z: 0 }, 47);
    assert.ok(out.slice(0, 46).every(r => r.step === 'down N' && r.segment === 'stair'));
    assert.deepEqual(out[45].feet, { x: 0, y: 24, z: -46 });
    assert.equal(out[46].step, 'tunnel N');
    assert.equal(out[46].segment, 'main');
    assert.equal(firstLevel(70, 8, 24), 24);
    assert.equal(firstLevel(15, 8, 24), 15);
    assert.equal(firstLevel(0, 8, 24), 8);
});

test('inside the band: no staircase, the main tunnel starts at once', () => {
    const plan = createPlan({ x: 5, y: 15, z: 5, heading: 'E' }, iron);
    assert.deepEqual(plan.next({ x: 5, y: 15, z: 5 }), { step: 'tunnel E', target: { x: 6, y: 15, z: 5 }, segment: 'main' });
});

test('branches every three blocks: 16 west, walk back, 16 east, then the main tunnel continues', () => {
    const plan = createPlan({ x: 0, y: 20, z: 0, heading: 'N' }, iron);
    const { out } = follow(plan, { x: 0, y: 20, z: 0 }, 3 + 16 + 1 + 16 + 1 + 1);
    assert.ok(out.slice(0, 3).every(r => r.step === 'tunnel N'));
    assert.deepEqual(out[2].feet, { x: 0, y: 20, z: -3 });
    assert.ok(out.slice(3, 19).every(r => r.step === 'tunnel W' && r.segment === 'branch'));
    assert.deepEqual(out[18].feet, { x: -16, y: 20, z: -3 });
    assert.deepEqual(out[19].walk, { x: 0, y: 20, z: -3 });
    assert.ok(out.slice(20, 36).every(r => r.step === 'tunnel E'));
    assert.deepEqual(out[35].feet, { x: 16, y: 20, z: -3 });
    assert.deepEqual(out[36].walk, { x: 0, y: 20, z: -3 });
    assert.equal(out[37].step, 'tunnel N');
    assert.equal(out[37].segment, 'main');
});

test('next level: 4 down ahead from the main end, and that main runs back south', () => {
    const plan = createPlan({ x: 0, y: 24, z: 0, heading: 'N' }, iron);
    const { out } = follow(plan, { x: 0, y: 24, z: 0 }, 2000, { abandonWhen: r => r.segment === 'branch' });
    const firstStair = out.findIndex(r => r.segment === 'stair');
    assert.deepEqual(out[firstStair - 1], { step: 'tunnel N', target: { x: 0, y: 24, z: -32 }, segment: 'main', feet: { x: 0, y: 24, z: -32 } });
    const stairs = out.slice(firstStair, firstStair + 4);
    assert.ok(stairs.every(r => r.step === 'down N'), JSON.stringify(stairs));
    assert.deepEqual(stairs[3].feet, { x: 0, y: 20, z: -36 });
    assert.equal(out[firstStair + 4].step, 'tunnel S');
});

test('below the band: a new column 40 to the right climbs back up', () => {
    const plan = createPlan({ x: 0, y: 24, z: 0, heading: 'N' }, iron);
    const { out } = follow(plan, { x: 0, y: 24, z: 0 }, 3000, { abandonWhen: r => r.segment === 'branch' });
    // levels in order (a level is a run of main tunnel at one height; the new
    // column's first level is 8 again, next to the old one)
    const mains = out.filter(r => r.segment === 'main' || r.segment === 'shaft');
    const levels = mains.filter((r, i) => i === 0 || r.feet.y !== mains[i - 1].feet.y || (r.segment === 'main' && mains[i - 1].segment === 'shaft'))
        .filter(r => r.segment === 'main').map(r => r.feet.y);
    assert.deepEqual(levels.slice(0, 7), [24, 20, 16, 12, 8, 8, 12]);
    const s0 = out.findIndex(r => r.segment === 'shaft');
    const shaft = out.slice(s0, s0 + 41).filter(r => r.segment === 'shaft');
    assert.equal(shaft.length, 40);
    assert.notEqual(out[s0 + 40].segment, 'shaft');
    assert.ok(shaft.every(r => r.step === 'tunnel E' && r.feet.y === 8));
    const climb = out.find(r => r.segment === 'stair' && r.feet.x === 40);
    assert.equal(climb.step.split(' ')[0], 'up');
    // the level-8 main of the new column runs back south
    const i = out.indexOf(shaft.at(-1));
    assert.equal(out[i + 1].step, 'tunnel S');
});

test('abandon: a branch goes to the next branch, a main tunnel ends its level', () => {
    let plan = createPlan({ x: 0, y: 20, z: 0, heading: 'N' }, iron);
    let { out } = follow(plan, { x: 0, y: 20, z: 0 }, 8, { abandonWhen: r => r.step === 'tunnel W' && r.target.x === -3 });
    assert.ok(out.some(r => r.abandoned === 'tunnel W'));
    const after = out.findIndex(r => r.abandoned);
    assert.deepEqual(out[after + 1].walk, { x: 0, y: 20, z: -3 });
    assert.equal(out[after + 2].step, 'tunnel E');

    plan = createPlan({ x: 0, y: 20, z: 0, heading: 'N' }, iron);
    ({ out } = follow(plan, { x: 0, y: 20, z: 0 }, 3, { abandonWhen: r => r.step === 'tunnel N' && r.target.z === -2 }));
    assert.equal(out[1].abandoned, 'tunnel N');
    assert.equal(out[2].step, 'down N', 'the next level\'s staircase starts where the main tunnel stopped');
    assert.deepEqual(out[2].target, { x: 0, y: 19, z: -2 });
});

test('an unsafe staircase step shifts the staircase one block right', () => {
    const plan = createPlan({ x: 0, y: 30, z: 0, heading: 'N' }, iron);
    const { out } = follow(plan, { x: 0, y: 30, z: 0 }, 5, { abandonWhen: r => r.step === 'down N' && r.target.y === 28 && r.target.x === 0 });
    assert.equal(out[0].step, 'down N');
    assert.equal(out[1].abandoned, 'down N');
    assert.equal(out[2].step, 'tunnel E');
    assert.equal(out[2].segment, 'shift');
    assert.deepEqual(out[2].feet, { x: 1, y: 29, z: -1 });
    assert.equal(out[3].step, 'down N');
    assert.deepEqual(out[3].feet, { x: 1, y: 28, z: -2 });
});

test('a staircase blocked again and again ends the plan', () => {
    const plan = createPlan({ x: 0, y: 30, z: 0, heading: 'N' }, iron, { max_shifts: 2 });
    const { out } = follow(plan, { x: 0, y: 30, z: 0 }, 20, { abandonWhen: () => true });
    assert.equal(out.at(-1).done, 'the staircase is blocked');
});

test('a walk back when off the plan, and the torch wall is left of the way out', () => {
    const plan = createPlan({ x: 0, y: 20, z: 0, heading: 'N' }, iron);
    assert.equal(plan.torchWall(), 'W');
    plan.next({ x: 0, y: 20, z: 0 });
    assert.deepEqual(plan.next({ x: 0, y: 20, z: -1 }).step, 'tunnel N');
    assert.deepEqual(plan.next({ x: 2, y: 20, z: -1 }), { walk: { x: 0, y: 20, z: -1 }, segment: 'main' });
    assert.deepEqual(plan.entrance, { x: 0, y: 20, z: 0 });
    assert.deepEqual(cellAt({ kind: 'down', dir: 'E', from: { x: 0, y: 0, z: 0 } }, 3), { x: 3, y: -3, z: 0 });
});

test('diamond: never plans below the lowest height', () => {
    const plan = createPlan({ x: 0, y: -50, z: 0, heading: 'S' }, { lo: ORES.diamond.lo, hi: ORES.diamond.hi });
    const { out } = follow(plan, { x: 0, y: -50, z: 0 }, 3000, { abandonWhen: r => r.segment === 'branch' });
    assert.ok(out.every(r => !r.feet || r.feet.y >= -59));
    assert.ok(out.some(r => r.segment === 'shaft'));
});

test('a detour off the staircase: the staircase carries on from where the bot stands', () => {
    // the scene at 176 67 142: down E has no floor, the bot detours down S
    const plan = createPlan({ x: 0, y: 70, z: 0, heading: 'E' }, iron);
    assert.equal(plan.next({ x: 0, y: 70, z: 0 }).step, 'down E');
    plan.abandon({ x: 0, y: 69, z: 1 });
    const r = plan.next({ x: 0, y: 69, z: 1 });
    assert.equal(r.walk, undefined, 'no walk back to the vetoed cell');
    assert.deepEqual([r.step, r.segment, r.target], ['down E', 'stair', { x: 1, y: 68, z: 1 }]);
    // a detour off a shift's step goes on from there too
    plan.abandon(); // no restart: the shift
    assert.equal(plan.next({ x: 0, y: 69, z: 1 }).segment, 'shift');
    plan.abandon({ x: -1, y: 69, z: 1 });
    assert.deepEqual(plan.next({ x: -1, y: 69, z: 1 }).target, { x: 0, y: 68, z: 1 });
});

test('detours with no stair step between end the plan after max_shifts; a stair step resets the count', () => {
    let plan = createPlan({ x: 0, y: 70, z: 0, heading: 'E' }, iron, { max_shifts: 2 });
    let feet = { x: 0, y: 70, z: 0 };
    for (let i = 0; i < 3; i++) {
        const r = plan.next(feet);
        assert.ok(r.step, JSON.stringify(r));
        feet = { x: feet.x, y: feet.y, z: feet.z + 1 }; // detour sideways, no stair step
        plan.abandon(feet);
    }
    assert.equal(plan.next(feet).done, 'the staircase is blocked');
    // a stair step between detours: never blocked
    plan = createPlan({ x: 0, y: 70, z: 0, heading: 'E' }, iron, { max_shifts: 2 });
    feet = { x: 0, y: 70, z: 0 };
    for (let i = 0; i < 6; i++) {
        const r = plan.next(feet);
        feet = r.target; // one stair step done
        assert.equal(plan.next(feet).segment, 'stair');
        feet = { x: feet.x, y: feet.y, z: feet.z + 1 };
        plan.abandon(feet);
    }
    assert.ok(plan.next(feet).step);
});

test('the staircase goes to the ore best level, and from the surface at least 10 down', async () => {
    const { targetLevel, firstLevel } = await import('../src/agent/laya/mine_plan.js');
    const { ORES, BEST_LEVEL } = await import('../src/agent/laya/mine_state.js');
    const lvl = (ore, y, surface = true) => firstLevel(y, ORES[ore].lo, ORES[ore].hi, undefined, { best: ORES[ore].best, surface });
    assert.equal(lvl('coal', 70), 45, 'coal from Y 70: down to 45, not the surface');
    assert.equal(lvl('coal', 50), 40, 'at least 10 below a surface entrance');
    assert.equal(lvl('coal', 30, false), 30, 'underground in the band: start here');
    assert.equal(lvl('coal', 70, false), 70, 'underground in the band: start here');
    assert.equal(lvl('iron', 70, false), 16, 'above the band: down to the best level');
    assert.equal(lvl('copper', 70), 48);
    assert.equal(lvl('iron', 70), 16);
    assert.equal(lvl('lapis', 70), 0);
    assert.equal(lvl('gold', 70), -16);
    assert.equal(lvl('redstone', 70), -58);
    assert.equal(lvl('diamond', 70), -58);
    assert.equal(BEST_LEVEL.emerald, 16);
    assert.equal(targetLevel(20, 8, 24, undefined, { best: 16, surface: true }), 10, 'clamped to the band');
    assert.equal(targetLevel(12, 8, 24, undefined, { best: 16, surface: true }), 8);
    // the coal plan: a staircase from 70 down to 45, then the grid; never a branch above 45
    const plan = createPlan({ x: 0, y: 70, z: 0, heading: 'N' }, ORES.coal, { surface: true });
    const { out } = follow(plan, { x: 0, y: 70, z: 0 }, 4000, { abandonWhen: r => r.segment === 'branch' });
    const firstGrid = out.findIndex(r => r.segment === 'main' || r.segment === 'branch');
    assert.ok(out.slice(0, firstGrid).every(r => r.segment === 'stair'));
    assert.equal(out[firstGrid].feet.y, 45);
    assert.ok(out.filter(r => r.feet).every(r => r.segment === 'stair' || r.feet.y <= 45), 'no grid above the first level');
});
