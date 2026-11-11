// The chores model's state, question and rules: the chores shared spec v1.1
// (Mindcraft chores sensor ↔ laya-go games/chores prompt v1.1 and rules
// v1.1, laya-go openspec/changes/chores-v11-director-v13/chores-spec.md).
// Pure (no mineflayer). test/laya_chores.test.js checks the request against
// laya-go's golden v1.1_sample_request.json byte for byte and the rules on
// 1000 of its generated situations.
//
// v1.1 (2026-11-11, live play 3: 26 rests in 40 minutes): Animals are
// searches (49/97/193/none) like Near; hunting when food is low goes to 193;
// Failed lists only chores whose latest failure is under 5 minutes old
// (never rest or a need answer); five need answers (need_wood, need_cobble,
// need_coal, need_wool, need_food) replace rest when something wanted is
// missing with nothing near to provide it.
//
//   Chores.
//   Home chest Time day Biome forest
//   Base table no furnace no chest yes lit no
//   Beds mine no player no
//   Tools axe stone pickaxe wooden sword none hoe none shovel none
//   Have wood 3 sticks 2 cobble 12 coal 0 torches 0
//   Food 4 raw 2 wool 0 seeds 0 saplings 1
//   Pack 20
//   Farm yes ready no
//   Kit pickaxe none axe none shovel none sword none food 0 torches 0
//   Near trees 49 stone 49 coal 97 sand none water 49 grass 49
//   Animals cow 49 pig none sheep 97 chicken none rabbit none
//   Ground saplings 2
//   Can place no smelt no
//   Failed none
//
// The rules are the fallback until a chores model is served; they never run
// a chore its actuator is missing for (Can place / Can smelt) or that failed
// lately: those fall through to the next rule, as in laya-go.

export const NONE = 'none';

// CHORES: the Chore question's answers, in the spec's order.
export const CHORES = ['gather_logs', 'place_table', 'craft_wood_tools', 'get_seeds', 'start_farm', 'gather_cobble',
    'craft_stone_tools', 'place_furnace', 'hunt_food', 'cook_food', 'make_torches', 'light_base', 'place_chest', 'gather_wool',
    'make_beds', 'stock_kit', 'stock_logs', 'stock_cobble', 'craft_sword', 'tend_farm', 'replant_saplings', 'unload', 'sleep',
    'night_mine', 'rest', 'need_wood', 'need_cobble', 'need_coal', 'need_wool', 'need_food'];
// NEEDS: the need answers (v1.1): tell the player, then stay like rest.
export const NEEDS = ['need_wood', 'need_cobble', 'need_coal', 'need_wool', 'need_food'];

export const QUESTIONS = {
    Chore: { criteria: CHORES.slice(), instructions: 'Which chore should I do next?', type: 'choice' },
};

export const NEEDS_PLACE = new Set(['place_table', 'place_furnace', 'place_chest', 'make_beds', 'light_base', 'replant_saplings']);
export const NEEDS_SMELT = new Set(['cook_food']);
export const OUTDOOR = new Set(['gather_logs', 'get_seeds', 'start_farm', 'gather_cobble', 'hunt_food', 'gather_wool', 'stock_logs',
    'stock_cobble', 'tend_farm']);

export const RULES = ['unload', 'night-sleep', 'night-mine', 'night-rest', 'food-low-farm', 'food-low-hunt', 'light-low-torches',
    'light-low-base', 'saplings', 'farm-ready', 'table', 'table-logs', 'wood-tools', 'wood-tools-logs', 'farm-seeds', 'farm-start',
    'farm-logs', 'stone-cobble', 'stone-tools', 'stone-logs', 'furnace', 'food-hunt', 'food-cook', 'light-torches', 'light-base',
    'chest', 'chest-logs', 'beds', 'beds-logs', 'beds-wool', 'kit-tools', 'kit-logs', 'kit-cobble', 'kit-food', 'kit-torches',
    'kit-make-torches', 'stock-logs', 'stock-cobble', 'sword', 'need-wood', 'need-cobble', 'need-coal', 'need-wool', 'need-food', 'rest'];

