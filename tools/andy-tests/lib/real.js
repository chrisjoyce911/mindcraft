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
        makeBot: async () => {
            const [{ Bot }, { realBotDeps }] = await Promise.all([import('../../test-world/lib/bot.js'), import('../../test-world/lib/real.js')]);
            return new Bot({ config: config.testWorld, deps: realBotDeps() });
        },
    };
}
