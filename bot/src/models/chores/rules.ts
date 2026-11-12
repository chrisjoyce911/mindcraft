// Chores rules v2.1 and Harmful (laya-go games/chores/v2 Decide, Harmful; skills-spec v1 §1 "Rules v2"), a straight
// port. v2.1 (2026-11-12, user: chest first, no unarmoured night mining): the chest step comes right after food-low
// and never starts a log trip at dusk; night mining needs a sword or armour. The rest is chores v1.1's priority order with every step explicit, the first that applies decides. ok(k, t): the pair
// has no failed Last entry younger than 5 minutes and its actuator is present (place: Can place, cook: Can smelt). A
// need found on the way (the first noted wins) is answered as ask <item> when nothing else applies.
import type { Words } from '../skill/index.js';
import { CHORES_COOLDOWN, CHORE_ANIMALS, TIERS, isChorePair, type Tier } from '../../types/chores.js';
import { have, type ChoresSituation } from './render.js';

export const CHORES_RULES = ['unload', 'night-sleep', 'night-mine', 'night-rest', 'food-low-farm', 'food-low-hunt', 'chest', 'light-low', 'light-low-place',
    'saplings-gather', 'saplings-place', 'farm-ready', 'table', 'wood-tools', 'farm-seeds', 'farm-hoe', 'farm-start', 'stone-cobble',
    'stone-tools', 'furnace', 'food-hunt', 'food-cook', 'light', 'light-place', 'beds-place', 'beds-craft', 'beds-wool',
    'kit-tools', 'kit-cobble', 'kit-store', 'kit-torches', 'stock-logs', 'stock-cobble', 'sword', 'logs', 'torch-mine-coal',
    'ask-logs', 'ask-cobble', 'ask-coal', 'ask-wool', 'ask-food', 'rest'] as const;
export type ChoresRule = (typeof CHORES_RULES)[number];

/** The skills (and mine targets) that go out on the surface: never at night. */
export const OUTDOOR = ['hunt', 'gather', 'farm'] as const;

const tier = (t: Tier) => TIERS.indexOf(t);
const hasTier = (t: Tier, at: Tier) => tier(t) >= tier(at);

/** armed: a sword (wooden or better) or any armour piece worn: the only way he may mine at night (v2.go Armed). */
export const armed = (s: ChoresSituation): boolean => hasTier(s.sword, 'wooden') || s.armor;

/** ok: (k, t) may run: not failed in the last 5 minutes, and its actuator present (v2.go ok). */
export function choreOk(s: ChoresSituation, k: string, t: string): boolean {
    if (s.last.some(r => r.skill === k && r.target === t && !r.done && r.age < CHORES_COOLDOWN)) return false;
    if ((k === 'place' && !s.canPlace) || (k === 'cook' && !s.canSmelt)) return false;
    return true;
}

/** animalsWithin: an adult of any kind within search d. */
const animalsWithin = (s: ChoresSituation, d: number) => CHORE_ANIMALS.some(k => s.animals[k] !== 0 && s.animals[k] <= d);

/** kitTier: the kit's tier: his pickaxe's, diamond as iron, iron only when he can smelt (v2.go KitTier). */
export function kitTier(s: ChoresSituation): Tier {
    let t = s.pickaxe;
    if (t === 'diamond') t = 'iron';
    if (t === 'iron' && !s.canSmelt) t = 'stone';
    return t;
}

/** choresRules: rules v2.1, the words and the rule that decided (v2.go Decide). */
/**
 * What the rules answer: the words, the rule that decided (v2.go's rule names), and for gather logs the step that
 * needed the logs (from: table, wood-tools, …; the goal's amount, goals.ts). from is not part of the spec's answer.
 */
export interface ChoresRuled { words: Words; rule: ChoresRule; from?: ChoresRule }

