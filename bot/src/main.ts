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
import type { Channel, Command } from './types/index.js';
import { Replies } from './command/reply.js';
import { JsonlLog, defendLine, directorLine, eatLine } from './log/jsonl.js';
import { PlaceStore } from './home/places.js';
import { JobSaver, RESTORE_MAX_MS, RESTORE_MIN_MS, loadJobs, planRestore, readJobs, waitsFor } from './home/jobfile.js';
import { Chores, choresOf } from './chores/chores.js';
import { choresSettingOn } from './home/chores.js';
import { ChoreDriver } from './chores/driver.js';
import { placedBy } from './chores/sense.js';
import { HOME_PLACE } from './home/chest.js';
import type { StationKind } from './home/centre.js';
import type { Vec3Like } from './types/index.js';
import { makeRunner, FOLLOW_DEFAULTS, CRAFT_DEFAULTS, MINE_DEFAULTS, MINE_NUMBER_KEYS, MINE_PROMPTS, farmOf, skillOf, type CraftSettings, type FollowSettings, type JobDeps, type MineSettings, type MinePrompt } from './jobs/index.js';
import { mineStore } from './home/mines.js';
import { isFollowPrompt } from './models/follow/index.js';
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

/** The follow task's settings (decision_models.tasks.follow; the old follow.js DEFAULTS). */
function followOf(settings: Record<string, unknown>, model: FollowSettings['model'], served: string | undefined): FollowSettings {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    const t = dm?.tasks?.follow ?? {};
    const num = (k: 'step_ms' | 'fallback_ms' | 'stuck_ms' | 'max_waits') => {
        const v = t[k];
        return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : FOLLOW_DEFAULTS[k];
    };
    const prompt = served ?? (typeof t.prompt === 'string' ? t.prompt : undefined);
    return {
        step_ms: num('step_ms'), fallback_ms: num('fallback_ms'), stuck_ms: num('stuck_ms'), max_waits: num('max_waits'),
        log_steps: t.log_steps !== false, prompt: isFollowPrompt(prompt) ? prompt : FOLLOW_DEFAULTS.prompt, model,
    };
}

/** The craft task's settings (decision_models.tasks.craft; the old craft.js DEFAULTS). enabled false: the task is off. */
function craftOf(settings: Record<string, unknown>, model: CraftSettings['model']): CraftSettings {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    const t = dm?.tasks?.craft ?? {};
    const num = (k: 'min_confidence' | 'max_steps') => {
        const v = t[k];
        return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : CRAFT_DEFAULTS[k];
    };
    return { enabled: t.enabled === true, min_confidence: num('min_confidence'), max_steps: num('max_steps'), log_steps: t.log_steps !== false, model };
}

/**
 * The mine task's settings (decision_models.tasks.mine; the old mine.js DEFAULTS and the plan's keys). enabled
 * false: the task is off (a mine job collects the nearest ore blocks). The served prompt version wins over the
 * setting.
 */
