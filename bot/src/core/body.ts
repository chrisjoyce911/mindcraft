// Body: the one mineflayer bot and its connection (design §3). Only actuators move it (through
// the lease); sensors and the harness only read `bot`.
import { EventEmitter } from 'events';
import mineflayer from 'mineflayer';
import pathfinderPkg from 'mineflayer-pathfinder';
import pvpPkg from 'mineflayer-pvp';
import { Motion } from './motion.js';
import { keepStations } from './keep.js';
import type { Channel } from '../types/commands.js';

const { pathfinder, Movements } = pathfinderPkg;

/** MAX_SAFE_DROP: the safe movements never drop further than this (the old skills.MAX_SAFE_DROP). */
export const SAFE_MAX_DROP = 3;

/** stationMovements: the pathfinder's default moves, the stations kept. */
export function stationMovements(bot: mineflayer.Bot): unknown {
    return keepStations(new Movements(bot) as unknown as { blocksCantBreak: Set<number> }, bot.registry);
}

/**
 * safeMovements: pathfinder moves that never drop more than SAFE_MAX_DROP blocks, jump gaps or wade through fluid
 * (mining, collecting ore; the old skills.safeMovements).
 */
export function safeMovements(bot: mineflayer.Bot): unknown {
    const m = keepStations(new Movements(bot) as unknown as Record<string, unknown> & { blocksCantBreak: Set<number> }, bot.registry);
    m.liquidCost = 100;
    m.dontCreateFlow = true;
    m.allowParkour = false;
    m.maxDropDown = SAFE_MAX_DROP;
    m.infiniteLiquidDropdownDistance = false;
    return m;
}
/** FARM_AVOID: the blocks the farm movements never step on (trampling farmland turns it back to dirt). */
export const FARM_AVOID = ['farmland', 'wheat', 'carrots', 'potatoes', 'beetroots'] as const;

/** farmMovements: no parkour, no sprint, no digging, farmland and crops avoided (the old farm_actions.js movements). */
export function farmMovements(bot: mineflayer.Bot): unknown {
    const m = keepStations(new Movements(bot) as unknown as Record<string, unknown> & { blocksToAvoid: Set<number>; blocksCantBreak: Set<number> }, bot.registry);
    m.allowParkour = false;
    m.allowSprinting = false;
    m.canDig = false;
    m.dontCreateFlow = true;
    for (const name of FARM_AVOID) {
        const id = bot.registry.blocksByName[name]?.id;
        if (id !== undefined) m.blocksToAvoid.add(id);
    }
    return m;
}
const { plugin: pvp } = pvpPkg as unknown as { plugin: mineflayer.Plugin };

export interface BodyOptions { host: string; port: number; username: string; version: string; auth: 'offline' | 'microsoft' }

export type BodyState = 'offline' | 'connecting' | 'in-game';

/** The bot's message events (mineflayer's 'chat' and 'whisper': /msg andy …, /tell andy …). */
export interface MessageSource {
    username: string;
    on(event: 'chat' | 'whisper', fn: (username: string, message: string) => void): unknown;
}

/** forwardMessages: open chat and whispers from other players go to emit (andy's own are dropped). */
export function forwardMessages(bot: MessageSource, emit: (event: Channel, username: string, message: string) => void): void {
    for (const event of ['chat', 'whisper'] as const) {
        bot.on(event, (username: string, message: string) => { if (username !== bot.username) emit(event, username, message); });
    }
}

/** Body events: 'state' (BodyState), 'spawn', 'death', 'chat' and 'whisper' (username, message), 'end' (reason). */
export class Body extends EventEmitter {
    bot: mineflayer.Bot | null = null;
    motion: Motion | null = null;
    state: BodyState = 'offline';
    /** process start → first spawn, ms */
    readonly startedAt = Date.now();
    firstSpawnMs: number | null = null;
    logins = 0;

    constructor(readonly opts: BodyOptions, private readonly log: (m: string) => void = console.log) { super(); }

    get inGame(): boolean { return this.state === 'in-game'; }

    private setState(s: BodyState) { if (s !== this.state) { this.state = s; this.emit('state', s); } }

    connect(): void {
        if (this.state !== 'offline') return;
        this.setState('connecting');
        this.logins++;
        this.log(`${this.opts.username} logging into minecraft...`);
        const bot = mineflayer.createBot({
            host: this.opts.host, port: this.opts.port, username: this.opts.username,
            version: this.opts.version === 'auto' ? false as unknown as string : this.opts.version,
            auth: this.opts.auth, checkTimeoutInterval: 60000,
        });
        this.bot = bot;
        bot.loadPlugin(pathfinder);
        bot.loadPlugin(pvp);
        bot.once('login', () => this.log(`${this.opts.username} logged in!`));
        bot.once('spawn', () => {
            if (this.firstSpawnMs === null) this.firstSpawnMs = Date.now() - this.startedAt;
            const pf = bot.pathfinder as unknown as { thinkTimeout: number };
            pf.thinkTimeout = 5000;
            (bot.pathfinder as unknown as { setMovements(m: unknown): void }).setMovements(stationMovements(bot));
            this.motion = new Motion(bot as unknown as ConstructorParameters<typeof Motion>[0], undefined, () => safeMovements(bot), () => farmMovements(bot));
            this.setState('in-game');
            this.log(`${this.opts.username} spawned.`);
            this.emit('spawn');
        });
        bot.on('death', () => { this.emit('death'); });
        forwardMessages(bot, (event, username, message) => this.emit(event, username, message));
        bot.on('kicked', (reason: unknown) => this.log(`${this.opts.username} kicked: ${typeof reason === 'string' ? reason : JSON.stringify(reason)}`));
        bot.on('error', (e: Error) => this.log(`${this.opts.username} connection error: ${e.message}`));
        bot.once('end', (reason: string) => {
            this.log(`${this.opts.username} disconnected (${reason})`);
            if (this.bot === bot) { this.bot = null; this.motion = null; }
            this.setState('offline');
            this.emit('end', reason);
        });
    }

    disconnect(): void {
        try { this.bot?.quit(); } catch { /* gone */ }
    }

    /** reset: stop every motion now (the lease overrun rule and stop). */
    reset(): void {
        const bot = this.bot;
        if (!bot) return;
        this.motion?.stop();
        try { (bot as unknown as { pvp?: { stop(): void } }).pvp?.stop(); } catch { /* not fighting */ }
    }

    /** say: chat in game (the harness also relays it as bot-output). */
    say(text: string): void {
        if (!this.bot || !this.inGame) return;
        for (const line of text.split('\n').filter(Boolean)) this.bot.chat(line);
        this.emit('said', text);
    }

    /** whisper: a private reply to one player (/tell; the harness also relays it as bot-output). */
    whisper(to: string, text: string): void {
        if (!this.bot || !this.inGame) return;
        for (const line of text.split('\n').filter(Boolean)) this.bot.whisper(to, line);
        this.emit('said', text);
    }
}