export function choresRules(s: ChoresSituation): ChoresRuled {
    let d: ChoresRuled | null = null;
    const tryRun = (k: string, t: string, rule: ChoresRule, when: boolean, from?: ChoresRule): boolean => {
        if (when && choreOk(s, k, t)) { d = { words: { Skill: k, Target: t }, rule, ...(from ? { from } : {}) }; return true; }
        return false;
    };
    let need = '';
    const note = (item: string, when: boolean) => { if (when && need === '') need = item; };
    const trees = s.trees !== 0;
    const pick = hasTier(s.pickaxe, 'wooden');
    const stone = s.stone !== 0 && pick;
    const wood = have(s, 'wood'), sticks = have(s, 'sticks'), cobble = have(s, 'cobble');
    const logs = (from: ChoresRule): boolean => {
        note('logs', !trees);
        return tryRun('gather', 'logs', 'logs', trees, from);
    };
    // the torch step: craft torches, else mine coal, else note
    const torch = (rule: ChoresRule): boolean => {
        const fuel = have(s, 'coal') >= 1 || (s.furnace && s.canSmelt && wood >= 2);
        if (fuel && (sticks >= 1 || wood >= 1)) return tryRun('craft', 'torch', rule, true);
        if (!fuel && s.coal !== 0 && pick) return tryRun('mine', 'coal', 'torch-mine-coal', true);
        if (!fuel) note('coal', choreOk(s, 'craft', 'torch'));
        else note('logs', choreOk(s, 'craft', 'torch'));
        return false;
    };
    // place x when one is carried, else craft it when `when`, else logs
    const station = (x: string, made: number, when: boolean, rule: ChoresRule): boolean => {
        if (made >= 1) return tryRun('place', x, rule, true);
        if (when) return tryRun('craft', x, rule, true);
        return logs(rule);
    };
    const done = () => d!;

    if (tryRun('store', 'unload', 'unload', s.free <= 3 && s.chest)) return done();
    if (s.time === 'night') {
        const arm = armed(s);
        if (tryRun('sleep', 'none', 'night-sleep', s.bedMine) || tryRun('mine', 'iron', 'night-mine', arm && hasTier(s.pickaxe, 'stone'))
            || tryRun('mine', 'coal', 'night-mine', arm && pick && !hasTier(s.pickaxe, 'stone'))) return done();
        return { words: { Skill: 'rest', Target: 'none' }, rule: 'night-rest' };
    }
    const food = have(s, 'food'), raw = have(s, 'raw'), torches = have(s, 'torches');
    if (food < 8 && hasTier(s.axe, 'wooden')) {
        if (tryRun('farm', 'tend', 'food-low-farm', s.farm && s.ready) || tryRun('hunt', 'food', 'food-low-hunt', animalsWithin(s, 193))) return done();
        note('food', choreOk(s, 'hunt', 'food') && !animalsWithin(s, 193));
    }
    // the home chest before lighting the base; its log trip never starts at dusk
    if (s.table && !s.chest && s.canPlace) {
        if (s.made.chest >= 1) {
            if (tryRun('place', 'chest', 'chest', true)) return done();
        } else if (wood >= 2) {
            if (tryRun('craft', 'chest', 'chest', true)) return done();
        } else if (s.time !== 'dusk') {
            if (logs('chest')) return done();
        }
    }
    const unlitDusk = !s.lit && s.time === 'dusk';
    if (pick && (torches < 8 || unlitDusk)) {
        if ((torches < 8 && torch('light-low')) || tryRun('place', 'torch', 'light-low-place', unlitDusk && torches >= 8)) return done();
    }
    if (tryRun('gather', 'saplings', 'saplings-gather', s.ground > 0) || tryRun('place', 'saplings', 'saplings-place', have(s, 'saplings') >= 1)) return done();
    if (tryRun('farm', 'tend', 'farm-ready', s.farm && s.ready)) return done();
    if (!s.table && s.canPlace) {
        if (station('crafting_table', s.made.table, wood >= 4, 'table')) return done();
    }
    if (!hasTier(s.axe, 'wooden') || !pick) {
        const t = hasTier(s.axe, 'wooden') ? 'wooden_pickaxe' : 'wooden_axe';
        if (tryRun('craft', t, 'wood-tools', wood >= 3) || (wood < 3 && logs('wood-tools'))) return done();
    }
    if (!s.farm && s.water === 49) {
        if (tryRun('gather', 'seeds', 'farm-seeds', have(s, 'seeds') < 16 && s.grass !== 0)) return done();
        if (have(s, 'seeds') >= 1) {
            if (s.hoe === 'none') {
                if (tryRun('craft', 'wooden_hoe', 'farm-hoe', wood >= 1) || (wood < 1 && logs('farm-hoe'))) return done();
            } else if (tryRun('farm', 'start', 'farm-start', true)) return done();
        }
    }
    const tools = !hasTier(s.axe, 'stone') || !hasTier(s.pickaxe, 'stone');
    const furnace = !s.furnace && s.canPlace;
    if (tools || furnace) {
        const needCobble = (tools ? 6 : 0) + (furnace ? 8 : 0);
        if (cobble < needCobble) {
            if (tryRun('mine', 'cobble', 'stone-cobble', stone)) return done();
            note('cobble', pick && s.stone === 0 && choreOk(s, 'mine', 'cobble'));
        } else if (tools) {
            const t = hasTier(s.axe, 'stone') ? 'stone_pickaxe' : 'stone_axe';
            const ok = wood >= 1 || sticks >= 2;
            if (tryRun('craft', t, 'stone-tools', ok) || (!ok && logs('stone-tools'))) return done();
        } else if (station('furnace', s.made.furnace, cobble >= 8, 'furnace')) return done();
    }
    if (tryRun('hunt', 'food', 'food-hunt', food < 32 && animalsWithin(s, 97)) || tryRun('cook', 'none', 'food-cook', raw >= 1 && s.furnace)) return done();
    if ((torches < 16 && torch('light')) || tryRun('place', 'torch', 'light-place', !s.lit && torches >= 8)) return done();
    if ((!s.bedMine || !s.bedPlayer) && s.canPlace) {
        const needWool = (s.bedMine ? 0 : 3) + (s.bedPlayer ? 0 : 3);
        if (s.made.bed >= 1) {
            if (tryRun('place', 'bed', 'beds-place', true)) return done();
        } else if (have(s, 'wool') >= needWool) {
            if (tryRun('craft', 'bed', 'beds-craft', wood >= 2) || (wood < 2 && logs('beds-craft'))) return done();
        } else {
            if (tryRun('gather', 'wool', 'beds-wool', s.animals.sheep !== 0)) return done();
            note('wool', choreOk(s, 'gather', 'wool'));
        }
    }
    if (s.chest) {
        const k = kitTier(s);
        if (k !== 'none') {
            const kit: [string, Tier][] = [['pickaxe', s.kitPickaxe], ['axe', s.kitAxe], ['shovel', s.kitShovel], ['sword', s.kitSword]];
            for (const [tool, got] of kit) {
                if (hasTier(got, k)) continue;
                if (wood < 2) {
                    if (logs('kit-tools')) return done();
                } else if (k === 'stone' && cobble < 9) {
                    if (tryRun('mine', 'cobble', 'kit-cobble', stone)) return done();
                    note('cobble', pick && s.stone === 0 && choreOk(s, 'mine', 'cobble'));
                } else if (tryRun('craft', `${k}_${tool}`, 'kit-tools', true)) return done();
                break;
            }
        }
        if (tryRun('store', 'kit', 'kit-store', s.kitFood < 8 && food - raw >= 16)) return done();
        if (s.kitTorches < 16) {
            if (tryRun('store', 'kit', 'kit-store', torches >= 24) || torch('kit-torches')) return done();
        }
    }
    if (tryRun('gather', 'logs', 'stock-logs', wood < 64 && trees) || tryRun('mine', 'cobble', 'stock-cobble', cobble < 64 && stone)) return done();
    if (tryRun('craft', 'stone_sword', 'sword', !hasTier(s.sword, 'stone') && hasTier(s.pickaxe, 'stone') && cobble >= 2 && (wood >= 1 || sticks >= 1))) return done();
    if (need !== '') return { words: { Skill: 'ask', Target: need }, rule: `ask-${need}` as ChoresRule };
    return { words: { Skill: 'rest', Target: 'none' }, rule: 'rest' };
}

/**
 * choresHarmful: a pair that isn't valid, failed in the last 5 minutes or has no actuator, out on the surface at
 * night (hunt, gather, farm, mine cobble), mining at night unarmed (v2.1), or placing with nothing to place (v2.go Harmful).
 */
export function choresHarmful(s: ChoresSituation, got: Words): boolean {
    const k = got.Skill ?? '', t = got.Target ?? '';
    if (!isChorePair(k, t) || !choreOk(s, k, t)) return true;
    if (s.time === 'night' && ((OUTDOOR as readonly string[]).includes(k) || (k === 'mine' && t === 'cobble'))) return true;
    if (s.time === 'night' && k === 'mine' && !armed(s)) return true;
    if (k === 'place') {
        const station = ({ crafting_table: s.made.table, furnace: s.made.furnace, chest: s.made.chest, bed: s.made.bed } as Record<string, number>)[t];
        return (station !== undefined && station === 0) || (t === 'torch' && have(s, 'torches') === 0) || (t === 'saplings' && have(s, 'saplings') === 0);
    }
    return false;
}
