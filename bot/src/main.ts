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
import { Sensors, factsLine, sensorBot } from './sensors/index.js';
import { createLayaClient, decisionModels } from './models/client.js';
import { promptOf } from './models/director/index.js';
import { actBot, realGoals } from './actuators/bot.js';
import { Director, type DecisionSink, type Models } from './director/loop.js';
import type { Timing } from './director/activities.js';
import type { Command, Places } from './types/index.js';
import { JsonlLog, defendLine, directorLine, eatLine } from './log/jsonl.js';
import { handleChat } from './command/handle.js';
import { COMMAND_DEFAULTS, promptOf as commandPromptOf, type CommandOptions } from './models/command/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// dist/src/main.js → repo root is three up (bot/dist/src)
const REPO_ROOT = process.env.ANDY_REPO_ROOT || path.resolve(here, '../../..');

function log(m: string) { console.log(m); }

/** A task's log_steps setting (decision_models.tasks.<task>.log_steps; default true, as the old DEFAULTS). */
function logSteps(settings: Record<string, unknown>, task: string): boolean {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    return dm?.tasks?.[task]?.log_steps !== false;
}

/** A task's number setting (decision_models.tasks.<task>.<key>), e.g. defend step_ms. */
function taskNumber(settings: Record<string, unknown>, task: string, key: string): number | undefined {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    const v = dm?.tasks?.[task]?.[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined;
}

/** The command task's log_decisions setting (the old key; default true). */
function logDecisions(settings: Record<string, unknown>): boolean {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    return dm?.tasks?.command?.log_decisions !== false;
}

/** The command task's thresholds and defaults set in settings (the old DEFAULTS' keys). */
function commandOpts(settings: Record<string, unknown>): Partial<CommandOptions> {
    const o: Partial<CommandOptions> = {};
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    const t = dm?.tasks?.command ?? {};
    for (const k of Object.keys(COMMAND_DEFAULTS) as (keyof CommandOptions)[]) {
        const v = t[k];
        if (typeof v === 'number' && Number.isFinite(v)) o[k] = v;
    }
    return o;
}

function timingOf(settings: Record<string, unknown>): Partial<Timing> {
    const t: Partial<Timing> = {};
    const set = (k: keyof Timing, v: number | undefined) => { if (v !== undefined) t[k] = v; };
    set('stepMs', taskNumber(settings, 'defend', 'step_ms'));
    set('quietMs', taskNumber(settings, 'defend', 'quiet_ms'));
    set('maxEngageMs', taskNumber(settings, 'defend', 'max_engage_ms'));
    set('checkMs', taskNumber(settings, 'eat', 'check_ms'));
    return t;
}

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

    const jsonl = new JsonlLog(path.join(botDir, 'logs'));
    const body = new Body({ host: settings.host, port: settings.port, username: name, version: settings.minecraft_version, auth: settings.auth }, log);
    const lease = new BodyLease({
        resetBody: () => body.reset(),
        log: e => {
            log(`[laya] director: stop-overrun ${e.runner} (${e.waitedMs} ms)`);
            jsonl.write('director', e);
        },
    });
    let stopping = false;

    // decision models (3.1) and the decision log lines (3.5: the old bot's format, log/jsonl.ts)
    const laya = createLayaClient({ getConfig: () => decisionModels(settings), log });
    const enabled = (task: string) => decisionModels(settings)?.tasks[task]?.enabled === true;
    const models: Models = {
        director: () => (enabled('director') ? { client: laya, prompt: promptOf(laya.promptFor('director')) } : null),
        eat: () => (enabled('eat') ? laya : null),
        defend: () => (enabled('defend') ? laya : null),
    };
    const sink: DecisionSink = {
        director: e => {
            log(`[laya] director: ${e.event} → ${e.answer} (${e.source} ${e.rule}${e.why ? `, ${e.why}` : ''}${e.acted ? `; ${e.acted}` : ''})`);
            jsonl.write('director', directorLine(e));
        },
        eat: (d, outcome) => { if (logSteps(settings, 'eat')) jsonl.write('eat', eatLine(d, outcome)); },
        defend: d => { if (logSteps(settings, 'defend')) jsonl.write('defend', defendLine(d)); },
        note: text => log(`[laya] director: ${text}`),
    };
    let director: Director | null = null;

    const say = (text: string) => { body.say(text); harness.output(text); };

    const handle = (from: string, message: string) => {
        if (!message || from === name) return;
        if (onlyChatWith.length && !onlyChatWith.includes(from)) return;
        log(`${name} received message from ${from} : ${message}`);
        // the legacy !commands at the boundary; plain chat goes to the command model (4.1)
        if (containsLegacyCommand(message)) {
            const cmd = parseLegacy(message, from);
            if (typeof cmd === 'string') { say(cmd); return; }
            log(`parsed command: ${JSON.stringify(cmd)}`);
            void run(cmd);
            return;
        }
        void handleChat(from, message, {
            me: name,
            model: enabled('command') ? { client: laya, prompt: commandPromptOf(laya.promptFor('command')) } : null,
            opts: commandOpts(settings),
            carry: () => readFacts()?.items ?? [],
            nearestHostile: () => readFacts()?.mobs.find(m => m.dist <= 16)?.name ?? null,
            say,
            run: cmd => { log(`command model: ${JSON.stringify(cmd)}`); return run(cmd); },
            log: line => { if (logDecisions(settings)) jsonl.write('command', line); },
            note: log,
        }).catch(e => log(`command: ${String(e)}`));
    };

    const run = async (cmd: Command) => {
        switch (cmd.kind) {
            case 'stop': if (director) await director.stop(); else await lease.release(); return;
            case 'reply': say(cmd.text); return;
            case 'ignore': return;
            case 'inventory': {
                const s = body.bot ? fullState(body.bot, name, activity(), places()) : null;
                const items = Object.entries(s?.inventory.counts ?? {}).map(([k, v]) => `${k}: ${v}`);
                say(items.length ? `INVENTORY: ${items.join(', ')}` : 'INVENTORY: Nothing');
                return;
            }
            case 'chores': say(`Chores aren't in the new bot yet.`); return;
            case 'job': say(`I can't do ${cmd.job.kind} yet: jobs come in phase 4 of the new bot.`); return;
        }
    };

    const places = () => loadPlaces(path.join(botDir, 'memory.json'));
    // 3.3: the sensors read Facts; 3.4: the director decides from them
    let sensors: Sensors | null = null;
    let detachSensors: (() => void) | null = null;
    const facts = (): string | null => {
        if (!sensors || !body.inGame) return null;
        try { return factsLine(sensors.read()); } catch (e) { return `facts error: ${String(e)}`; }
    };
    const readFacts = () => { try { return sensors && body.inGame ? sensors.read() : null; } catch { return null; } };
    const activity = () => ({ idle: lease.isFree, label: lease.isFree ? 'Idle' : lease.holderName ?? 'Acting' });

    const harness = await startHarness(settings.mindserver_port, {
        name,
        inGame: () => body.inGame,
        state: () => (body.bot && body.inGame ? fullState(body.bot, name, activity(), places()) : null),
        facts,
        settings: () => settings,
        message: handle,
        start: () => { stopping = false; body.connect(); },
        stop: () => { stopping = true; body.disconnect(); },
    }, log);

    body.on('state', () => harness.statusChanged());
    body.on('chat', (from: string, message: string) => handle(from, message));
    body.on('spawn', () => {
        if (body.bot && !sensors) {
            sensors = new Sensors(sensorBot(body.bot), { places, moving: () => body.motion?.moving ?? false });
            detachSensors = sensors.attach();
        }
        if (body.bot && sensors && !director) {
            const bot = body.bot, sense = sensors;
            director = new Director({
                lease,
                facts: fresh => (body.inGame ? sense.read(fresh) : null),
                act: () => (body.bot && body.motion ? { bot: actBot(body.bot), motion: body.motion, goals: realGoals(body.bot) } : null),
                models, say, sink, timing: timingOf(settings),
            });
            // a hit on andy or a player is decided at once (the sensors' own listener ran first)
            bot.on('entityHurt', (e: { type?: string }) => { if (e === bot.entity || e.type === 'player') director?.event('hurt'); });
            bot.on('spawn', () => director?.event('spawn'));
            director.start();
            director.event('spawn');
        }
        log(`[metrics] spawned ${Date.now() - t0} ms after start (login ${body.logins})`);
        fs.appendFileSync(path.join(botDir, 'logs', 'bot-metrics.jsonl'), JSON.stringify({
            time: new Date().toISOString(), event: 'spawn', ms: Date.now() - t0, logins: body.logins, rssMB: Math.round(process.memoryUsage().rss / 1048576),
        }) + '\n');
    });
    body.on('death', () => director?.event('death'));
    body.on('end', () => {
        void director?.dispose(); director = null;
        detachSensors?.(); detachSensors = null; sensors = null;
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
        await director?.dispose();
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
