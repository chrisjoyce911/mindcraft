// The mine job (the old bot's src/agent/laya/mine.js mineWithLaya and skills.mineOre): mine until count more of an
// ore's drop is collected, one loop iteration per job step, so the director's lease, pause and interrupt work
// between steps. Each step: read the 5×5×5 view around andy, decide (models/mine decideMineStep: the model's step
// when it is sure, safe and makes sense, else the rules'), and do it as a short macro: collect the ore in sight,
// tunnel or stair down or up one block, place a torch, block lava or water touching andy, or stop. It never digs
// straight down.
//
// What it lacks it makes (makeItem, 5.1's craft loop): the pickaxe the ore needs (before starting, on "stop" for a
// weak pickaxe, and when it breaks: the inventory decides, not the craft's report), a batch of torches when it has
// fewer than torch_low and carries coal and sticks (or wood), or none left in the dark (backing off
// torch_retry_steps after a failed craft).
//
// With prompt v2 (the default) it follows a mine plan (models/mine/plan.ts): a staircase down to the ore's band and
// a branch-mine grid at each level. Ore in sight is collected only when it is safe and near the mine (collect_range
// of a mine cell, at most collect_below under it, collect_below_open when open to the air, collect_budget blocks
// off the plan); off the plan it walks back (walk_restart failed walks: the plan starts again where andy stands);
// a detour round an unsafe plan step abandons that segment; floor vetoes on the staircase shift it (above the band)
// or start the level (in it); every plan step unsafe: a new staircase from the entrance in an untried heading. v2
// also decides Unload: the pack goes into the home chest (tools, food, torches and keep_blocks throwaway blocks
// stay; never the kit) and andy walks back. Hurt: eat to eat_to, retreat to the entrance from hostiles, wait to
// heal (no food: stop and ask for some). The mine is saved in mine memory, so a mine job near it goes on with it.
//
// Progress ({done, deposited}) is the drop collected so far (and how much of it went into the home chest): a job
// resumed after a pause or a restart mines count − done more; the plan comes back through mine memory (the same
// layout from the same entrance, dug cells skipped). Before a deposit the progress is checkpointed to disk.
import type { JobSpec, JobStepper, StepResult, Vec3Like } from '../types/index.js';
import {
    ORES, THROWAWAY, OFFSET, FACE, HEAD, FEET, SEEN_RANGE, TORCH_EVERY, LOW_HEALTH, HOSTILES_CAP, PLAN_KEYS,
    readView, cellOf, touching, pickTier, countOf, valuables, homeDistance, headingOf, createPlan, pickOre, oreSafe, openSky,
    headingToward, canMakeTorches, depositList, dropBelow, moveFeet, worldCell, cellsToDig, decideMineStep, moveOf, kindOf,
    backOf, rightOf, leftOf, pickaxeFor, decide, state,
    type Dir, type Ore, type OreInfo, type MinePlan, type PlanOptions, type MineSituation, type Inv, type GeoBlockAt, type Stack,
    type PlaceOnWord,
} from '../models/mine/index.js';
import { mineLines, mineStepLine, type MineLine, type MineStepEntry } from '../log/jsonl.js';
import type { MineBook, MineRecord } from '../home/mines.js';
import { MINE_DEFAULTS, type JobDeps, type JobOf, type MineSettings } from './deps.js';
import { jobFailedMessage } from './message.js';
import { homeFinder, mineWorld } from './mineWorld.js';

export const MAX_STEPS = { v1: 300, v2: 2000 } as const;
export const MINE_CELLS = 400;

/** What the mine job needs of the world (mineWorld builds it from the actuators; tests pass fakes). */
export interface MineWorld {
    /** andy's position (not floored). */
    position(): Vec3Like;
    yaw(): number;
    health(): number;
    food(): number;
    blockAt: GeoBlockAt;
    /** andy's items by name. */
    inventory(): Inv;
    /** The ore blocks named one of blocks within range, nearest first. */
    ores(blocks: readonly string[], range: number): Vec3Like[];
    freeSlots(): number;
    /** The home chest, or null. */
    home(): Vec3Like | null;
    /** Hostile mobs within 16 blocks. */
    hostiles(): number;
    isFood(name: string): boolean;
    /** Make n more of item (the craft loop); true when it reports done (the inventory decides). */
    craft(item: string, n: number, signal: AbortSignal): Promise<boolean>;
    /** Collect the ore block at o; true when its drop is in the pack. */
    collect(o: Vec3Like, blocks: readonly string[], drop: string, signal: AbortSignal): Promise<boolean>;
    /** Dig the block at p (air: done). */
    dig(p: Vec3Like, signal: AbortSignal): Promise<boolean>;
    /** Go to the cell c: a step into a dug cell (ms null: 4 s) or a walk through the mine (ms given). */
    moveTo(c: Vec3Like, ms: number | null, signal: AbortSignal): Promise<boolean>;
    /** Place item into the cell p against its side `on`. */
    place(item: string, p: Vec3Like, on: PlaceOnWord, signal: AbortSignal): Promise<boolean>;
    goHome(home: Vec3Like, signal: AbortSignal): Promise<boolean>;
    /** Put items into the home chest (and the chests touching it); true when all went in. */
    deposit(items: readonly Stack[], signal: AbortSignal): Promise<boolean>;
    /** Eat the best food; false when there's none or it failed. */
    eat(signal: AbortSignal): Promise<boolean>;
    /** Wait ms; false when aborted. */
    sleep(ms: number, signal: AbortSignal): Promise<boolean>;
}

