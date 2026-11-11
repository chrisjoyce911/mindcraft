// The chores v2 state (laya-go games/chores/v2 State, prompt v2; skills-spec v1 §1), byte for byte:
//
//   Chores.
//   Time day Home chest Biome forest
//   Base table yes furnace no chest yes lit no beds mine no player no
//   Farm yes ready no
//   Tools axe stone pickaxe wooden sword none hoe none shovel none shears no
//   Carry wood 3 sticks 2 cobble 12 coal 0 iron 0 torches 0 food 4 raw 2 wool 0 seeds 0 saplings 1 free 20
//   Chest wood 40 sticks 0 cobble 60 coal 12 iron 0 torches 0 food 6 raw 0 wool 0 seeds 8 saplings 0
//   Made table 0 furnace 0 chest 0 bed 0
//   Kit pickaxe stone axe stone shovel none sword stone food 3 torches 16
//   Near trees 49 stone 49 coal 97 iron none grass 49 water 49
//   Animals cow 49 pig none sheep 97 chicken none rabbit none
//   Ground saplings 2
//   Can place yes smelt yes
//   Last craft stone_sword failed:missing_sticks 1 hunt food done 3
//
// Values outside the spec are refused (an Error, as v2.go valid()): the sensors clamp, the renderer doesn't.
import {
    BIOMES, CHORES_MAX, CHORE_ANIMALS, HAVE_KINDS, HOMES, TIERS, TIMES, isChorePair, isChoreReason,
    type BiomeWord, type ChoreSearch, type Counts, type Home, type LastRun, type Tier, type TimeWord,
} from '../../types/chores.js';

export const VERSION = 'v2';

/** Everything chores v2 sees (v2.go Situation). */
export interface ChoresSituation {
    time: TimeWord; home: Home; biome: BiomeWord;
    table: boolean; furnace: boolean; chest: boolean; lit: boolean; bedMine: boolean; bedPlayer: boolean;
    farm: boolean; ready: boolean;
    axe: Tier; pickaxe: Tier; sword: Tier; hoe: Tier; shovel: Tier; shears: boolean;
    carry: Counts; inChest: Counts; free: number;
    /** Stations carried, waiting to be placed: table, furnace, chest, bed. */
    made: { table: number; furnace: number; chest: number; bed: number };
    kitPickaxe: Tier; kitAxe: Tier; kitShovel: Tier; kitSword: Tier; kitFood: number; kitTorches: number;
    trees: ChoreSearch; stone: ChoreSearch; coal: ChoreSearch; iron: ChoreSearch; grass: ChoreSearch; water: ChoreSearch;
    animals: { cow: ChoreSearch; pig: ChoreSearch; sheep: ChoreSearch; chicken: ChoreSearch; rabbit: ChoreSearch };
    ground: number;
    canPlace: boolean; canSmelt: boolean;
    /** Latest first. */
    last: LastRun[];
}

const yn = (b: boolean) => (b ? 'yes' : 'no');
const near = (n: number) => (n === 0 ? 'none' : String(n));
const counts = (c: Counts) => HAVE_KINDS.map(k => `${k} ${c[k]}`).join(' ');
const inRange = (n: number, lo: number, hi: number) => Number.isInteger(n) && n >= lo && n <= hi;
const isSearch = (n: number) => n === 0 || n === 49 || n === 97 || n === 193;

