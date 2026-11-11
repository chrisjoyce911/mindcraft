// The director's safety activities, each run under the lease as `director:<name>` (a port of the old bot's
// activities.js performActivity, defend.js LayaDefender.engage and agent.js _defendPlayer). Every choice comes
// from a model's answer or its rules (decideEat, decideDefend); the code here only carries the answer out
// through the actuators and waits. Every wait takes the signal, so an abort ends an activity at once.
import type { Facts, ModelDecider, Outcome } from '../types/index.js';
import { isAborted, sleep } from '../core/abort.js';
import type { Act, ActEntity } from '../actuators/bot.js';
import { eatFood } from '../actuators/eat.js';
import { backoff, eatApple, fight, fleeFrom, shield } from '../actuators/fight.js';
import { avoidMobs, AVOID_DIST } from '../actuators/avoid.js';
import { escape } from '../actuators/escape.js';
import { goNear } from '../actuators/approach.js';
import { bestWeapon, hold } from '../actuators/equip.js';
import { decideEat, eatSituation, type EatDecision } from '../models/eat/index.js';
import { active, decideDefend, defendSituation, type DefendDecision, type NearMob } from '../models/defend/index.js';
import type { ActivityRunnerName, Vec3Like } from '../types/index.js';

const dist3 = (a: Vec3Like, b: Vec3Like): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** Why an activity ended. */
export type ActivityEnd =
    | 'done' | 'stopped' | 'no-food' | 'mob-near' | 'time' // the old performActivity's
    | 'calm' | 'ignore' | 'gone' | 'failed'
    | 'no-eat'; // eat: the eat model (or its rules) said don't

export interface Timing {
    /** defend: pause between decisions while mobs are active. */
    stepMs: number;
    /** defend: after an ignore end, how long the director's defend answer isn't run again (a hurt event breaks it). */
    quietMs: number;
    /** defend: an engagement's ceiling. */
    maxEngageMs: number;
    /** eat: how often the eat model is asked alongside the director. */
    checkMs: number;
    /** heal: how long to wait for health > HEAL_UNTIL. */
    healMs: number;
}
export const DEFAULT_TIMING: Timing = { stepMs: 400, quietMs: 3000, maxEngageMs: 60000, checkMs: 2000, healMs: 60000 };

/** The decision lines the activities write (laya-eat.jsonl, laya-defend.jsonl; 3.5 makes them exact). */
export interface ActivityLog {
    eat(d: EatDecision, outcome: string): void;
    defend(d: DefendDecision, outcome: string): void;
}

export interface ActivityCtx {
    act: Act;
    /** facts now (fresh: skip the tick cache). */
    facts(fresh?: boolean): Facts;
    eatModel: ModelDecider | null;
    defendModel: ModelDecider | null;
    say(text: string): void;
    log: ActivityLog;
    timing: Timing;
    now(): number;
    /** The "no food" message at most every 2 min (kept across activities). */
    askedFoodAt: number;
}

export const HEAL_FOOD = 18;
export const HEAL_UNTIL = 8;
export const HEAL_MOB_NEAR = 8;
export const ASK_FOOD_EVERY_MS = 120000;
export const NO_FOOD_WAIT_MS = 10000;
export const NO_FOOD_TEXT = "I'm hurt and I have no food. Can someone give me some?";
/** defend-player: go within this of the attacked player while the attacker is out of the defend model's reach. */
export const DEFEND_PLAYER_NEAR = 4;

/** hurt: health as the director's state shows it (rounded) is at most HEAL_UNTIL, so heal and its answer agree. */
const hurt = (f: Pick<Facts, 'health'>): boolean => Math.round(f.health) <= HEAL_UNTIL;

/** settle turns an abort thrown by a wait into 'stopped'. */
async function settle(signal: AbortSignal, f: () => Promise<ActivityEnd>): Promise<ActivityEnd> {
    try { return await f(); } catch (e) { if (isAborted(e) || signal.aborted) return 'stopped'; throw e; }
}