/** The job's progress (kept in laya-job.json). */
export interface MineProgress {
    /** The drop collected so far over every run of the job. */
    done?: number;
    /** How much of it went into the home chest. */
    deposited?: number;
}

export interface MineCounters {
    asked: number; model: number; rules: Record<string, number>; vetoes: Record<string, number>; steps: Record<string, number>;
    failures: number; crafted: string[]; walks: number; abandoned: number; unloads: number; restarts?: number;
}
export const newMineCounters = (): MineCounters =>
    ({ asked: 0, model: 0, rules: {}, vetoes: {}, steps: {}, failures: 0, crafted: [], walks: 0, abandoned: 0, unloads: 0 });

const bump = (m: Record<string, number>, k: string) => { m[k] = (m[k] || 0) + 1; };

/** mineSummary: the console's summary line (the old summary()). */
export function mineSummary(c: MineCounters, got: number, want: number | 'forever', drop: string): string {
    const rules = Object.entries(c.rules).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const vetoes = Object.entries(c.vetoes).map(([r, n]) => `${r} ${n}`).join(', ') || 'none';
    const plan = c.walks || c.abandoned || c.unloads ? `; walks ${c.walks}, abandoned ${c.abandoned}, unloads ${c.unloads}` : '';
    return `Laya mine: ${got} of ${want === 'forever' ? Infinity : want} ${drop}; asked ${c.asked}, model steps ${c.model}, rule steps: ${rules}; vetoes: ${vetoes}; crafted: ${c.crafted.join(', ') || 'nothing'}${plan}`;
}

export interface MineRunContext {
    ore: Ore;
    /** How many more of the drop (forever: until stopped). */
    count: number | 'forever';
    progress: MineProgress;
    settings(): MineSettings;
    world(): MineWorld | null;
    mines: MineBook | null;
    /** Writes a laya-mine.jsonl line (when log_steps). */
    log(line: MineLine): void;
    /** The console. */
    note(text: string): void;
    /** Says something in game. */
    chat(text: string): void;
    /** Writes the job's progress to disk now (before a deposit). */
    checkpoint(): void;
    now?: () => Date;
}

/** How a run ended: ok (the count is collected) or not, why, what it collected this run. */
export interface MineEnd { ok: boolean; reason: string; collected: number; counters: MineCounters; entrance?: Vec3Like; reused: boolean }
export type MineStep = { how: 'more' } | { how: 'end'; end: MineEnd };

const MORE: MineStep = { how: 'more' };
const floorOf = (p: Vec3Like): Vec3Like => ({ x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) });
const dist = (a: Vec3Like, b: Vec3Like) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const same = (a: Vec3Like, b: Vec3Like) => a.x === b.x && a.y === b.y && a.z === b.z;
const oreKey = (o: Vec3Like) => `${o.x},${o.y},${o.z}`;
const total = (inv: Inv) => Object.values(inv).reduce((n, c) => n + c, 0);

/**
 * MineRun is one run of a mine job (a runner's life: from a start or a resume until it ends or is paused): the old
 * mineWithLaya's state, one loop iteration per step().
 */
export class MineRun {
    readonly counters = newMineCounters();
    private readonly info: OreInfo;
    private readonly opts: MineSettings;
    private readonly v2: boolean;
    private readonly maxSteps: number;
    private readonly planOpts: Partial<PlanOptions>;
    private started = false;
    private ended: MineEnd | null = null;
    private n = 0;
    private start = 0;
    private deposited = 0;
    private readonly base: number;
    private heading: Dir = 'N';
    private dark = 0;
    private failures = 0;
    private noTorchUntil = 0;
    private noUnloadUntil = 0;
    private offPlan = 0;
    private walkFails = 0;
    private abandonStreak = 0;
    private unsafeRestarts = 0;
    private floorVetoes = 0;
    private readonly triedHeadings = new Set<Dir>();
    private readonly failedOre = new Set<string>();
    private readonly mineCells: Vec3Like[] = [];
    private plan: MinePlan | null = null;
    private mineRec: MineRecord | null = null;
    private reused: MineRecord | null = null;

