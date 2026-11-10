/* global process */
// Harness configuration: the repo's settings.js (host, port, mindserver
// port, version), overridable by environment variables.
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(HARNESS_DIR, '../..');
export const DEFAULT_SCENARIOS = path.join(REPO_ROOT, 'test/game/scenarios.json');

// loadConfig reads settings.js from the repo root (or ANDY_SETTINGS) and
// applies env overrides:
//   ANDY_AGENT (andy), ANDY_TESTER (tester), ANDY_MC_HOST, ANDY_MC_PORT
//   (-1 scans for the LAN port), ANDY_MC_VERSION, ANDY_MINDSERVER_PORT,
//   ANDY_BOT_DIR (where the bot writes logs, default <repo>/bots/<agent>),
//   ANDY_SCENARIOS.
export async function loadConfig(env = process.env) {
    let settings = {};
    const file = env.ANDY_SETTINGS || path.join(REPO_ROOT, 'settings.js');
    try {
        settings = (await import(pathToFileURL(file).href)).default || {};
    } catch (e) {
        process.stderr.write(`andy-tests: could not read ${file} (${e.message}); using defaults\n`);
    }
    return makeConfig(settings, env);
}

export function makeConfig(settings = {}, env = {}) {
    const agent = env.ANDY_AGENT || 'andy';
    const version = env.ANDY_MC_VERSION || settings.minecraft_version || 'auto';
    const botDir = env.ANDY_BOT_DIR || path.join(REPO_ROOT, 'bots', agent);
    return {
        agent,
        tester: env.ANDY_TESTER || 'tester',
        host: env.ANDY_MC_HOST || settings.host || '127.0.0.1',
        port: Number(env.ANDY_MC_PORT ?? settings.port ?? -1),
        version,
        mindserverPort: Number(env.ANDY_MINDSERVER_PORT || settings.mindserver_port || 8080),
        botDir,
        logDir: path.join(botDir, 'logs'),
        reportDir: path.join(botDir, 'logs', 'game-tests'),
        scenarios: env.ANDY_SCENARIOS || DEFAULT_SCENARIOS,
    };
}
