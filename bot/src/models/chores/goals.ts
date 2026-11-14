// How much each chores answer runs for (skills-spec v1 §1 "Answers"): every amount in one place, none in the jobs.
// Pure: the situation, the answer and the rules' answer for the same situation.
//
//   hunt food     goal Food (Have) 32; Have food + 8 when Food < 8                   ("goal Food ≥ 32 (8 more when Food < 8)")
//   gather logs   Have wood 64 when stocking (stock-logs), else the step's need: table 4 (6 while there is no home
//                 chest: the chest's 2 in the same trip, v2.1), wood-tools 3, chest / beds / kit 2, the others 1 (the
//                 wood each step's rule waits for)      ("Have wood 64 when stocking, else the step's need")
//   gather seeds  16; wool 3 per missing bed; saplings: Have + those on the ground ("seeds 16; wool 3 per missing bed; saplings: those on the ground")
//   mine cobble   the step's need (stone: 6 for the tools + 8 for the furnace; kit: 9) or 64 when stocking, as more to mine
//   mine coal     8;  mine iron: until day at night, else 8                       ("coal: 8; iron: … until day at night, else 8")
//   craft         1 item; torch: up to 16 carried; a kit tool goes into the kit   ("goal 1 item (torch: up to 16 carried; a kit tool goes into the kit)")
//   farm          start and tend: FARM_MINUTES (the old tend_farm's 3 minutes)
//   ask, rest     REST_SECONDS near the centre (the old rest's 20 s)
//
// A model's answer the rules would give too takes the rules' goal (their step); another answer takes the stocking
// amounts (logs and cobble 64), since no step needed it.
import { HAVE_KINDS, TIERS, type ChoreMine, type Tier } from '../../types/chores.js';
import type { ChoresAnswer } from './answer.js';
import { have, type ChoresSituation } from './render.js';
import { kitTier, type ChoresRuled } from './rules.js';

export const HUNT_GOAL = 32;
export const HUNGRY = 8;
export const HUNGRY_MORE = 8;
export const STOCK = 64;
export const LOGS_FOR: Readonly<Record<string, number>> = { table: 4, 'wood-tools': 3, chest: 2, 'beds-craft': 2, 'kit-tools': 2 };
export const LOGS_OTHER = 1;
/** The table step's logs while there is no home chest: the table's 4 and the chest's 2 in one trip (v2.1). */
export const LOGS_TABLE_AND_CHEST = 6;
export const SEEDS_GOAL = 16;
export const WOOL_PER_BED = 3;
export const COBBLE_TOOLS = 6;
export const COBBLE_FURNACE = 8;
export const COBBLE_KIT = 9;
export const COAL_GOAL = 8;
export const IRON_GOAL = 8;
export const TORCHES_UP_TO = 16;
export const FARM_MINUTES = 3;
export const REST_SECONDS = 20;

/** What a chores run is for (the job's amounts; chores/map.ts turns it into a JobSpec). */
export type ChoresGoal =
    /** hunt and gather: the count to have (carried + the home chest less the kit), and what the chest holds of it. */
    | { kind: 'have'; goal: number; chest: number }
    /** mine: how many more of the drop, or until day. */
    | { kind: 'mine'; count: number | 'day' }
    /** craft: how many more; into the kit (a kit tool). */
    | { kind: 'craft'; count: number; kit: boolean }
    | { kind: 'minutes'; minutes: number }
    | { kind: 'seconds'; seconds: number }
    | { kind: 'once' };

const hasTier = (t: Tier, at: Tier) => TIERS.indexOf(t) >= TIERS.indexOf(at);
const sameAnswer = (a: ChoresAnswer, r: ChoresRuled) => r.words.Skill === a.skill && r.words.Target === a.target;

/** cobbleNeed: the cobble the stone step waits for (6 for stone tools, 8 for a furnace). */
function cobbleNeed(s: ChoresSituation): number {
    const tools = !hasTier(s.axe, 'stone') || !hasTier(s.pickaxe, 'stone');
    const furnace = !s.furnace && s.canPlace;
    return (tools ? COBBLE_TOOLS : 0) + (furnace ? COBBLE_FURNACE : 0);
}

/** isKitTool: a craft of the kit's tier's tool the kit lacks (the kit-tools step): it goes into the kit. */
function isKitTool(s: ChoresSituation, target: string): boolean {
    const k = kitTier(s);
    if (k === 'none' || !s.chest) return false;
    const kit: Record<string, Tier> = { pickaxe: s.kitPickaxe, axe: s.kitAxe, shovel: s.kitShovel, sword: s.kitSword };
    const m = /^(wooden|stone|iron)_(pickaxe|axe|shovel|sword)$/.exec(target);
    return !!m && m[1] === k && !hasTier(kit[m[2]!]!, k);
}

/** choresGoal: the amounts of the run for answer a (rules: the rules' answer for the same situation). */
export function choresGoal(s: ChoresSituation, a: ChoresAnswer, rules: ChoresRuled): ChoresGoal {
    const same = sameAnswer(a, rules);
    switch (a.skill) {
        case 'hunt': {
            const food = have(s, 'food');
            return { kind: 'have', goal: food < HUNGRY ? food + HUNGRY_MORE : HUNT_GOAL, chest: s.inChest.food };
        }
        case 'gather': switch (a.target) {
            case 'logs': {
                const step = rules.from === 'table' && !s.chest ? LOGS_TABLE_AND_CHEST : LOGS_FOR[rules.from ?? ''] ?? LOGS_OTHER;
                const goal = !same || rules.rule === 'stock-logs' ? STOCK : step;
                return { kind: 'have', goal, chest: s.inChest.wood };
            }
            case 'seeds': return { kind: 'have', goal: SEEDS_GOAL, chest: s.inChest.seeds };
            case 'wool': return { kind: 'have', goal: Math.max(1, WOOL_PER_BED * ((s.bedMine ? 0 : 1) + (s.bedPlayer ? 0 : 1))), chest: s.inChest.wool };
            case 'saplings': return { kind: 'have', goal: Math.max(1, have(s, 'saplings') + s.ground), chest: s.inChest.saplings };
        }
        // falls through never: the targets are all handled
        // eslint-disable-next-line no-fallthrough
        case 'mine': return { kind: 'mine', count: mineCount(s, a.target, same ? rules.rule : null) };
        case 'craft': {
            const count = a.target === 'torch' ? Math.max(1, TORCHES_UP_TO - s.carry.torches) : 1;
            return { kind: 'craft', count, kit: isKitTool(s, a.target) };
        }
        case 'farm': return { kind: 'minutes', minutes: FARM_MINUTES };
        case 'ask': case 'rest': return { kind: 'seconds', seconds: REST_SECONDS };
        case 'place': case 'cook': case 'store': case 'sleep': return { kind: 'once' };
    }
}

function mineCount(s: ChoresSituation, t: ChoreMine, rule: string | null): number | 'day' {
    switch (t) {
        case 'coal': return COAL_GOAL;
        case 'iron': return s.time === 'night' ? 'day' : IRON_GOAL;
        case 'cobble': {
            const goal = rule === 'stone-cobble' ? cobbleNeed(s) : rule === 'kit-cobble' ? COBBLE_KIT : STOCK;
            return Math.max(1, goal - have(s, 'cobble'));
        }
    }
}

/** The kinds a goal counts, for the log. */
export const GOAL_KINDS = HAVE_KINDS;