export const TIERS = [NONE, 'wooden', 'stone', 'iron', 'diamond'];
export const HOMES = ['bed', 'chest', 'table', 'player', 'self'];
export const TIMES = ['day', 'dusk', 'night'];
export const BIOMES = ['forest', 'plains', 'snowy', 'desert', 'beach', 'other'];
export const SEARCHES = [49, 97, 193];
export const WORK_AREA = 49;
export const BASE_AREA = 21;
export const ANIMALS = ['cow', 'pig', 'sheep', 'chicken', 'rabbit'];
export const MAX = { count: 999, pack: 36, animal: 9, ground: 9, kit: 99, failed: 3 };

export const tier = t => TIERS.indexOf(t);
const has = (t, at) => tier(t) >= tier(at);
const cap = (n, c) => Math.max(0, Math.min(c, Math.round(n || 0)));
const yn = b => (b ? 'yes' : 'no');
const oneOf = (v, list, dflt) => (list.includes(v) ? v : dflt);
const nearWord = n => (SEARCHES.includes(n) ? String(n) : NONE);

// A situation (s): home, time, biome; table, furnace, chest, lit; bedMine,
// bedPlayer; axe, pickaxe, sword, hoe, shovel (tiers); wood, sticks, cobble,
// coal, torches, food, raw, wool, seeds, saplings; pack; farm, ready;
// kitPickaxe, kitAxe, kitShovel, kitSword, kitFood, kitTorches; near
// {trees, stone, coal, sand, water, grass} (49/97/193 or null); animals
// {cow, pig, sheep, chicken, rabbit} (v1.1: 49/97/193 or null, the smallest
// search an adult is in); ground; canPlace, canSmelt; failed (chores whose
// latest failure is under 5 minutes old, latest first).

// choresState writes the situation as the spec's state text.
export function choresState(s) {
    const t = v => oneOf(v, TIERS, NONE);
    const c = n => cap(n, MAX.count);
    const n = s.near || {}, a = s.animals || {};
    const food = c(s.food), raw = Math.min(c(s.raw), food);
    const failed = [...new Set((s.failed || []).filter(x => CHORES.includes(x) && x !== 'rest' && !NEEDS.includes(x)))].slice(0, MAX.failed);
    return ['Chores.',
        `Home ${oneOf(s.home, HOMES, 'self')} Time ${oneOf(s.time, TIMES, 'day')} Biome ${oneOf(s.biome, BIOMES, 'other')}`,
        `Base table ${yn(s.table)} furnace ${yn(s.furnace)} chest ${yn(s.chest)} lit ${yn(s.lit)}`,
        `Beds mine ${yn(s.bedMine)} player ${yn(s.bedPlayer)}`,
        `Tools axe ${t(s.axe)} pickaxe ${t(s.pickaxe)} sword ${t(s.sword)} hoe ${t(s.hoe)} shovel ${t(s.shovel)}`,
        `Have wood ${c(s.wood)} sticks ${c(s.sticks)} cobble ${c(s.cobble)} coal ${c(s.coal)} torches ${c(s.torches)}`,
        `Food ${food} raw ${raw} wool ${c(s.wool)} seeds ${c(s.seeds)} saplings ${c(s.saplings)}`,
        `Pack ${cap(s.pack, MAX.pack)}`,
        `Farm ${yn(s.farm)} ready ${yn(s.farm && s.ready)}`,
        `Kit pickaxe ${t(s.kitPickaxe)} axe ${t(s.kitAxe)} shovel ${t(s.kitShovel)} sword ${t(s.kitSword)} food ${cap(s.kitFood, MAX.kit)} torches ${cap(s.kitTorches, MAX.kit)}`,
        `Near trees ${nearWord(n.trees)} stone ${nearWord(n.stone)} coal ${nearWord(n.coal)} sand ${nearWord(n.sand)} water ${nearWord(n.water)} grass ${nearWord(n.grass)}`,
        `Animals ${ANIMALS.map(k => `${k} ${nearWord(a[k])}`).join(' ')}`,
        `Ground saplings ${cap(s.ground, MAX.ground)}`,
        `Can place ${yn(s.canPlace)} smelt ${yn(s.canSmelt)}`,
        `Failed ${failed.length ? failed.join(' ') : NONE}`,
    ].join('\n');
}

