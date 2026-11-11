// The director's state text: shared director spec v1.3 (laya-go games/director/prompt), with the v1 and
// v1.2 texts for a served model on an older prompt. A port of the old bot's src/agent/laya/director.js
// (directorState, playerLine, meLine, mobKind, itemWord); test/fixtures/laya-director-v1|v12|v13 pin it.
//
//   Director.
//   Job mine iron_ore left 6
//   Paused none
//   Health 14 Food 12 Armed sword Armor 8
//   Hostiles 2 Nearest zombie 6
//   Me attacked yes by zombie 6                      (v1.3)
//   Player chrisjoyce911 attacked yes by zombie 12   (v1.2, v1.3)
//   Light 4 Night no Under yes
//   Pack 5 Home 18 Valuables 3
//   Food items 4
//   Danger none
//   Last none

import type { Armed, Danger, MobKind } from '../../types/facts.js';
import { ORES, type Ore } from '../../types/jobs.js';
import type { DirectorPrompt } from '../../types/decisions.js';

/** The Job and Paused lines' kinds (laya-go director JobKinds). */
export const JOB_KINDS = ['follow', 'come', 'stay', 'mine', 'farm', 'craft', 'gather', 'give', 'attack', 'store', 'home'] as const;
export type DirectorJobKind = (typeof JOB_KINDS)[number];
/** How the last job ended (the Last line). */
export const LASTS = ['none', 'done', 'failed', 'interrupted', 'blocked'] as const;
export type Last = (typeof LASTS)[number];
export const DANGERS = ['none', 'fluid', 'fall', 'drowning', 'fire'] as const satisfies readonly Danger[];
/** The mob kinds the Nearest, Me and Player lines name; anything else is `other`. */
export const NEAREST_KINDS = ['zombie', 'skeleton', 'creeper', 'spider'] as const;

export const PLAYER_REACH = 24; // the Player line's reach (v1.2)
export const RANGED_REACH = 16; // flee-ranged's reach (v1.2)

/** A job as the Job line shows it: its kind, item word and how many are left ('any': no count). */
export interface JobView { kind: DirectorJobKind; item: string; left: number | 'any' }

/**
 * What the director decides from. Mob names are raw entity names (`stray`, `witch`, ...): the renderer
 * and the rules map them with mobKind.
 */
export interface DirectorSituation {
    job: JobView | null;
    paused: DirectorJobKind | null;
    health: number;
    food: number;
    armed: Armed;
    /** The armour bar, 0–20. */
    armor: number;
    hostiles: number;
    nearest: { kind: string; dist: number } | null;
    light: number;
    night: boolean;
    under: boolean;
    /** Free inventory slots. */
    free: number;
    /** Distance to the home chest, or null when there is none. */
    home: number | null;
    valuables: number;
    foodItems: number;
    danger: Danger;
    last: Last;
    /** v1.2: the nearest player within 24 a mob hit in the last 5 s, else the nearest within 24. */
    player?: { name: string; attacked: boolean; by: string; dist: number } | null;
    /** v1.3: the mob that damaged the bot in the last 5 s, still alive. */
    me?: { attacked: boolean; by: string; dist: number } | null;
}

const NONE = 'none';

/** mobKind is a mob's name as the state's Nearest/By kinds name it (strays and bogged are skeletons, v1.2), else other. */
export function mobKind(name: string | null | undefined): MobKind {
    if (name === 'stray' || name === 'bogged') return 'skeleton';
    return (NEAREST_KINDS as readonly string[]).includes(name ?? '') ? (name as MobKind) : 'other';
}

/** cap rounds n and clamps it to 0…c (laya-go's caps). */
export const cap = (n: number, c: number): number => Math.max(0, Math.min(c, Math.round(n)));
const word = (v: string | null | undefined): string => (v == null || v === '' ? NONE : String(v).replace(/\s+/g, '_'));
// laya-go's caps: MaxLeft 999, MaxValuables 99, MaxFood (food items) 99
const leftWord = (l: number | 'any'): string => (l === 'any' ? 'any' : String(cap(l, 999)));

/** itemWord is a job's item as laya-go's director names it: a mine job's ore block (iron → iron_ore), `any` → none. */
export function itemWord(kind: string, item: string | null | undefined): string {
    if (item == null || item === '' || item === 'any') return NONE;
    if (kind === 'mine' && (ORES as readonly string[]).includes(item)) return `${item as Ore}_ore`;
    return String(item).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
}

const isJobKind = (k: unknown): k is DirectorJobKind => (JOB_KINDS as readonly unknown[]).includes(k);

/** directorState writes the situation as the spec's state text for a prompt version (v1.3 by default). */
export function directorState(s: DirectorSituation, prompt: DirectorPrompt = 'v1.3'): string {
    const j = s.job;
    const kind = j && isJobKind(j.kind) ? j.kind : null;
    const near = s.nearest && s.hostiles > 0 ? `${mobKind(s.nearest.kind)} ${cap(s.nearest.dist, 16)}` : 'none none';
    return ['Director.',
        `Job ${kind ?? NONE} ${kind && j ? word(j.item) : NONE} left ${kind && j ? leftWord(j.left) : 0}`,
        `Paused ${isJobKind(s.paused) ? s.paused : NONE}`,
        `Health ${cap(s.health, 20)} Food ${cap(s.food, 20)} Armed ${s.armed || NONE} Armor ${cap(s.armor || 0, 20)}`,
        `Hostiles ${cap(s.hostiles, 9)} Nearest ${near}`,
        ...(prompt === 'v1' || prompt === 'v1.2' ? [] : [meLine(s.me)]),
        ...(prompt === 'v1' ? [] : [playerLine(s.player)]),
        `Light ${cap(s.light, 15)} Night ${s.night ? 'yes' : 'no'} Under ${s.under ? 'yes' : 'no'}`,
        `Pack ${cap(s.free, 36)} Home ${s.home == null ? NONE : cap(s.home, 99)} Valuables ${cap(s.valuables || 0, 99)}`,
        `Food items ${cap(s.foodItems || 0, 99)}`,
        `Danger ${(DANGERS as readonly string[]).includes(s.danger) ? s.danger : NONE}`,
        `Last ${(LASTS as readonly string[]).includes(s.last) ? s.last : NONE}`,
    ].join('\n');
}

/** playerLine is the v1.2 Player line: "Player <name> attacked <yes|no> by <kind|none> <dist>", or none. */
export function playerLine(p: DirectorSituation['player']): string {
    if (!p || !p.name || !(p.dist <= PLAYER_REACH)) return 'Player none attacked no by none none';
    const name = String(p.name).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    return `Player ${name} attacked ${p.attacked ? 'yes' : 'no'} by ${p.attacked ? mobKind(p.by) : NONE} ${cap(p.dist, PLAYER_REACH)}`;
}

/** meLine is the v1.3 Me line: "Me attacked yes by <kind> <dist>" (dist capped at 16), or "Me attacked no by none none". */
export function meLine(m: DirectorSituation['me']): string {
    if (!m?.attacked) return 'Me attacked no by none none';
    return `Me attacked yes by ${mobKind(m.by)} ${cap(m.dist, 16)}`;
}
