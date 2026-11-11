/* global process */
// Test world configuration: where the data lives, the ports, the container,
// and sites.json. Everything can be overridden by environment variables:
//   TEST_WORLD_DATA       data directory (default: ../mindcraft-test-world-data
//                         beside the checkout, shared by the main checkout
//                         and its worktrees)
//   TEST_WORLD_PORT       game port on 127.0.0.1 (25566)
//   TEST_WORLD_RCON_PORT  RCON port on 127.0.0.1 (25576)
//   TEST_WORLD_MINDSERVER_PORT  the test bot's mindserver (8091, so it
//                         doesn't clash with your own Mindcraft on 8090)
//   TEST_WORLD_NODE       node binary for the bot (default node@20 if
//                         installed, as start-bot.sh uses, else this node)
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

export const WORLD_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const REPO_ROOT = path.resolve(WORLD_DIR, '../..');
export const SITES_FILE = path.join(WORLD_DIR, 'sites.json');
export const COMPOSE_FILE = path.join(WORLD_DIR, 'compose.yaml');

export const CONTAINER = 'mindcraft-test-world';
export const PROJECT = 'mindcraft-test-world';
export const VERSION = '1.21.6';

const NODE20 = '/opt/homebrew/opt/node@20/bin/node';

function expandHome(p) {
    return p && p.startsWith('~') ? path.join(os.homedir(), p.slice(1)) : p;
}

export function makeWorldConfig(env = process.env, { exists = fs.existsSync } = {}) {
    const data = path.resolve(expandHome(env.TEST_WORLD_DATA) || path.join(REPO_ROOT, '..', 'mindcraft-test-world-data'));
    return {
        repoRoot: REPO_ROOT,
        compose: COMPOSE_FILE,
        sitesFile: env.TEST_WORLD_SITES || SITES_FILE,
        container: CONTAINER,
        project: PROJECT,
        version: VERSION,
        ops: (env.TEST_WORLD_OPS || 'tester').split(',').map(s => s.trim()).filter(Boolean),
        host: '127.0.0.1',
        port: Number(env.TEST_WORLD_PORT || 25566),
        rconPort: Number(env.TEST_WORLD_RCON_PORT || 25576),
        mindserverPort: Number(env.TEST_WORLD_MINDSERVER_PORT || 8091),
        node: env.TEST_WORLD_NODE || (exists(NODE20) ? NODE20 : process.execPath),
        data,
        serverDir: path.join(data, 'server'),
        worldDir: path.join(data, 'server', 'world'),
        templateDir: path.join(data, 'template'),
        templateWorld: path.join(data, 'template', 'world'),
        templateInfo: path.join(data, 'template', 'template.json'),
        secretFile: path.join(data, 'rcon.secret'),
        logDir: path.join(data, 'logs'),
        botPidFile: path.join(data, 'bot.pid'),
        botSettingsLocal: path.join(WORLD_DIR, 'bot-settings.local.json'),
    };
}

// loadSites reads sites.json: {seed, spawn, sites: {name: {x, y, z, ...}}, build: [cmds]}.
export function loadSites(file = SITES_FILE, read = fs.readFileSync) {
    const doc = JSON.parse(read(file, 'utf8'));
    const problems = validateSites(doc);
    if (problems.length) throw new Error(`${file}:\n  ${problems.join('\n  ')}`);
    return doc;
}

export const SITE_CHECKS = ['grass', 'water', 'noWater', 'stone', 'cave', 'block'];

export function validateSites(doc) {
    const problems = [];
    if (!doc || typeof doc !== 'object') return ['not an object'];
    if (doc.seed == null || !/^-?\d+$/.test(String(doc.seed))) problems.push('needs a numeric "seed"');
    if (!doc.sites || typeof doc.sites !== 'object') { problems.push('needs "sites"'); return problems; }
    for (const [name, s] of Object.entries(doc.sites)) {
        if (!/^[a-z][a-z0-9-]*$/.test(name)) problems.push(`site "${name}": name should be lower-case`);
        for (const k of ['x', 'y', 'z']) if (!Number.isFinite(s?.[k])) problems.push(`site "${name}": needs numeric ${k}`);
        for (const c of s?.checks || []) if (!SITE_CHECKS.includes(c.type)) problems.push(`site "${name}": unknown check ${JSON.stringify(c.type)} (known: ${SITE_CHECKS.join(', ')})`);
    }
    if (doc.build != null && (!Array.isArray(doc.build) || doc.build.some(c => typeof c !== 'string'))) problems.push('"build" must be a list of commands');
    return problems;
}

export function site(doc, name) {
    const s = doc?.sites?.[name];
    if (!s) throw new Error(`No site "${name}". Sites: ${Object.keys(doc?.sites || {}).join(', ') || 'none'}.`);
    return s;
}