// possible: the bot can start chore c at all (not failed lately, has its
// actuator).
export function possible(s, c) {
    if ((s.failed || []).includes(c)) return false;
    if (NEEDS_PLACE.has(c) && !s.canPlace) return false;
    if (NEEDS_SMELT.has(c) && !s.canSmelt) return false;
    return true;
}

// animalsWithin: an adult animal of any kind within search d (v1.1).
const animalsWithin = (s, d) => ANIMALS.some(k => SEARCHES.includes(s.animals?.[k]) && s.animals[k] <= d);
const nearSome = (s, k) => SEARCHES.includes(s.near?.[k]);

// torchNeed: what torches lack: need_coal with no fuel, else need_wood with
// no sticks or wood, else null (torchable).
function torchNeed(s) {
    const fuel = s.coal >= 1 || (nearSome(s, 'coal') && has(s.pickaxe, 'wooden')) || (s.furnace && s.canSmelt && s.wood >= 2);
    if (!fuel) return 'need_coal';
    if (!(s.sticks >= 1 || s.wood >= 1)) return 'need_wood';
    return null;
}
const torchable = s => torchNeed(s) === null;

// kitTier: the player kit's tier: his pickaxe's, diamond as iron, iron only
// when he can smelt.
export function kitTier(s) {
    let t = oneOf(s.pickaxe, TIERS, NONE);
    if (t === 'diamond') t = 'iron';
    if (t === 'iron' && !s.canSmelt) t = 'stone';
    return t;
}

function kitTools(s) {
    const t = kitTier(s);
    if (t === NONE) return false;
    return !has(s.kitPickaxe, t) || !has(s.kitAxe, t) || !has(s.kitShovel, t) || !has(s.kitSword, t);
}