function mineOf(settings: Record<string, unknown>, model: MineSettings['model'], served: string | undefined): MineSettings {
    const dm = settings.decision_models as { tasks?: Record<string, Record<string, unknown>> } | undefined;
    const t = dm?.tasks?.mine ?? {};
    const out: MineSettings = { ...MINE_DEFAULTS, enabled: t.enabled === true, log_steps: t.log_steps !== false, model };
    for (const k of MINE_NUMBER_KEYS) {
        const v = t[k];
        if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v;
    }
    if (typeof t.max_steps === 'number' && Number.isFinite(t.max_steps) && t.max_steps > 0) out.max_steps = t.max_steps;
    const prompt = served ?? (typeof t.prompt === 'string' ? t.prompt : undefined);
    if (prompt && (MINE_PROMPTS as readonly string[]).includes(prompt)) out.prompt = prompt as MinePrompt;
    return out;
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
        // the harness's timeline sees every action, even one shorter than its 1 s tick
        onHolder: () => { setImmediate(() => harnessRef?.stateNow()); },
        log: e => {
            log(`[laya] director: stop-overrun ${e.runner} (${e.waitedMs} ms)`);
            jsonl.write('director', e);
        },
    });
    let stopping = false;
    let harnessRef: { stateNow(): void } | null = null;

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

    // 4.2: the remembered places (memory.json `places`, saved at once) and the jobs
    const placeStore = new PlaceStore(path.join(botDir, 'memory.json'));
    placeStore.onError = e => log(`[memory] saving places failed: ${String(e)}`);
    // 5.6: every chest open tells the chores what the home chest holds
    const act = () => (body.bot && body.motion ? {
        bot: actBot(body.bot), motion: body.motion, goals: realGoals(body.bot),
        chestSeen: (at: Vec3Like, items: readonly { name: string; count: number }[]) => chores.chestSeen(at, items, placeStore.recall(HOME_PLACE)),
    } : null);
    const jobDeps: JobDeps = {
        act,
        places: placeStore,
        follow: () => followOf(settings, enabled('follow') ? laya : null, laya.promptFor('follow')),
        followLog: line => jsonl.write('follow', line),
        craft: () => craftOf(settings, enabled('craft') ? laya : null),
        craftLog: line => jsonl.write('craft', line),
        mine: () => mineOf(settings, enabled('mine') ? laya : null, laya.promptFor('mine')),
        mineLog: line => jsonl.write('mine', line),
        mines: mineStore(path.join(botDir, 'laya-mines.json')),
        farm: () => farmOf(settings, enabled('farm') ? laya : null, laya.promptFor('farm')),
        farmLog: line => jsonl.write('farm', line),
        skill: task => skillOf(settings, task, enabled(task) ? laya : null),
        skillLog: (task, line) => jsonl.write(task, line),
        chat: text => { if (settings.chat_ingame !== false) say(text); },
        note: text => log(`[laya] ${text}`),
        checkpoint: () => saver.save(),
        needSaid: new Map(),
        stump: p => chores.stump(p),
        placed: (item, p) => chores.placed(item, p, 'me'),
    };

    // 6.2b: a whisperer is answered by whisper, open chat in open chat (command/reply.ts)
    const replies = new Replies({ say: text => body.say(text), whisper: (to, text) => body.whisper(to, text) });
    const say = (text: string) => { replies.send(text); harness.output(text); };

    // 4.3: the player's job survives a restart (bots/<name>/laya-job.json); the chores state reads in today's
    // format (nothing turns chores on yet: 5.6)
    const jobFile = path.join(botDir, 'laya-job.json');
    const saver = new JobSaver(jobFile, { onError: e => log(`[laya] saving the job failed: ${String(e)}`) });
    // 5.6: chores v2 (bots/<name>/laya-chores.json, logs/laya-chores.jsonl)
    let lastSpeaker: string | null = null;
    let playerPlaced: { kind: StationKind; pos: Vec3Like }[] = [];
    const chores = new Chores({
        stateFile: path.join(botDir, 'laya-chores.json'),
        runsFile: jsonl.file('chores'),
        // 6.2b: on unless the user's settings say chores: false; the harness's off counts only on a harness launch
        settingOn: choresSettingOn(settings),
        harness: process.env.ANDY_TEST_HARNESS === '1',
        settings: () => choresOf(settings),
        client: () => (enabled('chores') ? laya : null),
        served: () => laya.promptFor('chores'),
        act,
        sense: {
            places: placeStore, say: text => say(text), speaker: () => lastSpeaker,
            placed: () => playerPlaced, clearPlaced: () => { playerPlaced = []; }, mines: jobDeps.mines!,
        },
        canRun: spec => makeRunner({ id: 'probe', spec, origin: 'chore', progress: {}, status: 'running', startedAt: 0 }, jobDeps) !== null,
        log: line => { if (line.event === 'run' || choresOf(settings).log_steps) jsonl.write('chores', line); },
        note: text => log(`[laya] ${text}`),
    });
    log(`[laya] chores state: ${chores.on ? 'on' : 'off'}; Last ${JSON.stringify(chores.last())}`);
    const driver = new ChoreDriver({ chores, free: () => lease.isFree, note: text => log(`[laya] ${text}`) });

    const handle = (from: string, message: string, channel: Channel = 'chat') => {
        if (!message || from === name) return;
        if (onlyChatWith.length && !onlyChatWith.includes(from)) return;
        log(`${name} received ${channel === 'whisper' ? 'whisper' : 'message'} from ${from} : ${message}`);
        lastSpeaker = from;
        replies.heard(from, channel);
        // the legacy !commands at the boundary; plain chat goes to the command model (4.1)
        if (containsLegacyCommand(message)) {
            const cmd = parseLegacy(message, from);
            if (typeof cmd === 'string') { say(cmd); return; }
            log(`parsed command: ${JSON.stringify(cmd)}`);
            void run(cmd, from);
            return;
        }
        void handleChat(from, message, {
            me: name,
            model: enabled('command') ? { client: laya, prompt: commandPromptOf(laya.promptFor('command')) } : null,
            opts: commandOpts(settings),
            carry: () => readFacts()?.items ?? [],
            nearestHostile: () => readFacts()?.mobs.find(m => m.dist <= 16)?.name ?? null,
            say,
            run: (cmd, doneSay) => { log(`command model: ${JSON.stringify(cmd)}`); return run(cmd, from, doneSay); },
            log: line => { if (logDecisions(settings)) jsonl.write('command', line); },
            note: log,
        }).catch(e => log(`command: ${String(e)}`));
    };

    /**
     * run carries one Command out. A job runs until it ends: the returned promise says whether it ended done, so
     * a plan of several jobs (give everything) runs them one after another and stops at the first that doesn't
     * (failed, replaced by a new command, stopped).
     */
    const run = async (cmd: Command, from?: string, doneSay?: string): Promise<boolean> => {
        // a player's command: no chore starts for a moment; a stop holds chores (until !layaChores("on") or 5 min)
        if (from && cmd.kind !== 'chores') driver.playerCommand(cmd.kind === 'stop');
        switch (cmd.kind) {
            case 'stop':
                if (director) await director.stop(); else await lease.release();
                return true;
            case 'reply': say(cmd.text); return true;
            case 'ignore': return true;
            case 'inventory': {
                const s = body.bot ? fullState(body.bot, name, activity(), places()) : null;
                const items = Object.entries(s?.inventory.counts ?? {}).map(([k, v]) => `${k}: ${v}`);
                say(items.length ? `INVENTORY: ${items.join(', ')}` : 'INVENTORY: Nothing');
                return true;
            }
            case 'chores': {
                chores.setOn(cmd.on);
                driver.turned();
                // off mid-chore: the chore stops (a player's job on the stack runs on)
                if (!cmd.on) await driver.off(director);
                say(cmd.on ? "Okay, I'll do my chores when nobody needs me." : "Okay, I'm taking a break from chores.");
                if (cmd.on) setTimeout(() => director?.event('tick'), 200).unref();
                return true;
            }
            case 'job': {
                const d = director;
                if (!d) { say("I'm not in the game yet."); return false; }
                const probe = makeRunner({ id: 'probe', spec: cmd.job, origin: 'player', progress: {}, status: 'running', startedAt: 0 }, jobDeps);
                if (!probe) { say(`I can't do ${cmd.job.kind} yet in the new bot.`); return false; }
                const entry = await d.startJob(cmd.job, 'player', {}, from, doneSay ? { doneSay } : {});
                if (!entry) { say(`I can't do ${cmd.job.kind} yet in the new bot.`); return false; }
                const end = await d.ended(entry);
                return end.how === 'done';
            }
        }
    };

    /**
     * restoreWhenReady: every new director (a restart, or a reconnect in this process) takes the saved job back,
     * once the world around andy has loaded: at least RESTORE_MIN_MS after the spawn and the job's player in sight
     * (at most RESTORE_MAX_MS). Until then the file stays as it is, so a kill meanwhile loses nothing. A player's new
     * command meanwhile has replaced the file (the saver), and death or stop removed it: then nothing comes back.
     */
    const restoreWhenReady = (d: Director) => {
        const t0 = Date.now();
        driver.restored = false;
        const who = waitsFor(readJobs(jobFile));
        const check = () => {
            if (director !== d) return;
            const waited = Date.now() - t0;
            if (!body.bot || !body.inGame) { if (waited < RESTORE_MAX_MS) setTimeout(check, 250).unref(); else driver.restored = true; return; }
            const bot = body.bot;
            const seen = who.every(n => !!bot.players[n]?.entity);
            if (waited < RESTORE_MIN_MS || (!seen && waited < RESTORE_MAX_MS)) { setTimeout(check, 250).unref(); return; }
            driver.restored = true;
            if (d.stack.depth > 0) return;
            const plan = planRestore(loadJobs(jobFile), j => makeRunner({ id: 'probe', ...j }, jobDeps) !== null);
            for (const n of plan.notes) log(`[laya] ${n}`);
            if (plan.restore.length) d.stack.restore(plan.restore);
            for (const t of plan.say) say(t);
            if (plan.restore.length) d.event('spawn');
        };
        check();
    };

    const places = () => placeStore.all();
    // 3.3: the sensors read Facts; 3.4: the director decides from them
    let sensors: Sensors | null = null;
    let detachSensors: (() => void) | null = null;
    const facts = (): string | null => {
        if (!sensors || !body.inGame) return null;
        try { return factsLine(sensors.read()); } catch (e) { return `facts error: ${String(e)}`; }
    };
    const readFacts = () => { try { return sensors && body.inGame ? sensors.read() : null; } catch { return null; } };
    const activity = () => ({ idle: lease.isFree, label: lease.isFree ? 'Idle' : lease.holderName ?? 'Acting' });

    // eslint-disable-next-line prefer-const
    const harness = harnessRef = await startHarness(settings.mindserver_port, {
        name,
        inGame: () => body.inGame,
        state: () => (body.bot && body.inGame ? fullState(body.bot, name, activity(), places()) : null),
        facts,
        settings: () => settings,
        message: (from, m) => handle(from, m, 'chat'),
        // start-agent: as the old bot's fresh agent process, the saved places and the chores state are read again (the
        // harness's reset deletes the places and writes chores off)
        start: () => { stopping = false; placeStore.reload(); chores.reload(); body.connect(); },
        stop: () => { stopping = true; body.disconnect(); },
    }, log);

    body.on('state', () => harness.statusChanged());
    body.on('chat', (from: string, message: string) => handle(from, message, 'chat'));
    body.on('whisper', (from: string, message: string) => handle(from, message, 'whisper'));
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
                act,
                models, say, sink, timing: timingOf(settings),
                runners: entry => makeRunner(entry, jobDeps),
                onIdle: () => { const d = director; if (d) void driver.idle(d, () => director); },
            });
            // a hit on andy or a player is decided at once (the sensors' own listener ran first)
            bot.on('entityHurt', (e: { type?: string }) => { if (e === bot.entity || e.type === 'player') director?.event('hurt'); });
            bot.on('spawn', () => director?.event('spawn'));
            // a chest or table a player placed may become the chores centre (the old _choreSensors); a bed when the home bed is gone
            bot.on('blockUpdate', (old: { name?: string } | null, nw: { name: string; position: Vec3Like; getProperties?: () => Record<string, unknown> } | null) => {
                if (!nw || old?.name === nw.name) return;
                const kind = nw.name === 'crafting_table' ? 'table' : ['chest', 'trapped_chest', 'barrel'].includes(nw.name) ? 'chest'
                    : nw.name.endsWith('_bed') && nw.getProperties?.().part !== 'head' ? 'bed' : null;
                if (!kind) return;
                const players = Object.values(bot.players).filter(p => p.entity && p.username !== bot.username).map(p => ({ name: p.username, pos: p.entity.position }));
                if (!placedBy(nw.position, players, bot.entity.position)) return;
                const at = { x: nw.position.x, y: nw.position.y, z: nw.position.z };
                if (kind === 'bed') { chores.placed('bed', at, 'player'); return; }
                playerPlaced = [...playerPlaced, { kind: kind as StationKind, pos: at }].slice(-4);
            });
            saver.attach(director.stack);
            restoreWhenReady(director);
            director.start();
            director.event('spawn');
        }
        log(`[metrics] spawned ${Date.now() - t0} ms after start (login ${body.logins})`);
        fs.appendFileSync(path.join(botDir, 'logs', 'bot-metrics.jsonl'), JSON.stringify({
            time: new Date().toISOString(), event: 'spawn', ms: Date.now() - t0, logins: body.logins, rssMB: Math.round(process.memoryUsage().rss / 1048576),
        }) + '\n');
    });
    body.on('death', () => {
        // the old agent remembered where andy died (today's behaviour)
        const p = body.bot?.entity?.position;
        if (p) placeStore.remember('last_death_position', { x: p.x, y: p.y, z: p.z });
        director?.event('death');
    });
    body.on('end', () => {
        // the saved job stays as it was: the next director (after the reconnect) takes it back
        saver.flush(); saver.detach();
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
        // a graceful restart restores the job too: the file is left as it is
        saver.flush(); saver.detach();
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