    constructor(private readonly c: MineRunContext) {
        this.info = ORES[c.ore] ?? ORES.coal; // an unknown ore (an old job file) ends at the first step
        this.opts = { ...MINE_DEFAULTS, ...c.settings() };
        this.v2 = this.opts.prompt === 'v2' || this.opts.prompt === 'v2.1';
        this.maxSteps = this.opts.max_steps ?? MAX_STEPS[this.v2 ? 'v2' : 'v1'];
        this.planOpts = Object.fromEntries(PLAN_KEYS.filter(k => this.opts[k] != null).map(k => [k, this.opts[k]]));
        this.base = c.progress.done ?? 0;
    }

    /** The drop wanted this run (count less what earlier runs collected). */
    private get want(): number { return this.c.count === 'forever' ? Infinity : this.c.count - this.base; }
    private iso(): string { return (this.c.now?.() ?? new Date()).toISOString(); }
    private logStep(line: MineLine): void { if (this.opts.log_steps) { try { this.c.log(line); } catch { /* never stops mining */ } } }
    private got(w: MineWorld): number { return (w.inventory()[this.info.drop] || 0) + this.deposited - this.start; }
    private record(w: MineWorld): void { this.c.progress.done = this.base + Math.max(0, this.got(w)); }
    private feet(w: MineWorld): Vec3Like { return floorOf(w.position()); }

    private addMineCell(c: Vec3Like): void {
        if (this.mineCells.some(m => same(m, c))) return;
        this.mineCells.push({ x: c.x, y: c.y, z: c.z });
        if (this.mineCells.length > MINE_CELLS) this.mineCells.splice(1, 1); // keep the entrance
    }

    private saveMine(w: MineWorld): void {
        const rec = this.mineRec;
        if (!rec || !this.c.mines) return;
        const f = this.feet(w);
        rec.deepest = Math.min(rec.deepest ?? f.y, f.y);
        rec.last = f;
        rec.updated = this.iso();
        this.c.mines.save(rec);
    }

    private finish(w: MineWorld, ok: boolean, reason: string): MineStep {
        this.record(w);
        const got = this.got(w);
        this.c.note(mineSummary(this.counters, got, this.c.count === 'forever' ? 'forever' : this.want, this.info.drop));
        this.saveMine(w);
        this.ended = { ok, reason, collected: got, counters: this.counters, ...(this.plan ? { entrance: this.plan.entrance } : {}), reused: !!this.reused };
        return { how: 'end', end: this.ended };
    }

    /** close: this run stops (paused, replaced, stopped) without ending: count what it got, save the mine. */
    close(): void {
        if (this.ended || !this.started) return;
        const w = this.c.world();
        if (!w) return;
        this.record(w);
        this.c.note(mineSummary(this.counters, this.got(w), this.c.count === 'forever' ? 'forever' : this.want, this.info.drop) + ' (paused)');
        this.saveMine(w);
    }

    private async craft(w: MineWorld, item: string, n: number, signal: AbortSignal): Promise<boolean> {
        const ok = await w.craft(item, n, signal).catch(() => false);
        if (ok) this.counters.crafted.push(`${item} x${n}`);
        this.c.note(ok ? `Crafted ${item} for mining.` : `Couldn't craft ${item} for mining.`);
        return ok;
    }

    private async ensurePickaxe(w: MineWorld, signal: AbortSignal): Promise<boolean> {
        if (pickTier(w.inventory()) >= this.info.tier) return true;
        await this.craft(w, pickaxeFor(this.info.tier), 1, signal);
        return pickTier(w.inventory()) >= this.info.tier; // the inventory decides, not the craft's report
    }

    /** walkTo walks through the dug mine, allowing time for the distance. */
    private async walkTo(w: MineWorld, c: Vec3Like, signal: AbortSignal): Promise<boolean> {
        const f = this.feet(w);
        const ms = Math.max(4000, Math.ceil(Math.hypot(c.x - f.x, c.y - f.y, c.z - f.z)) * 700);
        this.counters.walks++;
        return w.moveTo(c, ms, signal);
    }

    /** goUnload returns 'done', 'partial' (the chests filled up after taking something), 'failed' or null (aborted). */
    private async goUnload(w: MineWorld, home: Vec3Like, signal: AbortSignal): Promise<'done' | 'partial' | 'failed' | null> {
        this.counters.unloads++;
        if (!await w.goHome(home, signal)) return signal.aborted ? null : 'failed';
        const items = depositList(w.inventory(), n => w.isFood(n), this.opts.keep_blocks);
        const inv0 = w.inventory();
        // on disk before the deposit: a kill during it never counts the drop twice or loses it
        this.record(w);
        this.c.checkpoint();
        const ok = await w.deposit(items, signal).catch(() => false);
        const inv1 = w.inventory();
        const moved = Math.max(0, (inv0[this.info.drop] || 0) - (inv1[this.info.drop] || 0));
        this.deposited += moved;
        this.c.progress.deposited = (this.c.progress.deposited ?? 0) + moved;
        this.record(w);
        if (signal.aborted) return null;
        const outcome = ok ? 'done' : total(inv1) < total(inv0) ? 'partial' : 'failed';
        this.c.note({ done: 'Emptied my pack into the home chest.', partial: 'The home chest is full: I put in what fit.',
            failed: "Couldn't empty my pack into the home chest." }[outcome]);
        return outcome;
    }