// decideChore is the spec's rules v1.1, in order: {chore, rule}.
export function decideChore(s) {
    let d = null;
    const tr = (chore, rule, when) => {
        if (when && possible(s, chore)) { d = { chore, rule }; return true; }
        return false;
    };
    const trees = nearSome(s, 'trees');
    const pick = has(s.pickaxe, 'wooden');
    const stone = nearSome(s, 'stone') && pick;
    // v1.1: the first item found missing on the way, answered when nothing
    // else applies
    let need = null;
    const note = (c, when) => { if (when && !need) need = c; };
    const logs = rule => { note('need_wood', !trees); return tr('gather_logs', rule, trees); };
    const torches = rule => {
        if (!possible(s, 'make_torches')) return false;
        note(torchNeed(s), !!torchNeed(s));
        return tr('make_torches', rule, torchable(s));
    };

    if (tr('unload', 'unload', s.pack <= 3 && s.chest)) return d;
    if (s.time === 'night') {
        if (tr('sleep', 'night-sleep', s.bedMine) || tr('night_mine', 'night-mine', pick)) return d;
        return { chore: 'rest', rule: 'night-rest' };
    }
    if (s.food < 8 && has(s.axe, 'wooden')) {
        if (tr('tend_farm', 'food-low-farm', s.farm && s.ready) || tr('hunt_food', 'food-low-hunt', animalsWithin(s, 193))) return d;
        note('need_food', possible(s, 'hunt_food') && !animalsWithin(s, 193));
    }
    const unlitDusk = !s.lit && s.time === 'dusk';
    if (pick && (s.torches < 8 || unlitDusk)) {
        if ((s.torches < 8 && torches('light-low-torches'))
            || tr('light_base', 'light-low-base', unlitDusk && s.torches >= 8)) return d;
    }
    if (tr('replant_saplings', 'saplings', s.ground > 0 || s.saplings > 0) || tr('tend_farm', 'farm-ready', s.farm && s.ready)) return d;
    if (!s.table && possible(s, 'place_table')) {
        if (tr('place_table', 'table', s.wood >= 4) || logs('table-logs')) return d;
    }
    if (!has(s.axe, 'wooden') || !pick) {
        if (tr('craft_wood_tools', 'wood-tools', s.wood >= 3) || logs('wood-tools-logs')) return d;
    }
    if (!s.farm && s.near?.water === WORK_AREA) {
        if (tr('get_seeds', 'farm-seeds', s.seeds < 16 && nearSome(s, 'grass'))) return d;
        if (s.seeds >= 1 && tier(s.hoe) <= 0 && s.wood < 1) {
            if (logs('farm-logs')) return d;
        } else if (tr('start_farm', 'farm-start', s.seeds >= 1)) return d;
    }
    const tools = !has(s.axe, 'stone') || !has(s.pickaxe, 'stone');
    const furnace = !s.furnace && possible(s, 'place_furnace');
    if (tools || furnace) {
        const need = (tools ? 6 : 0) + (furnace ? 8 : 0);
        if (s.cobble < need) {
            if (tr('gather_cobble', 'stone-cobble', stone)) return d;
            note('need_cobble', pick && !nearSome(s, 'stone') && possible(s, 'gather_cobble'));
        } else if (tools) {
            const sticks = s.wood >= 1 || s.sticks >= 2;
            if (tr('craft_stone_tools', 'stone-tools', sticks) || (!sticks && logs('stone-logs'))) return d;
        } else if (tr('place_furnace', 'furnace', true)) return d;
    }
    if (tr('hunt_food', 'food-hunt', s.food < 32 && animalsWithin(s, 97)) || tr('cook_food', 'food-cook', s.raw >= 1 && s.furnace)) return d;
    if ((s.torches < 16 && torches('light-torches')) || tr('light_base', 'light-base', !s.lit && s.torches >= 8)) return d;
    if (!s.chest && possible(s, 'place_chest')) {
        if (tr('place_chest', 'chest', s.wood >= 2) || logs('chest-logs')) return d;
    }
    if ((!s.bedMine || !s.bedPlayer) && possible(s, 'make_beds')) {
        const need = (s.bedMine ? 0 : 3) + (s.bedPlayer ? 0 : 3);
        if (s.wool >= need) {
            if (tr('make_beds', 'beds', s.wood >= 2) || logs('beds-logs')) return d;
        } else if (tr('gather_wool', 'beds-wool', SEARCHES.includes(s.animals?.sheep))) return d;
        else note('need_wool', possible(s, 'gather_wool'));
    }
    if (s.chest) {
        if (kitTools(s)) {
            if (s.wood < 2) {
                if (logs('kit-logs')) return d;
            } else if (kitTier(s) === 'stone' && s.cobble < 9) {
                if (tr('gather_cobble', 'kit-cobble', stone)) return d;
                note('need_cobble', pick && !nearSome(s, 'stone') && possible(s, 'gather_cobble'));
            } else if (tr('stock_kit', 'kit-tools', true)) return d;
        }
        if (tr('stock_kit', 'kit-food', s.kitFood < 8 && s.food - s.raw >= 16)) return d;
        if (s.kitTorches < 16) {
            if (tr('stock_kit', 'kit-torches', s.torches >= 24) || torches('kit-make-torches')) return d;
        }
    }
    if (tr('stock_logs', 'stock-logs', s.wood < 64 && trees) || tr('stock_cobble', 'stock-cobble', s.cobble < 64 && stone)) return d;
    if (tr('craft_sword', 'sword', !has(s.sword, 'stone') && has(s.pickaxe, 'stone') && s.cobble >= 2 && (s.wood >= 1 || s.sticks >= 1))) return d;
    if (need) return { chore: need, rule: need.replace('_', '-') };
    return { chore: 'rest', rule: 'rest' };
}