/** choresInvalid: why the situation is outside the spec (v2.go valid), or null. */
export function choresInvalid(s: ChoresSituation): string | null {
    const tiers = [s.axe, s.pickaxe, s.sword, s.hoe, s.shovel, s.kitPickaxe, s.kitAxe, s.kitShovel, s.kitSword];
    const zero = HAVE_KINDS.every(k => s.inChest[k] === 0);
    const made = [s.made.table, s.made.furnace, s.made.chest, s.made.bed];
    const searches = [s.trees, s.stone, s.coal, s.iron, s.grass, s.water, ...CHORE_ANIMALS.map(k => s.animals[k])];
    if (!(TIMES as readonly string[]).includes(s.time) || !(HOMES as readonly string[]).includes(s.home) || !(BIOMES as readonly string[]).includes(s.biome)) return 'time, home or biome';
    if (tiers.some(t => !(TIERS as readonly string[]).includes(t))) return 'tiers';
    if (HAVE_KINDS.some(k => !inRange(s.carry[k], 0, CHORES_MAX.count) || !inRange(s.inChest[k], 0, CHORES_MAX.count))) return 'counts';
    if (s.carry.raw > s.carry.food || s.inChest.raw > s.inChest.food) return 'raw above food';
    if (!s.chest && !zero) return 'chest counts with no chest';
    if (!inRange(s.free, 0, CHORES_MAX.free) || (s.ready && !s.farm)) return 'free or ready';
    if (made.some(n => !inRange(n, 0, CHORES_MAX.made))) return 'made';
    if (!inRange(s.kitFood, 0, CHORES_MAX.kit) || !inRange(s.kitTorches, 0, CHORES_MAX.kit)) return 'kit';
    if (searches.some(n => !isSearch(n))) return 'searches';
    if (!inRange(s.ground, 0, CHORES_MAX.ground) || s.last.length > CHORES_MAX.last) return 'ground or last';
    for (const [i, r] of s.last.entries()) {
        if (!isChorePair(r.skill, r.target) || !inRange(r.age, 0, CHORES_MAX.age) || r.done !== (r.reason === undefined)
            || (!r.done && !isChoreReason(r.reason ?? '')) || (i > 0 && r.age < s.last[i - 1]!.age)) return 'last';
        if (s.last.slice(0, i).some(o => o.skill === r.skill && o.target === r.target)) return 'last repeats';
    }
    return null;
}

/** choresState: the state text; throws on a situation outside the spec. */
export function choresState(s: ChoresSituation): string {
    const bad = choresInvalid(s);
    if (bad) throw new Error(`bad chores v2 state: ${bad}`);
    const last = s.last.map(r => `${r.skill} ${r.target} ${r.done ? 'done' : `failed:${r.reason}`} ${r.age}`);
    const a = s.animals;
    return [
        'Chores.',
        `Time ${s.time} Home ${s.home} Biome ${s.biome}`,
        `Base table ${yn(s.table)} furnace ${yn(s.furnace)} chest ${yn(s.chest)} lit ${yn(s.lit)} beds mine ${yn(s.bedMine)} player ${yn(s.bedPlayer)}`,
        `Farm ${yn(s.farm)} ready ${yn(s.ready)}`,
        `Tools axe ${s.axe} pickaxe ${s.pickaxe} sword ${s.sword} hoe ${s.hoe} shovel ${s.shovel} shears ${yn(s.shears)}`,
        `Carry ${counts(s.carry)} free ${s.free}`,
        `Chest ${counts(s.inChest)}`,
        `Made table ${s.made.table} furnace ${s.made.furnace} chest ${s.made.chest} bed ${s.made.bed}`,
        `Kit pickaxe ${s.kitPickaxe} axe ${s.kitAxe} shovel ${s.kitShovel} sword ${s.kitSword} food ${s.kitFood} torches ${s.kitTorches}`,
        `Near trees ${near(s.trees)} stone ${near(s.stone)} coal ${near(s.coal)} iron ${near(s.iron)} grass ${near(s.grass)} water ${near(s.water)}`,
        `Animals cow ${near(a.cow)} pig ${near(a.pig)} sheep ${near(a.sheep)} chicken ${near(a.chicken)} rabbit ${near(a.rabbit)}`,
        `Ground saplings ${s.ground}`,
        `Can place ${yn(s.canPlace)} smelt ${yn(s.canSmelt)}`,
        `Last ${last.length ? last.join(' ') : 'none'}`,
    ].join('\n');
}

/** have: what he has of a kind, carried plus the home chest (v2.go H). */
export const have = (s: ChoresSituation, k: keyof Counts): number => s.carry[k] + s.inChest[k];