    /**
     * heal (rule heal): hurt, so no more digging down: eat until food eat_to, retreat to the entrance from hostiles,
     * wait to regenerate. With no food it stops and asks for some. Returns an end, null (healed) or MORE (aborted).
     */
    private async heal(w: MineWorld, feet: Vec3Like, upTo: number, signal: AbortSignal): Promise<MineStep | null> {
        bump(this.counters.rules, 'heal');
        const hostiles = w.hostiles();
        const h = { pos: feet, health: Math.round(w.health()), food: w.food(), hostiles };
        let ate = 0;
        while (!signal.aborted && w.food() < this.opts.eat_to && ate < 8 && await w.eat(signal).catch(() => false)) ate++;
        if (signal.aborted) return MORE;
        let retreated = false;
        if (hostiles > 0 && this.plan) retreated = await this.walkTo(w, this.plan.entrance, signal);
        if (signal.aborted) return MORE;
        if (w.food() < this.opts.eat_to) {
            this.logStep(mineLines.heal({ ...h, ate, retreated }, 'stopped'));
            this.c.chat("I'm hurt and I have no food, so I've stopped mining. Can someone bring me food?");
            return this.finish(w, false, 'hurt with no food');
        }
        for (let i = 0; i < this.opts.heal_wait_s && w.health() <= upTo; i++) {
            if (!retreated && this.plan && w.hostiles() > 0) retreated = await this.walkTo(w, this.plan.entrance, signal);
            if (!await w.sleep(1000, signal)) return MORE;
        }
        this.logStep(mineLines.heal({ ...h, ate, retreated, healthAfter: Math.round(w.health()) }, 'done'));
        return null;
    }

    /**
     * unsafeHere: after max_abandons segments given up with no planned step done (or a blocked staircase), every
     * plan step here is unsafe: a new staircase from the entrance in a heading not tried yet (back, right, left);
     * with none left, mining stops.
     */
    private unsafeHere(w: MineWorld, entry: MineStepEntry | { pos: Vec3Like; blocked: true }): MineStep | null {
        const plan = this.plan;
        if (!plan || this.abandonStreak < this.opts.max_abandons) return null;
        this.abandonStreak = 0;
        const f = this.feet(w);
        this.triedHeadings.add(plan.heading);
        const next = [backOf(plan.heading), rightOf(plan.heading), leftOf(plan.heading)].find(h => !this.triedHeadings.has(h));
        if (!next || ++this.unsafeRestarts > this.opts.max_unsafe_restarts) {
            this.logStep('blocked' in entry ? mineLines.blocked(entry.pos) : mineStepLine(entry, 'unsafe-ground'));
            return this.finish(w, false, `the ground at ${f.x} ${f.y} ${f.z} is unsafe (water or caves): every plan step is vetoed`);
        }
        this.heading = next;
        const e = plan.entrance;
        this.plan = createPlan({ ...e, heading: next }, this.info, { ...this.planOpts, surface: !!this.mineRec?.surface });
        this.triedHeadings.add(next);
        this.counters.restarts = (this.counters.restarts || 0) + 1;
        this.logStep(mineLines.unsafeRestart(e, f, next));
        this.c.note(`The ground is unsafe at ${f.x} ${f.y} ${f.z}: a new staircase from the entrance ${e.x} ${e.y} ${e.z}, heading ${next}.`);
        return null;
    }

