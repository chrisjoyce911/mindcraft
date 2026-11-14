// The mine rules (a typed port of the old mine_state.js decide/followPlan/unload; laya-go games/mine/rules v2.1):
// the best step and its rule, the fallback when the model isn't sure or is vetoed; and the v2 Unload truth. Pure.
import { COLLECT_RANGE, DIRS, LOW_HEALTH, MIN_Y, MOVE_KINDS, ORES, TORCH_EVERY, HOME_CAP, type Dir, type MoveKind } from './data.js';
import { moveOf, type MineAction, type MoveAction } from './questions.js';
import type { MineSituation } from './render.js';
import { touching, unsafe } from './view.js';
import type { Vec3Like } from '../../types/index.js';

export const MINE_RULES = ['need-pickaxe', 'block-fluid', 'collect', 'torch', 'low-health', 'go-down', 'go-up', 'branch-mine',
    'follow-plan', 'detour', 'trapped'] as const;
export type MineRule = (typeof MINE_RULES)[number];
export interface MineDecision { action: MineAction; rule: MineRule }

const turn = (d: Dir, n: number): Dir => DIRS[(DIRS.indexOf(d) + n) % 4]!;
export const rightOf = (d: Dir): Dir => turn(d, 1);
export const leftOf = (d: Dir): Dir => turn(d, 3);
export const backOf = (d: Dir): Dir => turn(d, 2);

const isDown = (a: MineAction) => a.startsWith('down');

/** decide is laya-go's rules.Decide: the best step and its rule. With a plan step (v2) rule 5 follows the plan. */
export function decide(s: MineSituation): MineDecision {
    const ore = ORES[s.ore];
    if (!ore || s.pick < ore.tier) return { action: 'stop', rule: 'need-pickaxe' };
    if (touching(s.view).length && s.blocks > 0) return { action: 'block', rule: 'block-fluid' };
    if (s.seen > 0 && !(s.plan && s.seen > COLLECT_RANGE)) return { action: 'collect', rule: 'collect' };
    if (s.dark >= TORCH_EVERY && s.torches > 0) return { action: 'torch', rule: 'torch' };
    if (s.plan) {
        const d = followPlan(s, s.plan);
        if (isDown(d.action) && s.health !== undefined && s.health > 0 && s.health <= LOW_HEALTH) return { action: 'stop', rule: 'low-health' };
        return d;
    }
    let want: MoveKind = 'tunnel', rule: MineRule = 'branch-mine', order: MoveKind[] = ['tunnel', 'down', 'up'];
    if (s.y > ore.hi) [want, rule, order] = ['down', 'go-down', ['down', 'tunnel', 'up']];
    else if (s.y < ore.lo) [want, rule, order] = ['up', 'go-up', ['up', 'tunnel', 'down']];
    const h = DIRS.indexOf(s.heading);
    const pref = [h, (h + 1) % 4, (h + 3) % 4, (h + 2) % 4].map(i => DIRS[i]!);
    for (const k of order) {
        if (k === 'down' && s.y - 1 < MIN_Y) continue;
        for (const d of pref) {
            if (unsafe(s.view, { kind: k, dir: d }) === '') return { action: `${k} ${d}`, rule: k === want ? rule : 'detour' };
        }
    }
    return { action: 'stop', rule: 'trapped' };
}

/**
 * followPlan is laya-go's v2 rule 5: the plan step when it is safe; else the plan's kind to the right, left and back
 * of the plan's direction, then the other kinds ahead, right, left and back; never down below MIN_Y.
 */
function followPlan(s: MineSituation, plan: MoveAction): MineDecision {
    const p = moveOf(plan)!;
    const ok = (a: MoveAction) => !(isDown(a) && s.y - 1 < MIN_Y) && unsafe(s.view, moveOf(a)) === '';
    if (ok(plan)) return { action: plan, rule: 'follow-plan' };
    const around = [rightOf(p.dir), leftOf(p.dir), backOf(p.dir)];
    const tries: MoveAction[] = [...around.map(d => `${p.kind} ${d}` as const),
        ...MOVE_KINDS.filter(k => k !== p.kind).flatMap(k => [p.dir, ...around].map(d => `${k} ${d}` as const))];
    for (const a of tries) if (ok(a)) return { action: a, rule: 'detour' };
    return { action: 'stop', rule: 'trapped' };
}

/**
 * unload is laya-go's v2 Unload truth: a home chest is known and no lava or water touches andy, and the pack is
 * full, or nearly full with home close, or it carries valuables while in danger (hurt, hungry or mobs).
 */
export function unload(s: MineSituation): boolean {
    if (s.home == null || touching(s.view).length) return false;
    const free = s.free ?? 36;
    if (free <= 2) return true;
    if (free <= 6 && s.home <= 24) return true;
    return (s.valuables ?? 0) >= 4 && ((s.health ?? 20) <= 8 || (s.hostiles ?? 0) >= 2 || (s.food ?? 20) <= 6);
}

/** homeDistance: the straight-line distance to the home chest as prompt v2 writes it (rounded up, capped), or null. */
export function homeDistance(from: Vec3Like, home: Vec3Like | null | undefined): number | null {
    if (!home) return null;
    return Math.min(HOME_CAP, Math.max(1, Math.ceil(Math.hypot(home.x - from.x, home.y - from.y, home.z - from.z))));
}

/** headingOf turns a mineflayer yaw (0 faces north, increasing anticlockwise) into a compass letter. */
export function headingOf(yaw: number): Dir {
    const turns = ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;
    return (['N', 'W', 'S', 'E'] as const)[turns]!;
}
