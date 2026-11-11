// The stuck fact (design §5.3 `unstuck`): a progress watch, a port of the old `unstuck` mode's test
// without its action. It counts only while Motion has a goTo in flight, so eating, healing and
// standing still on purpose never read as stuck (fix round 4's pause, for free). Stuck when the bot
// moved less than STUCK_DIST for more than STUCK_S (twice that while digging obsidian; a changed dig
// target resets). It never acts: the running actuator replans (3.4+/5.x).
import type { Vec3Like } from '../types/index.js';

export const STUCK_DIST = 2;
export const STUCK_S = 20;
export const OBSIDIAN_FACTOR = 2;

export interface DigTarget { name: string; x: number; y: number; z: number }
const sameDig = (a: DigTarget | null, b: DigTarget | null): boolean =>
    a === b || (!!a && !!b && a.name === b.name && a.x === b.x && a.y === b.y && a.z === b.z);

export class StuckWatch {
    private prev: Vec3Like | null = null;
    private prevDig: DigTarget | null = null;
    private stuckS = 0;
    private last: number | null = null;
    constructor(private readonly dist = STUCK_DIST, private readonly maxS = STUCK_S) {}

    /** feed one sample; returns whether the bot is stuck now. */
    feed(pos: Vec3Like, moving: boolean, dig: DigTarget | null, now: number): boolean {
        const dt = this.last === null ? 0 : (now - this.last) / 1000;
        this.last = now;
        if (!moving) { this.reset(); return false; }
        if (dig && !this.prevDig) this.prevDig = dig;
        if (this.prev && Math.hypot(pos.x - this.prev.x, pos.y - this.prev.y, pos.z - this.prev.z) < this.dist && sameDig(dig, this.prevDig)) {
            this.stuckS += dt;
        } else {
            this.prev = { x: pos.x, y: pos.y, z: pos.z };
            this.stuckS = 0;
            this.prevDig = null;
        }
        const max = dig?.name === 'obsidian' ? this.maxS * OBSIDIAN_FACTOR : this.maxS;
        return this.stuckS > max;
    }

    reset(): void { this.prev = null; this.prevDig = null; this.stuckS = 0; }
    get seconds(): number { return this.stuckS; }
}
