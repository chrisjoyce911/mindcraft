import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadScenarios, parseScenarios, validate, select, expand, coords, stepKind, describeStep } from '../tools/andy-tests/lib/scenarios.js';
import { parseArgs } from '../tools/andy-tests/cli.js';
import { makeConfig } from '../tools/andy-tests/lib/config.js';
import { stamp, brisbane, brisbaneIso } from '../tools/andy-tests/lib/time.js';

const FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'game/scenarios.json');

test('the suite file loads, in the planned order, with quick and full tags', () => {
    const { tests, defaults } = loadScenarios(FILE);
    assert.ok(defaults.timeout > 0);
    const names = tests.map(t => t.name);
    for (const n of ['setup-world', 'follow', 'craft-wooden-pickaxe', 'craft-stone-pickaxe', 'craft-furnace', 'home-chest-sign', 'home-chest-command', 'home-chest-chat',
        'farm-water', 'farm-no-water', 'farm-bucket', 'mine-coal', 'mine-iron-staircase', 'unload-home-chest', 'defend', 'eat']) assert.ok(names.includes(n), n);
    assert.equal(names[0], 'setup-world');
    assert.ok(names.indexOf('home-chest-sign') < names.indexOf('home-chest-command'), 'the sign test needs no saved home chest');
    // every test is in full except the chores ones (chores on: run with --tag chores)
    assert.equal(select(tests, { tag: 'full' }).length, tests.filter(t => !t.tags.includes('chores')).length);
    const quick = select(tests, { tag: 'quick' }).map(t => t.name);
    assert.ok(quick.length >= 5 && !quick.includes('mine-coal') && !quick.includes('farm-water'));
    for (const t of tests.filter(t => t.tags.includes('slow'))) assert.ok(t.timeout >= 600000, `${t.name} is slow and needs a long timeout`);
});

test('validate reports each problem', () => {
    assert.deepEqual(validate({}), ['the file needs a "tests" array']);
    const p = validate({ tests: [
        { name: 'a', action: [{ say: 'hi' }], checks: [] },
        { name: 'a', action: [{ say: 'hi' }], checks: [] },
        { action: [{ jump: 1 }], checks: [{ type: 'magic' }] },
        { name: 'B c', action: [], checks: [], extra: 1 },
        { name: 'd', action: [{ say: 'x', cmd: '/y' }], setup: [{ cmd: '/x', bogus: 1 }], checks: [] },
    ] });
    const all = p.join('\n');
    assert.match(all, /test 2 \(a\): duplicate name/);
    assert.match(all, /test 3: needs a name/);
    assert.match(all, /action step 1 needs exactly one of/);
    assert.match(all, /unknown type "magic"/);
    assert.match(all, /lower-case-with-dashes/);
    assert.match(all, /unknown key "extra"/);
    assert.match(all, /needs an action/);
    assert.match(all, /test 5 \(d\): action step 1 needs exactly one/);
    assert.match(all, /setup step 1: unknown option "bogus"/);
    assert.throws(() => parseScenarios('{nope', 'x.json'), /x.json: not valid JSON/);
    assert.throws(() => parseScenarios('{"tests":[{"name":"a"}]}', 'x.json'), /needs an action/);
});

test('parse fills defaults', () => {
    const { tests, defaults } = parseScenarios('{"defaults":{"grace":1},"tests":[{"name":"a","action":[{"say":"hi"}],"checks":[]}]}');
    assert.equal(defaults.grace, 1);
    assert.equal(defaults.timeout, 120000);
    assert.deepEqual(tests[0].tags, []);
    assert.deepEqual(tests[0].setup, []);
});

