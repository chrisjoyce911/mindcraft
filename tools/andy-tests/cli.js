#!/usr/bin/env node
/* global process */
// npm run game-test -- [names…] [--tag quick|full|…] [--list] [--scenarios file]
import { loadConfig } from './lib/config.js';
import { loadScenarios, select, describeStep } from './lib/scenarios.js';
import { describeCheck } from './lib/checks.js';
import { Session } from './lib/session.js';
import { Report } from './lib/report.js';
import { runSuite } from './lib/runner.js';
import { brisbane } from './lib/time.js';

export function parseArgs(argv) {
    const out = { names: [], tag: null, list: false, scenarios: null, verbose: false, help: false, world: null, reset: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--list' || a === '-l') out.list = true;
        else if (a === '--tag' || a === '-t') out.tag = argv[++i];
        else if (a.startsWith('--tag=')) out.tag = a.slice(6);
        else if (a === '--scenarios') out.scenarios = argv[++i];
        else if (a === '--verbose' || a === '-v') out.verbose = true;
        else if (a === '--world') out.world = argv[++i];
        else if (a.startsWith('--world=')) out.world = a.slice(8);
        else if (a === '--reset') { out.reset = true; out.world ??= 'test'; }
        else if (a === '--help' || a === '-h') out.help = true;
        else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
        else out.names.push(a);
    }
    return out;
}

const HELP = `npm run game-test -- [names…] [--tag quick|full|<tag>] [--list] [--verbose]
  --list       print the selected tests (no connection)
  --tag t      only tests tagged t (quick, full, craft, farm, mine, home, …)
  names        only these tests, in file order
  --world test use the local test world (npm run world:start, world:bot)
  --reset      reset the test world to its template first (implies --world test)
Env: ANDY_WORLD (test), ANDY_MC_PORT, ANDY_MINDSERVER_PORT, ANDY_BOT_DIR, ANDY_AGENT, ANDY_TESTER.`;

async function main() {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) { console.log(HELP); return 0; }
    const config = await loadConfig(args.world ? { ...process.env, ANDY_WORLD: args.world } : process.env);
    const { tests, defaults } = loadScenarios(args.scenarios || config.scenarios);
    const picked = select(tests, { names: args.names, tag: args.tag });
    if (args.list) {
        for (const t of picked) {
            console.log(`${t.name.padEnd(24)} ${String((t.timeout ?? defaults.timeout) / 1000).padStart(5)}s  [${t.tags.join(', ')}]${t.requires.length ? `  requires ${t.requires.join(', ')}` : ''}`);
            if (args.verbose) {
                for (const s of [...t.setup, ...t.action]) console.log(`    ${describeStep(s)}`);
                for (const c of t.checks) console.log(`    ✓ ${describeCheck(c)}`);
            }
        }
        return 0;
    }
    if (!picked.length) { console.error('No tests selected.'); return 2; }

    const { realDeps } = await import('./lib/real.js');
    const session = new Session({ config, deps: realDeps(config) });
    const report = new Report(config.reportDir, { title: `Andy game tests${args.tag ? `: ${args.tag}` : ''}` });
    process.on('SIGINT', () => { console.log('\ninterrupted'); session.disconnect(); process.exit(130); });
    console.log(`andy game tests — ${picked.length} test(s), ${brisbane()}`);
    try {
        if (args.reset) {
            console.log('resetting the test world…');
            const r = await session.worldReset();
            console.log(`test world reset in ${(r.ms / 1000).toFixed(1)}s${r.andy ? `, andy ${r.andy.inGame ? 'back in game' : 'NOT back: ' + (r.andy.error || 'timed out')}` : ' (no test bot running)'}`);
        }
        const c = await session.connect();
        console.log(`mindserver ${c.mindserver}, world ${c.world}${config.world === 'test' ? ' (test world)' : ''}`);
    } catch (e) {
        console.error(`Cannot start: ${e.message}`);
        session.disconnect();
        return 2;
    }
    const out = await runSuite(session, picked, {
        defaults, report,
        onStart: t => process.stdout.write(`… ${t.name}\r`),
        onResult: r => console.log(`${r.status.toUpperCase().padEnd(5)} ${r.name.padEnd(24)} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.reason}`),
    });
    const s = out.summary;
    console.log(`\n${s.pass} passed, ${s.fail} failed, ${s.error} errors, ${s.skip} skipped in ${(s.ms / 1000).toFixed(0)}s`);
    console.log(`report: ${out.report.md}\n        ${out.report.jsonl}`);
    session.disconnect();
    return s.fail || s.error ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.js')) {
    main().then(code => process.exit(code), e => { console.error(e.message); process.exit(2); });
}