    /** setup: the pickaxe, then (v2) the mine: a saved one near goes on, else a new plan. */
    private async setup(w: MineWorld, signal: AbortSignal): Promise<MineStep | null> {
        const ore = this.info;
        this.heading = headingOf(w.yaw() || 0);
        this.start = w.inventory()[ore.drop] || 0;
        if (!await this.ensurePickaxe(w, signal)) return signal.aborted ? MORE : this.finish(w, false, `needs a ${pickaxeFor(ore.tier)}`);
        if (!this.v2) return null;
        const f = this.feet(w);
        let reused = this.c.mines?.find(f) ?? null;
        let msg: string;
        if (reused) {
            // the blocks andy dug for it must be air (a reset world, a filled mine: gone); nothing dug: no mine
            const there = !!reused.dug?.length && reused.dug.every(c => cellOf(w.blockAt(c.x, c.y, c.z), []) === 'A');
            if (!there) {
                this.logStep(mineLines.gone(reused.entrance));
                this.c.mines?.forget(reused.entrance);
                reused = null;
            }
        }
        if (reused) {
            // the same layout from the same entrance: walk through what is dug
            const e = reused.entrance;
            this.heading = reused.heading as Dir;
            this.plan = createPlan({ ...e, heading: this.heading }, ore, { ...this.planOpts, surface: !!reused.surface });
            const open = (c: Vec3Like) => ['A', 'O'].includes(cellOf(w.blockAt(c.x, c.y, c.z), [])) && cellOf(w.blockAt(c.x, c.y + 1, c.z), []) === 'A';
            const skipped = this.plan.skipDug(open);
            this.mineRec = { ...reused, ores: [...new Set([...(reused.ores || []), this.c.ore])] };
            msg = `Going on with the mine at ${e.x} ${e.y} ${e.z} (heading ${this.heading}) for ${this.c.ore}.`;
            this.logStep(mineLines.reused(e, skipped));
        } else {
            const surface = openSky(w.blockAt, f);
            // from the surface, face the nearest target ore in sight: the staircase goes down towards it
            const seenOre = !surface ? null : w.ores(ore.blocks, SEEN_RANGE).filter(o => oreSafe(w.blockAt, f, o))
                .sort((a, b) => dist(a, f) - dist(b, f))[0] ?? null;
            const toward = seenOre && headingToward(f, seenOre);
            if (toward) this.heading = toward;
            this.plan = createPlan({ ...f, heading: this.heading }, ore, { ...this.planOpts, surface });
            this.logStep(mineLines.start(f, this.heading, seenOre));
            this.mineRec = { entrance: f, heading: this.heading, surface, ores: [this.c.ore], deepest: f.y, started: this.iso() };
            msg = `The ${this.c.ore} mine starts at ${f.x} ${f.y} ${f.z}, heading ${this.heading}.`;
        }
        this.reused = reused;
        this.saveMine(w);
        this.addMineCell(this.plan.entrance);
        this.c.note(msg);
        this.c.chat(msg);
        return null;
    }

    /** step: one iteration of the old loop (the first runs the setup first). */
    async step(signal: AbortSignal): Promise<MineStep> {
        if (this.ended) return { how: 'end', end: this.ended };
        const w = this.c.world();
        if (!w) return { how: 'end', end: { ok: false, reason: 'not in game', collected: 0, counters: this.counters, reused: false } };
        if (!ORES[this.c.ore]) {
            this.ended = { ok: false, reason: `unknown ore ${this.c.ore}; one of ${Object.keys(ORES).join(', ')}`, collected: 0, counters: this.counters, reused: false };
            return { how: 'end', end: this.ended };
        }
        if (!this.started) {
            this.started = true;
            const r = await this.setup(w, signal);
            if (r) return r;
            if (signal.aborted) return MORE;
        }
        if (this.n >= this.maxSteps) {
            if (this.got(w) >= this.want) return this.finish(w, true, 'done');
            return this.finish(w, false, `no ${this.info.drop} after ${this.maxSteps} steps`);
        }
        const r = await this.body(w, signal);
        if (r.how === 'more' && !signal.aborted) this.n++;
        return r;
    }

