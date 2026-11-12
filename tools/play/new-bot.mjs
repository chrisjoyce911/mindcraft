#!/usr/bin/env node
// Play the NEW bot (bot/dist) on your own world, with your normal settings.js (tools/play/README.md).
//   node tools/play/new-bot.mjs                  your LAN world (Open to LAN)
//   PLAY_WORLD=test node tools/play/new-bot.mjs  the local test world 127.0.0.1:25566 (take the board's slot first)
//   PLAY_SETTINGS_DIR=<dir>                      where settings.js is read from (default ~/lnkz/mindcraft)
//   (run with node 20: /opt/homebrew/opt/node@20/bin/node; build bot/ first: cd bot && npm run build)
// Your settings.js has port -1 ("Open to LAN"): this finds the LAN game's port the way the old bot does,
// then starts bot/dist/src/main.js with your settings. Ctrl+C stops it.
// Chores (6.2b): this is not the test harness's launch (no ANDY_TEST_HARNESS), so andy starts with chores on unless
// your settings say chores: false; the harness's own off in bots/andy/laya-chores.json is ignored here, a player's
// "take a break" is kept.
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const main = process.env.PLAY_SETTINGS_DIR || path.join(process.env.HOME, 'lnkz/mindcraft');
const settings = { ...(await import(pathToFileURL(path.join(main, 'settings.js')).href)).default };
const { getServer } = await import(pathToFileURL(path.join(main, 'src/mindcraft/mcserver.js')).href);

// PLAY_WORLD=test: the local test world (127.0.0.1:25566) instead of your LAN game.
if (process.env.PLAY_WORLD === 'test') { settings.host = '127.0.0.1'; settings.port = 25566; }
const found = await getServer(settings.host, settings.port, settings.minecraft_version);
settings.host = found.host;
settings.port = found.port;
console.log(`[play] world ${settings.host}:${settings.port} (${found.version ?? settings.minecraft_version}); mindserver ${settings.mindserver_port}; chores setting ${settings.chores === false ? 'off' : 'on'}`);

const env = { ...process.env, SETTINGS_JSON: JSON.stringify(settings), MINECRAFT_PORT: String(settings.port), MINDSERVER_PORT: String(settings.mindserver_port) };
delete env.ANDY_TEST_HARNESS; // a play start, never the harness's
const child = spawn(process.execPath, [path.join(root, 'bot/dist/src/main.js'), '--profiles', ...(settings.profiles ?? ['./andy.json'])], {
    cwd: root, stdio: 'inherit', env,
});
const stop = () => child.kill('SIGINT');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.on('exit', code => process.exit(code ?? 0));