/** eatOnce asks the eat model (or its rules) and eats its answer; preset: the eat model already answered. */
async function eatOnce(ctx: ActivityCtx, signal: AbortSignal, preset?: EatDecision): Promise<'ate' | 'no-eat' | 'failed'> {
    const d = preset ?? await decideEat(eatSituation(ctx.facts(true)), ctx.eatModel);
    if (!d.eat || !d.food) { if (!preset) ctx.log.eat(d, 'no-eat'); return 'no-eat'; }
    const o = await eatFood(ctx.act.bot, d.food, signal);
    ctx.log.eat(d, o.ok ? 'ate' : `failed:${o.reason}`);
    return o.ok ? 'ate' : 'failed';
}

/** eat: one eat decision, carried out. */
export function runEat(ctx: ActivityCtx, signal: AbortSignal, preset?: EatDecision): Promise<ActivityEnd> {
    return settle(signal, async () => {
        if (signal.aborted) return 'stopped';
        const r = await eatOnce(ctx, signal, preset);
        return signal.aborted ? 'stopped' : r === 'failed' ? 'failed' : r === 'no-eat' ? 'no-eat' : 'done';
    });
}

/**
 * heal: eat while food < 18 and the eat model says eat; no food → ask for some (at most every 2 min) and
 * wait 10 s; else wait until health > 8, a hostile within 8 (mob-near) or 60 s.
 */
export function runHeal(ctx: ActivityCtx, signal: AbortSignal): Promise<ActivityEnd> {
    return settle(signal, async () => {
        while (!signal.aborted && ctx.facts(true).food < HEAL_FOOD) {
            if (await eatOnce(ctx, signal) !== 'ate') break;
            await sleep(200, signal);
        }
        if (signal.aborted) return 'stopped';
        if (ctx.facts(true).food < HEAL_FOOD) {
            if (ctx.now() - ctx.askedFoodAt > ASK_FOOD_EVERY_MS) {
                ctx.askedFoodAt = ctx.now();
                ctx.say(NO_FOOD_TEXT);
            }
            await sleep(NO_FOOD_WAIT_MS, signal);
            return 'no-food';
        }
        const end = ctx.now() + ctx.timing.healMs;
        for (let f = ctx.facts(true); ctx.now() < end && hurt(f); f = ctx.facts(true)) {
            if (f.nearest && f.hostiles > 0 && f.nearest.dist <= HEAL_MOB_NEAR) return 'mob-near';
            // hunger drops while waiting: below 18 there's no regeneration, so eat again (the eat model says what)
            if (f.food < HEAL_FOOD && await eatOnce(ctx, signal) === 'ate') continue;
            await sleep(1000, signal);
        }
        return hurt(ctx.facts(true)) ? 'time' : 'done';
    });
}

/**
 * flee (from mobs; flee with a Danger runs escape, see runnerFor): run from the nearest hostile until none
 * the sensors see (within MOB_SCAN 18) is within 24, or the ceiling.
 */
export function runFlee(ctx: ActivityCtx, signal: AbortSignal): Promise<ActivityEnd> {
    return settle(signal, async () => {
        const o = await avoidMobs(ctx.act, d => nearestHostile(ctx, d), signal, AVOID_DIST);
        return signal.aborted ? 'stopped' : o.ok ? 'done' : 'failed';
    });
}

/** isEscape: a flee answer runs the escape actuator (the danger is the world, not a mob). */
export const isEscape = (f: Pick<Facts, 'danger'>): boolean => f.danger === 'fire' || f.danger === 'fluid' || f.danger === 'drowning';

/** runnerFor: the runner a safety answer starts now. */
export function runnerFor(answer: 'defend' | 'flee' | 'eat' | 'heal', f: Pick<Facts, 'danger'>): ActivityRunnerName {
    return answer === 'flee' && isEscape(f) ? 'escape' : answer;
}

