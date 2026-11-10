#!/usr/bin/env node
/* global process */
// Start Mindcraft (andy) against the test world, leaving settings.js alone.
//   npm run world:bot                         andy, in the foreground (Ctrl-C stops)
//   npm run world:bot -- --profiles ./profiles/andy-micro.json
//   npm run world:bot -- --background         detached; output in <data>/logs/bot-*.log
//   npm run world:bot -- --stop               stop a background bot
//   npm run world:bot -- --print              show the command and settings, run nothing
// The test bot's mindserver is on 8091 (TEST_WORLD_MINDSERVER_PORT): the
// harness uses it with ANDY_WORLD=test. Optional overrides in
// tools/test-world/bot-settings.local.json (gitignored).
import fs from 'fs';
import { spawn } from 'child_process';
import { makeWorldConfig } from './lib/config.js';
import { Bot, botCommand, readLocalSettings, DEFAULT_PROFILES } from './lib/bot.js';
import { realBotDeps } from './lib/real.js';
import { brisbane } from '../andy-tests/lib/time.js';

export function parseBotArgs(argv) {
    const out = { profiles: [], background: false, stop: false, print: false };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--background' || a === '-b') out.background = true;
        else if (a === '--stop') out.stop = true;
        else if (a === '--print') out.print = true;
        else if (a === '--profiles' || a === '-p') { while (argv[i + 1] && !argv[i + 1].startsWith('-')) out.profiles.push(argv[++i]); }
        else throw new Error(`unknown option ${a}`);
    }
    if (!out.profiles.length) out.profiles = DEFAULT_PROFILES;
    return out;
}

async function main() {
    const args = parseBotArgs(process.argv.slice(2));
    const config = makeWorldConfig();
    const log = m => console.log(`[${brisbane()}] ${m}`);
    if (args.stop || args.background) {
        const bot = new Bot({ config, deps: realBotDeps() });
        const r = args.stop ? await bot.stop() : bot.start({ profiles: args.profiles });
        log(JSON.stringify(r));
        return 0;
    }
    const c = botCommand(config, { profiles: args.profiles, local: readLocalSettings(config, fs) });
    if (args.print) {
        console.log(`cd ${c.cwd}\n${Object.entries(c.env).map(([k, v]) => `${k}='${v}'`).join(' ')} ${c.cmd} ${c.args.join(' ')}`);
        return 0;
    }
    log(`starting ${args.profiles.join(', ')} against the test world ${c.settings.host}:${c.settings.port} (mindserver ${c.settings.mindserver_port}, node ${c.cmd})`);
    const child = spawn(c.cmd, c.args, { cwd: c.cwd, env: { ...process.env, ...c.env }, stdio: 'inherit' });
    process.on('SIGINT', () => child.kill('SIGINT'));
    return new Promise(resolve => child.on('exit', code => resolve(code ?? 0)));
}

if (process.argv[1]?.endsWith('bot.js')) {
    main().then(code => process.exit(code), e => { console.error(e.message); process.exit(1); });
}