    private async body(w: MineWorld, signal: AbortSignal): Promise<MineStep> {
        const o = this.opts, ore = this.info, step = this.n, oreName = this.c.ore;
        if (this.got(w) >= this.want) return this.finish(w, true, 'done');
        this.record(w);
        if (step && step % 50 === 0) this.saveMine(w);
        const inv = w.inventory();
        const torches = inv.torch || 0;
        if (step >= this.noTorchUntil && torches < o.torch_low && (canMakeTorches(inv) || (!torches && this.dark >= 8))) {
            if (!await this.craft(w, 'torch', o.torch_batch, signal) || (w.inventory().torch || 0) <= torches) {
                if (signal.aborted) return MORE;
                this.noTorchUntil = step + o.torch_retry_steps;
            }
        }
        if (signal.aborted) return MORE;
        const feet = this.feet(w);
        const { x: bx, y: by, z: bz } = feet;
        if (this.plan && w.health() <= o.heal_health) {
            const stop = await this.heal(w, feet, o.heal_health, signal);
            return stop ?? MORE;
        }
        const view = readView(w.blockAt, bx, by, bz, ore.blocks);

        let pn = this.plan ? this.plan.next(feet) : null;
        if (pn && 'done' in pn && pn.done === 'the staircase is blocked') {
            // blocked (a lake, a cave): once, a new staircase heading back
            this.abandonStreak = o.max_abandons;
            const stuck = this.unsafeHere(w, { pos: feet, blocked: true });
            if (stuck) return stuck;
            pn = this.plan!.next(feet);
        }
        if (pn && 'done' in pn) return this.finish(w, false, `plan: ${pn.done}`);
        if (pn && !('walk' in pn)) this.offPlan = 0; // back on the plan
        // ore to collect: near the plan cell (v1: andy), safe, within budget; the mine dug so far counts too
        const anchor = pn && 'walk' in pn ? pn.walk : feet;
        const plan = this.plan;
        const near = pickOre(w.ores(ore.blocks, SEEN_RANGE), {
            feet, anchor, anchors: plan ? [anchor, ...this.mineCells] : null, blockAt: w.blockAt,
            range: plan ? o.collect_range : SEEN_RANGE, budget: plan ? o.collect_budget - this.offPlan : Infinity,
            below: plan ? o.collect_below : Infinity, belowOpen: plan ? Math.max(o.collect_below, o.collect_below_open) : Infinity,
            skip: q => this.failedOre.has(oreKey(q)),
        });
        const seen = near ? Math.max(1, Math.ceil(Math.hypot(near.x - bx, near.y - by, near.z - bz))) : 0;
        const inv2 = w.inventory();
        const s: MineSituation = { ore: oreName, y: by, pick: pickTier(inv2), torches: inv2.torch || 0, blocks: countOf(inv2, THROWAWAY),
            dark: this.dark, heading: this.heading, seen: seen <= SEEN_RANGE ? seen : 0, view };

        let homePos: Vec3Like | null = null;
        let planStep: ReturnType<MinePlan['next']> | null = pn;
        if (plan && pn) {
            if ('walk' in pn) {
                // off the plan: ore near it and touching fluid first, else walk back
                const first = decide(s);
                if (first.rule !== 'collect' && first.rule !== 'block-fluid') {
                    const ok = await this.walkTo(w, pn.walk, signal);
                    if (signal.aborted) return MORE;
                    this.logStep(mineLines.walk(pn.walk, pn.segment, feet, state(s), ok));
                    this.failures = ok ? 0 : this.failures + 1;
                    this.walkFails = ok ? 0 : this.walkFails + 1;
                    if (!ok) this.counters.failures++;
                    if (this.walkFails >= o.walk_restart) {
                        // can't get back (e.g. down a hole after ore): the mine starts again from here
                        const f = this.feet(w);
                        this.plan = createPlan({ ...f, heading: this.heading }, ore, { ...this.planOpts, surface: openSky(w.blockAt, f) });
                        this.walkFails = 0; this.failures = 0; this.offPlan = 0;
                        this.counters.restarts = (this.counters.restarts || 0) + 1;
                        this.logStep(mineLines.restart(f));
                        this.c.note(`Couldn't get back to the mine: starting it again from ${f.x} ${f.y} ${f.z}.`);
                        return MORE;
                    }
                    if (this.failures >= o.max_failures) return this.finish(w, false, `${this.failures} steps failed in a row`);
                    return MORE;
                }
                planStep = null;
            }
            homePos = w.home();
            Object.assign(s, { plan: planStep && 'step' in planStep ? planStep.step : null, free: w.freeSlots(), home: homeDistance(feet, homePos),
                health: Math.round(w.health()), food: w.food(), hostiles: Math.min(HOSTILES_CAP, w.hostiles()), valuables: valuables(inv2) });
        }

        // a move onto a drop (more than max_drop air under the cell, also under a one-block floor) is unsafe like "no floor"
        const isDrop = (a: string) => {
            const m = moveOf(a);
            if (!m) return false;
            const t = moveFeet(m, bx, by, bz);
            return dropBelow(w.blockAt, t.x, t.y, t.z) > o.max_drop;
        };
        const d = await decideMineStep({ s, hasPlan: !!plan, isDrop, client: o.model, unloadAllowed: !!s.plan && s.home != null && step >= this.noUnloadUntil });
        if (signal.aborted) return MORE;
        if (d.asked) this.counters.asked++;
        const entry: MineStepEntry = { rule: d.rule.action, pos: feet, state: d.state };
        if (d.said) Object.assign(entry, { model: d.said.model, p: d.said.p, hazard: d.said.hazard, ms: d.said.ms });
        if (d.veto) { bump(this.counters.vetoes, d.veto); entry.veto = d.veto; }

        // Unload: the model when it is sure, else the rule; always with a full pack; never with fluid touching
        if (d.unload) {
            entry.unload = d.unload.p;
            if (d.unload.later) entry.unload_later = 'collect-first';
            if (d.unload.go && homePos) {
                // a full chest after putting things in is a partial unload: no failure, but no Unload for a while
                const outcome = await this.goUnload(w, homePos, signal);
                if (!outcome) return MORE;
                const ok = outcome !== 'failed';
                // a failed unload backs off longer: mining and collecting go on
                if (outcome !== 'done') this.noUnloadUntil = step + (ok ? o.unload_retry_steps : o.unload_fail_steps);
                this.logStep(mineStepLine({ ...entry, action: 'unload', source: d.unload.source }, outcome));
                this.failures = ok ? 0 : this.failures + 1;
                if (!ok) this.counters.failures++;
                if (this.failures >= o.max_failures) return this.finish(w, false, `${this.failures} steps failed in a row`);
                return MORE;
            }
        }

        const action = d.action;
        if (d.source === 'model') this.counters.model++;
        else bump(this.counters.rules, d.why ?? 'none');
        Object.assign(entry, { action, source: d.source, why: d.why });
        if (d.dropped.length) entry.drops = d.dropped;

        // floor vetoes in a row on the staircase: the ground below is a cave or a drop
        this.floorVetoes = d.floorVeto ? this.floorVetoes + 1 : 0;
        const p = this.plan;
        // above the ore's band a level there is no use: the staircase shifts sideways and goes on down
        if (p && this.floorVetoes >= o.floor_vetoes && s.plan?.startsWith('down') && by > ore.hi && p.segment?.type === 'stair') {
            this.floorVetoes = 0;
            this.abandonStreak++;
            bump(this.counters.rules, 'shift-stair');
            p.abandon();
            this.logStep(mineStepLine({ ...entry, action: 'shift-stair' }, 'done'));
            return this.unsafeHere(w, entry) ?? MORE;
        }
        if (p && this.floorVetoes >= o.floor_vetoes && s.plan?.startsWith('down') && p.stopDescent(feet)) {
            this.floorVetoes = 0;
            this.abandonStreak++;
            bump(this.counters.rules, 'stop-descent');
            this.logStep(mineStepLine({ ...entry, action: 'stop-descent' }, 'done'));
            this.c.note(`The ground below is hollow: the ${oreName} mine's level starts here at Y ${by}.`);
            return this.unsafeHere(w, entry) ?? MORE;
        }

        let ok = false;
        const kind = kindOf(action);
        const m = moveOf(action);
        if (kind === 'collect' && near) { // collect is only chosen with ore in sight (the rules; the model's nothing-seen check)
            entry.ore = near;
            ok = await w.collect(near, ore.blocks, ore.drop, signal).catch(() => false);
            if (signal.aborted) return MORE;
            if (!ok) this.failedOre.add(oreKey(near));
            if (plan) {
                const f = this.feet(w);
                this.offPlan += Math.hypot(f.x - bx, f.y - by, f.z - bz);
            }
        } else if (m) {
            const detour = !!s.plan && action !== s.plan;
            const { dig, target, dir } = cellsToDig(d.view, m);
            ok = true;
            for (const c of dig) {
                const wc = worldCell(bx, by, bz, c);
                const dugIt = await w.dig(wc, signal);
                if (signal.aborted) return MORE;
                ok = dugIt && ok;
                // the first blocks dug mark the mine as andy's (mine memory)
                if (dugIt && plan && this.mineRec && (this.mineRec.dug ||= []).length < 3) {
                    this.mineRec.dug.push(wc);
                    // on disk at once: a restart (kill -9) before the 50-step save still finds the mine to go on with
                    if (this.mineRec.dug.length === 3) this.saveMine(w);
                }
            }
            if (ok) ok = await w.moveTo(worldCell(bx, by, bz, target), null, signal);
            if (signal.aborted) return MORE;
            if (ok) { this.heading = dir; this.dark++; if (plan) this.addMineCell(this.feet(w)); }
            if (detour && this.plan) {
                // a detour round an unsafe plan step: give up that segment; a staircase goes on from where it took andy
                entry.abandoned = this.plan.segment?.type;
                this.plan.abandon(ok ? this.feet(w) : null);
                this.counters.abandoned++;
                this.abandonStreak++;
            } else if (s.plan && action === s.plan && ok) this.abandonStreak = 0; // a planned step done
            const stuck = this.unsafeHere(w, entry);
            if (stuck) return stuck;
            if (!ok && pickTier(w.inventory()) < ore.tier) ok = await this.ensurePickaxe(w, signal); // the pickaxe broke
            if (signal.aborted) return MORE;
        } else if (kind === 'torch') {
            const spots: [number, number, number, PlaceOnWord][] = [];
            if (plan) {
                // on the left wall going out, at head height
                const wall = plan.torchWall();
                const [dx, dz] = OFFSET[wall];
                if (d.view[HEAD]![2 + dz]![2 + dx] === 'S') spots.push([0, 1, 0, FACE[wall]]);
            }
            const [dx, dz] = OFFSET[backOf(this.heading)];
            for (const [x, z] of [[dx, dz], ...Object.values(OFFSET)] as [number, number][]) if (d.view[FEET]![2 + z]![2 + x] === 'A') spots.push([x, 0, z, 'bottom']);
            for (const [x, y, z, on] of spots) {
                ok = await w.place('torch', { x: bx + x, y: by + y, z: bz + z }, on, signal);
                if (signal.aborted) return MORE;
                if (ok) break;
            }
            // placed: dark again from 0; failed: try again a few moves on, not at once in the same spot
            this.dark = ok ? 0 : Math.min(this.dark, TORCH_EVERY - o.torch_place_retry);
        } else if (kind === 'block') {
            const item = THROWAWAY.find(n => (w.inventory()[n] || 0) > 0);
            ok = !!item;
            for (const c of touching(d.view)) {
                if (!item) break;
                ok = await w.place(item, worldCell(bx, by, bz, c), 'bottom', signal) && ok;
                if (signal.aborted) return MORE;
            }
        } else if (kind === 'stop') {
            if (d.rule.rule === 'low-health') {
                // hurt going down: eat, retreat, wait (or stop and ask for food)
                this.logStep(mineStepLine(entry, 'heal'));
                const h = await this.heal(w, feet, Math.max(o.heal_health, LOW_HEALTH), signal);
                return h ?? MORE;
            }
            if (d.rule.rule === 'need-pickaxe' && await this.ensurePickaxe(w, signal)) ok = true;
            else {
                if (signal.aborted) return MORE;
                this.logStep(mineStepLine(entry, 'stopped'));
                return this.finish(w, false, d.rule.rule === 'trapped' ? 'trapped: every step is unsafe' : `needs a ${pickaxeFor(ore.tier)}`);
            }
        }
        bump(this.counters.steps, kind);
        this.logStep(mineStepLine(entry, ok ? 'done' : 'failed'));
        this.failures = ok ? 0 : this.failures + 1;
        if (!ok) this.counters.failures++;
        if (this.failures >= o.max_failures) return this.finish(w, false, `${this.failures} steps failed in a row`);
        return MORE;
    }
}