test('select by names keeps file order; unknown names fail; tags filter', () => {
    const tests = [{ name: 'a', tags: ['quick'] }, { name: 'b', tags: [] }, { name: 'c', tags: ['quick'] }];
    assert.deepEqual(select(tests, { names: ['c', 'a'] }).map(t => t.name), ['a', 'c']);
    assert.deepEqual(select(tests, { tag: 'quick' }).map(t => t.name), ['a', 'c']);
    assert.deepEqual(select(tests, { names: ['a', 'b'], tag: 'quick' }).map(t => t.name), ['a']);
    assert.equal(select(tests, { tag: 'all' }).length, 3);
    assert.throws(() => select(tests, { names: ['zz'] }), /No test named zz/);
});

test('templates are relative to andy', () => {
    const ctx = { x: 10, y: 64, z: -5, andy: 'andy', tester: 'tester' };
    assert.equal(expand('/setblock {x+3} {y} {z} chest', ctx), '/setblock 13 64 -5 chest');
    assert.equal(expand('/fill {x-4} {y-1} {z-4} {x+4} {y-1} {z+4} grass_block', ctx), '/fill 6 63 -9 14 63 -1 grass_block');
    assert.equal(expand('!followPlayer("{tester}", 3) /give {andy} bread', ctx), '!followPlayer("tester", 3) /give andy bread');
    assert.equal(expand('oak_sign{front_text:{messages:["{andy}"]}}', ctx), 'oak_sign{front_text:{messages:["andy"]}}');
    assert.deepEqual(expand({ cmd: '/tp {andy} {x} 301 {z}', repeat: 2 }, ctx), { cmd: '/tp andy 10 301 -5', repeat: 2 });
    assert.equal(expand('{x}', {}), '{x}');
    assert.deepEqual(coords('13 64 -5'), { x: 13, y: 64, z: -5 });
    assert.throws(() => coords('13 64'), /not "x y z"/);
});

test('steps describe themselves', () => {
    assert.equal(stepKind({ cmd: '/x', repeat: 2 }), 'cmd');
    assert.equal(stepKind({ wait: 1, cmd: '/x' }), null);
    assert.equal(describeStep({ cmd: '/give andy cobblestone 64', repeat: 31 }), '/give andy cobblestone 64 (×31)');
    assert.equal(describeStep({ say: 'andy follow me' }), 'say "andy follow me"');
});

test('cli args', () => {
    assert.deepEqual(parseArgs(['--tag', 'quick', 'eat', '--list']), { names: ['eat'], tag: 'quick', list: true, scenarios: null, verbose: false, help: false, world: null, reset: false, name: null });
    assert.equal(parseArgs(['--tag=full']).tag, 'full');
    assert.equal(parseArgs(['--name', 'baseline-v1']).name, 'baseline-v1');
    assert.equal(parseArgs(['--name=x']).name, 'x');
    assert.equal(parseArgs(['--world', 'test']).world, 'test');
    assert.deepEqual([parseArgs(['--reset']).world, parseArgs(['--reset']).reset], ['test', true]);
    assert.throws(() => parseArgs(['--nope']), /unknown option/);
});

test('config from settings and env', () => {
    const c = makeConfig({ host: '127.0.0.1', port: -1, mindserver_port: 8090, minecraft_version: '1.21.6' }, { ANDY_BOT_DIR: '/b/andy' });
    assert.equal(c.port, -1);
    assert.equal(c.mindserverPort, 8090);
    assert.equal(c.version, '1.21.6');
    assert.equal(c.reportDir, '/b/andy/logs/game-tests');
    assert.equal(makeConfig({ port: -1 }, { ANDY_MC_PORT: '55916' }).port, 55916);
});

test('Brisbane time, UTC+10 all year', () => {
    const d = Date.parse('2026-11-10T04:05:06Z');
    assert.equal(stamp(d), '2026-11-10_14-05-06');
    assert.equal(brisbane(d), '2026-11-10 14:05:06 AEST');
    assert.equal(brisbaneIso(Date.parse('2026-01-15T20:00:00Z')), '2026-01-16T06:00:00+10:00'); // no daylight saving in summer
});
