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
    };
}