// nextChore is the decision point: the chores model when deps.client and
// deps.task are given and its answer is confident, else the rules. A model
// answer the bot can't start (masked or failed lately) is returned as
// impossible ({impossible: true}); the caller logs it and asks again with
// it added to Failed, never swapping in a rule pick.
export async function nextChore(s, deps = {}) {
    const text = choresState(s);
    const rule = decideChore(s);
    if (deps.client && deps.task) {
        const r = await deps.client.decide('chores', text, QUESTIONS).catch(() => null);
        const a = r?.answers?.Chore;
        if (a?.confident && CHORES.includes(a.top))
            return { chore: a.top, rule: rule.rule, ruleChore: rule.chore, source: 'model', state: text, p: a.topProbability,
                impossible: !possible(s, a.top) };
    }
    return { ...rule, source: 'rules', state: text };
}

// Time of day (spec): night 12542 ≤ T < 23460 (bed usable), dusk 10142 ≤ T <
// 12542 (sunset within 2 minutes), else day.
export function timeWord(timeOfDay) {
    const t = ((timeOfDay % 24000) + 24000) % 24000;
    if (t >= 12542 && t < 23460) return 'night';
    if (t >= 10142 && t < 12542) return 'dusk';
    return 'day';
}

// biomeWord: the spec's Biome word for a biome name.
export function biomeWord(name) {
    const b = String(name || '').toLowerCase();
    if (/snowy|frozen|ice/.test(b)) return 'snowy';
    if (/forest|taiga|jungle|birch|cherry/.test(b)) return 'forest';
    if (/plains|meadow|sunflower|savanna/.test(b)) return 'plains';
    if (/desert|badlands/.test(b)) return 'desert';
    if (/beach|ocean|river|mushroom|shore/.test(b)) return 'beach';
    return 'other';
}

// toolTier: a tool name's tier (golden as wooden, netherite as diamond).
export function toolTier(name) {
    const m = /^(wooden|golden|stone|iron|diamond|netherite)_/.exec(name || '');
    if (!m) return NONE;
    return { wooden: 'wooden', golden: 'wooden', stone: 'stone', iron: 'iron', diamond: 'diamond', netherite: 'diamond' }[m[1]];
}

// bestTiers: the best tier of each tool among item names.
export function bestTiers(names) {
    const out = { axe: NONE, pickaxe: NONE, sword: NONE, hoe: NONE, shovel: NONE };
    for (const n of names) {
        const m = /_(axe|pickaxe|sword|hoe|shovel)$/.exec(n || '');
        if (!m) continue;
        const t = toolTier(n);
        if (tier(t) > tier(out[m[1]])) out[m[1]] = t;
    }
    return out;
}

export const RAW_MEAT = new Set(['beef', 'porkchop', 'mutton', 'chicken', 'rabbit', 'cod', 'salmon']);
export const NOT_FOOD = new Set(['rotten_flesh', 'spider_eye', 'poisonous_potato']);
export const SEED_ITEMS = new Set(['wheat_seeds', 'beetroot_seeds', 'carrot', 'potato']);
export const isSapling = n => /_sapling$|_propagule$/.test(n || '');
export const isLog = n => /_(log|stem|wood|hyphae)$/.test(n || '');

// saplingOf: the sapling a log's tree drops (null for logs with none).
export function saplingOf(log) {
    const m = /^(oak|birch|spruce|jungle|acacia|dark_oak|cherry|pale_oak|mangrove)_(log|wood)$/.exec(log || '');
    if (!m) return null;
    return m[1] === 'mangrove' ? 'mangrove_propagule' : `${m[1]}_sapling`;
}

// STRING_PER_WOOL: 4 string craft 1 white wool (no sheep needed).
export const STRING_PER_WOOL = 4;

// The player kit: the four tools, KIT_FOOD cooked food, KIT_TORCHES torches.
export const KIT_FOOD = 8;
export const KIT_TORCHES = 16;
export const KIT_TOOLS = ['pickaxe', 'axe', 'shovel', 'sword'];

