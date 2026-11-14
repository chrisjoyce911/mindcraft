/* global process */
// The real connections (mineflayer, socket.io), loaded only when used so
// unit tests never load them.
import { MindClient } from './mind.js';
import { Tester } from './tester.js';

export function realDeps(config) {
    return {
        makeMind: async () => {
            const { io } = await import('socket.io-client');
            return new MindClient({ port: config.mindserverPort, agent: config.agent, ioFactory: io });
        },
        makeTester: async () => {
            const [{ default: mineflayer }, { default: pathfinder }, { default: Vec3 }, { getServer }] = await Promise.all([
                import('mineflayer'), import('mineflayer-pathfinder'), import('vec3'),
                import('../../../src/mindcraft/mcserver.js'),
            ]);
            return new Tester({
                host: config.host, port: config.port, version: config.version,
                username: config.tester, agent: config.agent,
                deps: { mineflayer, pathfinder, Vec3, findServer: getServer },
            });
        },
        makeWorld: async () => {
            const [{ loadSites }, { TestWorld }, { realWorldDeps }] = await Promise.all([
                import('../../test-world/lib/config.js'), import('../../test-world/lib/world.js'), import('../../test-world/lib/real.js'),
            ]);
            const tw = config.testWorld;
            // log to stderr: stdout is the MCP channel
            return new TestWorld({ config: tw, sites: loadSites(tw.sitesFile), deps: realWorldDeps({ log: line => process.stderr.write(line + '\n') }) });
        },
        // forgetAgent: the agent's saved memory and chores state belong to
        // the world before a reset (a home chest, a home bed, chest
        // contents): removed so the restarted agent starts with nothing
        // saved, and with chores off (on, he'd adopt a chest by the spawn as
        // home at once); each test sets chores as its tags say. The file is
        // marked by: 'test-harness' (6.2b): only a harness launch
        // (ANDY_TEST_HARNESS=1) heeds it, so a play start keeps chores on.
        forgetAgent: async () => {
            const { rmSync, writeFileSync } = await import('fs');
            try { rmSync(`${config.botDir}/memory.json`, { force: true }); } catch { /* none */ }
            try { rmSync(`${config.botDir}/laya-job.json`, { force: true }); } catch { /* none */ }
            try { writeFileSync(`${config.botDir}/laya-chores.json`, JSON.stringify({ on: false, by: 'test-harness' })); } catch { /* no bot dir */ }
            // chores v2's Last line is rebuilt from laya-chores.jsonl's run lines: the old world's runs end here
            try { (await import('fs')).appendFileSync(`${config.botDir}/logs/laya-chores.jsonl`, JSON.stringify({ time: new Date().toISOString(), event: 'forget' }) + '\n'); } catch { /* no log dir */ }
        },
        makeBot: async () => {
            const [{ Bot }, { realBotDeps }] = await Promise.all([import('../../test-world/lib/bot.js'), import('../../test-world/lib/real.js')]);
            return new Bot({ config: config.testWorld, deps: realBotDeps() });
        },
    };
}
