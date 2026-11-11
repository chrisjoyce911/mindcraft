// andy's new bot (bot-rebuild phase 2): spawn and idle. One process, one body, one lease; the
// mindserver-compatible harness on the settings' mindserver port. Launched by
// tools/test-world/bot.js with ANDY_BOT=new (same SETTINGS_JSON and --profiles contract).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Body } from './core/body.js';
import { BodyLease } from './core/lease.js';
import { loadSettings } from './core/settings.js';
import { startHarness } from './harness/server.js';
import { fullState } from './harness/state.js';
import { containsLegacyCommand, parseLegacy } from './harness/legacy.js';
import type { Command, Places } from './types/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/src/main.js → repo root is three up (bot/dist/src)
const REPO_ROOT = process.env.ANDY_REPO_ROOT || path.resolve(here, '../../..');
const CANNED = "Sorry, I only understand simple commands, like: follow me, come here, stop, mine 8 iron, " +
    "get 16 logs, craft a stone pickaxe, farm wheat, give me your coal, store everything, this is your chest.";

function log(m: string) { console.log(m); }

function loadPlaces(file: string): Places {
    try {
        const doc = JSON.parse(fs.readFileSync(file, 'utf8')) as { places?: Record<string, unknown> };
        const out: Places = {};
        for (const [k, v] of Object.entries(doc.places ?? {})) {
            if (Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) out[k] = [v[0], v[1], v[2]] as [number, number, number];
        }
        return out;
    } catch { return {}; }
}

async function main() {
    const t0 = Date.now();
    const settings = await loadSettings(REPO_ROOT, process.argv.slice(2), process.env);
    const name = settings.profile.name;
    const botDir = path.join(REPO_ROOT, 'bots', name);
    fs.mkdirSync(path.join(botDir, 'logs'), { recursive: true });
    const onlyChatWith = Array.isArray(settings.only_chat_with) ? settings.only_chat_with as string[] : [];

    const body = new Body({ host: settings.host, port: settings.port, username: name, version: settings.minecraft_version, auth: settings.auth }, log);
    const lease = new BodyLease({
        resetBody: () => body.reset(),
        log: e => {
            log(`[laya] director: stop-overrun ${e.runner} (${e.waitedMs} ms)`);
            fs.appendFileSync(path.join(botDir, 'logs', 'laya-director.jsonl'), JSON.stringify({ time: new Date().toISOString(), ...e }) + '\n');
        },
    });
    let stopping = false;

    const say = (text: string) => { body.say(text); harness.output(text); };

    const handle = (from: string, message: string) => {
        if (!message || from === name) return;
        if (onlyChatWith.length && !onlyChatWith.includes(from)) return;
        log(`${name} received message from ${from} : ${message}`);
        // phase 4 adds the command model; until then only the legacy !commands are understood
        const cmd: Command | string = containsLegacyCommand(message) ? parseLegacy(message, from) : { kind: 'reply', text: CANNED };
        if (typeof cmd === 'string') { say(cmd); return; }
        log(`parsed command: ${JSON.stringify(cmd)}`);
        void run(cmd);
    };

    const run = async (cmd: Command) => {
        switch (cmd.kind) {
            case 'stop': await lease.release(); return;
            case 'reply': say(cmd.text); return;
            case 'ignore': return;
            case 'inventory': {
                const s = body.bot ? fullState(body.bot, name, activity(), places()) : null;
                const items = Object.entries(s?.inventory.counts ?? {}).map(([k, v]) => `${k}: ${v}`);
                say(items.length ? `INVENTORY: ${items.join(', ')}` : 'INVENTORY: Nothing');
                return;
            }
            case 'chores': say(`Chores aren't in the new bot yet.`); return;
            case 'job': say(`I can't do ${cmd.job.kind} yet: the new bot only spawns and idles (phase 2).`); return;
        }
    };

    const places = () => loadPlaces(path.join(botDir, 'memory.json'));
    const activity = () => ({ idle: lease.isFree, label: lease.isFree ? 'Idle' : lease.holderName ?? 'Acting' });

    const harness = await startHarness(settings.mindserver_port, {
        name,
        inGame: () => body.inGame,
        state: () => (body.bot && body.inGame ? fullState(body.bot, name, activity(), places()) : null),
        settings: () => settings,
        message: handle,
        start: () => { stopping = false; body.connect(); },
        stop: () => { stopping = true; body.disconnect(); },
    }, log);

    body.on('state', () => harness.statusChanged());
    body.on('chat', (from: string, message: string) => handle(from, message));
    body.on('spawn', () => {
        log(`[metrics] spawned ${Date.now() - t0} ms after start (login ${body.logins})`);
        fs.appendFileSync(path.join(botDir, 'logs', 'bot-metrics.jsonl'), JSON.stringify({
            time: new Date().toISOString(), event: 'spawn', ms: Date.now() - t0, logins: body.logins, rssMB: Math.round(process.memoryUsage().rss / 1048576),
        }) + '\n');
    });
    body.on('end', () => {
        void lease.release();
        if (!stopping) setTimeout(() => { if (!stopping && body.state === 'offline') body.connect(); }, 5000);
    });
    const metrics = setInterval(() => {
        fs.appendFileSync(path.join(botDir, 'logs', 'bot-metrics.jsonl'), JSON.stringify({
            time: new Date().toISOString(), event: 'rss', rssMB: Math.round(process.memoryUsage().rss / 1048576), inGame: body.inGame, uptimeS: Math.round(process.uptime()),
        }) + '\n');
    }, 60000);
    metrics.unref();

    const shutdown = async () => {
        stopping = true;
        clearInterval(metrics);
        await lease.release();
        body.disconnect();
        await harness.close();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown());
    process.on('SIGTERM', () => void shutdown());
    process.on('unhandledRejection', e => log(`unhandled rejection: ${String(e)}`));

    body.connect();
}

main().catch(e => { console.error(e); process.exit(1); });