function entityOf(ctx: ActivityCtx, id: number | undefined): ActEntity | null {
    if (id === undefined) return null;
    const e = ctx.act.bot.entities[id];
    return e && e.isValid !== false ? e : null;
}

function nearestHostile(ctx: ActivityCtx, within: number): ActEntity | null {
    const f = ctx.facts(true);
    const m = f.mobs.find(x => x.dist <= within);
    return m ? entityOf(ctx, m.id) : null;
}

/**
 * defend: every stepMs ask decideDefend about the attackers (the defend situation holds only mobs that hurt
 * andy or a player) and carry the answer out, until calm, ignore, the target is gone, an abort or
 * maxEngageMs. defend-player: while the attacked player's attacker isn't active for the defend model (too far
 * from andy), go to the player first (saying so once).
 */
export function runDefend(ctx: ActivityCtx, signal: AbortSignal): Promise<ActivityEnd> {
    return settle(signal, async () => {
        const end = ctx.now() + ctx.timing.maxEngageMs;
        const weapon = bestWeapon(ctx.act.bot.items().map(i => i.name));
        if (weapon) await hold(ctx.act.bot, weapon);
        let told = false;
        while (!signal.aborted && ctx.now() < end) {
            const f = ctx.facts(true);
            const s = defendSituation(f);
            if (!s.mobs.some(m => active(s, m))) {
                // defend-player: the player's attacker isn't in the defend model's reach yet: go to the player
                const p = f.player;
                const attacker = p?.attacked ? entityOf(ctx, p.attacked.entityId) : null;
                const player = p && attacker ? Object.values(ctx.act.bot.entities).find(e => e.username === p.name) ?? null : null;
                if (!p || !attacker || !player || dist3(f.pos, player.position) <= DEFEND_PLAYER_NEAR + 1) return 'calm';
                if (!told) { ctx.say(`Hang on ${p.name}, I'm coming for that ${String(attacker.name ?? 'mob').replace(/_/g, ' ')}!`); told = true; }
                const o = await goNear(ctx.act, player, DEFEND_PLAYER_NEAR, signal);
                if (signal.aborted) return 'stopped';
                if (!o.ok && o.reason !== 'timeout') return 'failed';
                continue;
            }
            const d = await decideDefend(s, ctx.defendModel);
            if (signal.aborted) return 'stopped';
            if (d.answer === 'ignore') { ctx.log.defend(d, 'ignore'); return 'ignore'; }
            let o: Outcome;
            if (d.answer === 'eat') o = await eatApple(ctx.act, signal);
            else {
                const target = entityOf(ctx, (s.mobs as NearMob[])[d.target]?.id);
                if (!target) { ctx.log.defend(d, 'gone'); return 'gone'; }
                o = await act(ctx, d, target, signal);
            }
            ctx.log.defend(d, o.ok ? d.answer : `${d.answer}:${o.reason}`);
            if (signal.aborted) return 'stopped';
            await sleep(ctx.timing.stepMs, signal);
        }
        return signal.aborted ? 'stopped' : 'time';
    });
}

function act(ctx: ActivityCtx, d: DefendDecision, target: ActEntity, signal: AbortSignal): Promise<Outcome> {
    switch (d.answer) {
        case 'fight': return fight(ctx.act, target, d.weapon, signal);
        case 'shield': return shield(ctx.act, target, d.weapon, signal);
        case 'backoff': return backoff(ctx.act, target, d.weapon, signal);
        case 'flee': return fleeFrom(ctx.act, target, signal);
        default: return Promise.resolve({ ok: true });
    }
}

/** escape: the danger the sensors report now. */
export function runEscape(ctx: ActivityCtx, signal: AbortSignal): Promise<ActivityEnd> {
    return settle(signal, async () => {
        const o = await escape(ctx.act, ctx.facts(true).danger, signal);
        return signal.aborted ? 'stopped' : o.ok ? 'done' : 'failed';
    });
}
