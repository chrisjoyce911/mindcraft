#!/usr/bin/env node
/* global process */
// The Mindcraft test world (a local vanilla 1.21.6 server in docker).
//   node tools/test-world/world.js start | stop | reset | status
//   node tools/test-world/world.js template [--force] [--no-check]
//   node tools/test-world/world.js sites [names…]     check the sites with a probe
//   node tools/test-world/world.js rcon <command…>     run a server command
// npm: world:start, world:stop, world:reset, world:status, world:template,
// world:sites, world:rcon, world:bot (bot.js). Times are Brisbane (AEST).
import { makeWorldConfig, loadSites } from './lib/config.js';
import { TestWorld } from './lib/world.js';
import { realWorldDeps } from './lib/real.js';
import { checkSites } from './lib/probe.js';

const HELP = `node tools/test-world/world.js <start|stop|reset|status|template|sites|rcon> [options]
  start              start the server and wait until it accepts players
  stop               stop it (the world is saved)
  reset              stop, put back the template world, start, wait
  status             container, readiness, players, template and sites
  template [--force] [--no-check]
                     first time: generate the world from the seed in sites.json,
                     set the game rules, build the test base, check the sites,
                     stop and snapshot it as the template
  sites [names…]     check the sites with a probe player (server must run)
  rcon <command…>    run a server command over RCON and print the reply
Env: TEST_WORLD_DATA (data dir), TEST_WORLD_PORT (25566), TEST_WORLD_RCON_PORT (25576).`;

export function makeWorld({ env = process.env, log } = {}) {
    const config = makeWorldConfig(env);
    const sites = loadSites(config.sitesFile);
    return new TestWorld({ config, sites, deps: realWorldDeps({ log }) });
}

export function siteChecker(world, { names = null, log = line => world.log(line) } = {}) {
    const c = world.config;
    return checkSites({
        sites: world.sites, names, log,
        command: cmd => world.command(cmd),
        server: { host: c.host, port: c.port, version: c.version },
    });
}

async function main(argv) {
    const [cmd, ...rest] = argv;
    if (!cmd || cmd === '-h' || cmd === '--help' || cmd === 'help') { console.log(HELP); return 0; }
    const world = makeWorld();
    try {
        switch (cmd) {
        case 'start': await world.start(); break;
        case 'stop': await world.stop(); break;
        case 'reset': await world.reset(); break;
        case 'status': console.log(JSON.stringify(await world.status(), null, 2)); break;
        case 'template': {
            const force = rest.includes('--force');
            const check = rest.includes('--no-check') ? null : w => siteChecker(w);
            const r = await world.makeTemplate({ force, check });
            if (r.info.check && !r.info.check.ok) { world.log('the template was saved, but some sites failed their checks (see above)'); return 1; }
            break;
        }
        case 'sites': {
            const r = await siteChecker(world, { names: rest });
            return r.ok ? 0 : 1;
        }
        case 'rcon': {
            if (!rest.length) throw new Error('rcon needs a command, e.g. rcon list');
            console.log(await world.command(rest.join(' ')));
            break;
        }
        default: console.error(`unknown command ${cmd}\n\n${HELP}`); return 2;
        }
        return 0;
    } finally {
        world.closeRcon();
    }
}

if (process.argv[1]?.endsWith('world.js')) {
    main(process.argv.slice(2)).then(code => process.exit(code), e => { console.error(e.message); process.exit(1); });
}