/** settingsOf: the mine settings from the deps (missing: the task is off). */
const settingsOf = (deps: JobDeps) => (): MineSettings => deps.mine?.() ?? { ...MINE_DEFAULTS, enabled: false, model: null };

/** The legacy fallback progress: the collect ran (it is never run twice). */
interface LegacyProgress { ran?: boolean }

/** mineRunner runs a mine job: the mine task's loop, or with the task off the old fallback (collect the nearest ore). */
export function mineRunner(job: JobOf<'mine'>, deps: JobDeps): JobStepper {
    const spec = job.spec;
    const p = job.progress as MineProgress & LegacyProgress;
    const settings = settingsOf(deps);
    if (!settings().enabled) return legacyMine(spec, p, deps);
    const home = homeFinder(deps);
    const run = new MineRun({
        ore: spec.ore, count: spec.count, progress: p, settings,
        world: () => { const a = deps.act(); return a ? mineWorld(a, deps, home) : null; },
        mines: deps.mines ?? null,
        log: line => deps.mineLog?.(line),
        note: text => deps.note(text),
        chat: text => deps.chat?.(text),
        checkpoint: () => deps.checkpoint?.(),
    });
    const drop = ORES[spec.ore].drop;
    return {
        async step(_f, signal): Promise<StepResult> {
            const r = await run.step(signal);
            if (r.how === 'more') return { how: 'more' };
            const e = r.end;
            if (e.ok) return { how: 'end', end: { how: 'done' }, say: `Mined ${(p.done ?? 0)} ${drop}.` };
            return { how: 'end', end: { how: 'failed', reason: e.reason }, say: jobFailedMessage(spec, e.reason) };
        },
        close: () => run.close(),
        left: () => (spec.count === 'forever' ? null : spec.count - (p.done ?? 0)),
    };
}

/** legacyMine: the task off: collect the nearest blocks of the ore (the old collectBlock(ore.blocks[0], count)). */
function legacyMine(spec: Extract<JobSpec, { kind: 'mine' }>, p: LegacyProgress, deps: JobDeps): JobStepper {
    return {
        async step(_f, signal): Promise<StepResult> {
            const a = deps.act();
            if (!a) return { how: 'end', end: { how: 'failed', reason: 'not in game' }, say: 'not in game' };
            if (p.ran) return { how: 'end', end: { how: 'cancelled' } };
            p.ran = true;
            deps.checkpoint?.();
            const { collectBlocks } = await import('../actuators/collect.js');
            const n = spec.count === 'forever' ? 64 : spec.count;
            const r = await collectBlocks(a, ORES[spec.ore].blocks[0]!, n, signal);
            if (r.cancelled || signal.aborted) return { how: 'more' };
            return r.collected > 0 ? { how: 'end', end: { how: 'done' }, say: r.message } : { how: 'end', end: { how: 'failed', reason: r.message }, say: r.message };
        },
    };
}
