// Sensors: one typed Facts snapshot per tick (design §3.1, §5.1). They only read: no decisions, no
// chat, no forgetting. attach() wires the hurt events; read() caches within a tick.
import { StuckWatch } from '../core/stuck.js';
import type { Facts, Places } from '../types/index.js';
import { Attacks } from './attacks.js';
import type { SensorBot } from './bot.js';
import { dangerOf, feel } from './danger.js';
import { homeFacts } from './home.js';
import { wireHurt } from './hurt.js';
import { lightFacts } from './light.js';
import { hostileFacts, scanMobs } from './mobs.js';
import { packFacts } from './pack.js';
import { meFact, nearestPlayerDist, playerFact } from './player.js';
import { armedOf, armorPoints, roundSaturation } from './vitals.js';

export const TICK_MS = 250;

export interface SensorDeps {
    places(): Places;
    /** Motion's in-flight flag (core/motion.ts `moving`); without it the bot is never stuck. */
    moving?(): boolean;
    now?(): number;
    tickMs?: number;
    attacks?: Attacks;
}

export class Sensors {
    readonly attacks: Attacks;
    private readonly stuck = new StuckWatch();
    private readonly now: () => number;
    private readonly tickMs: number;
    private cached: Facts | null = null;
    constructor(private readonly bot: SensorBot, private readonly deps: SensorDeps) {
        this.now = deps.now ?? (() => Date.now());
        this.tickMs = deps.tickMs ?? TICK_MS;
        this.attacks = deps.attacks ?? new Attacks(this.now);
    }

    /** attach wires entityHurt/entityGone into Attacks; returns the detach. */
    attach(): () => void { return wireHurt(this.bot, this.attacks); }

    /** read: the Facts now, or the same snapshot when read again within a tick. */
    read(): Facts {
        const now = this.now();
        if (this.cached && now - this.cached.t < this.tickMs) return this.cached;
        const bot = this.bot;
        const pos = bot.entity.position;
        const mobs = scanMobs(bot, this.attacks, now);
        const pack = packFacts(bot);
        const lt = lightFacts(bot);
        const facts: Facts = {
            t: now,
            pos: { x: pos.x, y: pos.y, z: pos.z },
            health: bot.health ?? 20,
            food: bot.food ?? 20,
            saturation: roundSaturation(bot.foodSaturation),
            armed: armedOf(pack.items.map(i => i.name)),
            armor: armorPoints(pack.worn),
            ...hostileFacts(mobs),
            mobs,
            me: meFact(bot, this.attacks, now),
            player: playerFact(bot, this.attacks, now),
            nearestPlayer: nearestPlayerDist(bot),
            ...lt,
            danger: dangerOf(feel(bot)),
            ...pack,
            ...homeFacts(this.deps.places(), pos, (x, y, z) => bot.blockAt(x, y, z)),
            stuck: this.stuck.feed(pos, this.deps.moving?.() ?? false, bot.digTarget(), now),
        };
        this.cached = facts;
        return facts;
    }

    /** last: the last snapshot, or null before the first read. */
    get last(): Facts | null { return this.cached; }
}

/** factsLine: one line for the status page and logs. */
export function factsLine(f: Facts): string {
    const yn = (b: boolean) => (b ? 'yes' : 'no');
    return [
        `health ${Math.round(f.health)} food ${f.food}`,
        `hostiles ${f.hostiles} nearest ${f.nearest ? `${f.nearest.kind} ${f.nearest.dist}` : 'none'}`,
        `me ${f.me ? `${f.me.by} ${f.me.dist}` : 'none'}`,
        `player ${f.player ? `${f.player.name}${f.player.attacked ? ` attacked by ${f.player.attacked.by}` : ''} ${Math.round(f.player.dist)}` : 'none'}`,
        `light ${f.light} night ${yn(f.night)} under ${yn(f.under)} danger ${f.danger}`,
        `home ${f.home ? f.home.dist : f.homeGone ? 'gone' : 'none'} stuck ${yn(f.stuck)}`,
    ].join(' · ');
}

export { Attacks, ATTACK_MS, BLAME_RANGE, FUSE_RANGE, ME_MS, fusing, isAttacker } from './attacks.js';
export { sensorBot, type SensorBot, type SensorEntity, type SensorBlock } from './bot.js';
export { mobKind, isHostile, NEAREST_KINDS, HOSTILE_RANGE, MOB_SCAN } from './mobs.js';
export { armedOf, armorPoints } from './vitals.js';
export { dangerOf } from './danger.js';
export { homeState } from './home.js';