// kitIn reads the player kit in the home chest's items ([{name, count}]):
// the best tier of each kit tool, cooked food and torches (capped 99), and
// the reserved items (one of each kit tool at its best tier, the first 8
// cooked food, the first 16 torches) as {name: count}. foods: foodsByName.
export function kitIn(chestItems, isFood) {
    const reserved = {};
    const best = {};
    for (const k of KIT_TOOLS) {
        let top = null;
        for (const i of chestItems) {
            if (!new RegExp(`_${k}$`).test(i.name) || (k === 'axe' && /pickaxe$/.test(i.name))) continue;
            if (!top || tier(toolTier(i.name)) > tier(toolTier(top))) top = i.name;
        }
        best[k] = top ? toolTier(top) : NONE;
        if (top) reserved[top] = (reserved[top] || 0) + 1;
    }
    let food = 0, torches = 0, foodLeft = KIT_FOOD, torchLeft = KIT_TORCHES;
    for (const i of chestItems) {
        if (isFood(i.name) && !RAW_MEAT.has(i.name) && !NOT_FOOD.has(i.name)) {
            food += i.count;
            const r = Math.min(foodLeft, i.count);
            if (r > 0) { reserved[i.name] = (reserved[i.name] || 0) + r; foodLeft -= r; }
        } else if (i.name === 'torch') {
            torches += i.count;
            const r = Math.min(torchLeft, i.count);
            if (r > 0) { reserved.torch = (reserved.torch || 0) + r; torchLeft -= r; }
        }
    }
    return { pickaxe: best.pickaxe, axe: best.axe, shovel: best.shovel, sword: best.sword,
        food: Math.min(food, MAX.kit), torches: Math.min(torches, MAX.kit), reserved };
}

// unreserved: chest items less the reserved kit ([{name, count}]).
export function unreserved(chestItems, reserved) {
    const left = { ...reserved };
    const out = [];
    for (const i of chestItems) {
        const r = Math.min(left[i.name] || 0, i.count);
        if (r) left[i.name] -= r;
        if (i.count - r > 0) out.push({ name: i.name, count: i.count - r });
    }
    return out;
}

// haveCounts: the Have/Food line counts from items ([{name, count}],
// carried plus the home chest less the kit). isFood(name).
export function haveCounts(items, isFood) {
    const n = { logs: 0, planks: 0, sticks: 0, cobble: 0, coal: 0, torches: 0, food: 0, raw: 0, wool: 0, string: 0, seeds: 0, saplings: 0 };
    for (const { name, count } of items) {
        if (isLog(name)) n.logs += count;
        else if (/_planks$/.test(name)) n.planks += count;
        else if (name === 'stick') n.sticks += count;
        else if (name === 'cobblestone' || name === 'cobbled_deepslate') n.cobble += count;
        else if (name === 'coal' || name === 'charcoal') n.coal += count;
        else if (name === 'torch') n.torches += count;
        else if (/_wool$/.test(name)) n.wool += count;
        else if (name === 'string') n.string += count;
        else if (SEED_ITEMS.has(name)) n.seeds += count;
        else if (isSapling(name)) n.saplings += count;
        if (isFood(name) && !NOT_FOOD.has(name)) {
            n.food += count;
            if (RAW_MEAT.has(name)) n.raw += count;
        }
    }
    return { wood: n.logs + Math.floor(n.planks / 4), sticks: n.sticks, cobble: n.cobble, coal: n.coal, torches: n.torches,
        // wool counts what string makes too (4 string → 1 white wool)
        food: n.food, raw: n.raw, wool: n.wool + Math.floor(n.string / STRING_PER_WOOL), seeds: n.seeds, saplings: n.saplings };
}

// recentFailed: chores whose latest failure is under 5 minutes old, latest
// first, no repeats, at most 3, never rest or a need answer (v1.1: a chore
// that fails again starts its 5 minutes again). failures: [{chore, at}].
export function recentFailed(failures, now, windowMs = 5 * 60_000) {
    const out = [];
    for (const f of [...failures].sort((a, b) => b.at - a.at)) {
        if (f.chore === 'rest' || NEEDS.includes(f.chore)) continue;
        if (now - f.at >= windowMs || out.includes(f.chore)) continue;
        out.push(f.chore);
        if (out.length === MAX.failed) break;
    }
    return out;
}
