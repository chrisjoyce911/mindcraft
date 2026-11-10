// The command task's state and item resolution: laya-go's command game
// (games/command, prompt v1) in JavaScript. A player's chat message becomes a
// state; the model answers Addressed, Command, Item, Tier and Count; resolve()
// turns the Item kind into a Minecraft item with the bot's inventory.
// test/laya_command.test.js checks it all against laya-go's fixtures.

export const VERSION = 'v1'; // the default; v2 adds farm (settings decision_models.tasks.command.prompt)
export const MAX_MESSAGE = 120;
export const NONE = 'none';

export const COMMANDS = ['follow', 'come', 'stop', 'stay', 'gather', 'craft', 'mine', 'give', 'attack', 'store', 'eat', 'inventory', 'chat'];
// COMMANDS_V2: prompt v2's, v1's with farm after mine.
export const COMMANDS_V2 = ['follow', 'come', 'stop', 'stay', 'gather', 'craft', 'mine', 'farm', 'give', 'attack', 'store', 'eat', 'inventory', 'chat'];
export const TIERS = ['wooden', 'stone', 'iron', 'diamond', NONE];
export const COUNTS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '12', '16', '20', '24', '32', '48', '64', 'all', 'any'];
export const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroot'];
export const TOOLS = ['pickaxe', 'axe', 'sword', 'shovel', 'hoe'];
export const ARMOR = ['helmet', 'chestplate', 'leggings', 'boots'];
export const MOBS = ['zombie', 'skeleton', 'spider', 'creeper', 'witch', 'husk', 'cave_spider', 'stray', 'drowned', 'enderman', 'slime', 'cow', 'pig', 'sheep', 'chicken'];

export const FOODS = ['bread', 'apple', 'cooked_beef', 'cooked_porkchop', 'cooked_chicken', 'cooked_mutton', 'cooked_cod', 'cooked_salmon',
    'baked_potato', 'carrot', 'potato', 'golden_apple', 'golden_carrot', 'rotten_flesh', 'chicken', 'beef', 'porkchop', 'mutton', 'cookie',
    'melon_slice', 'sweet_berries', 'pumpkin_pie', 'mushroom_stew', 'beetroot', 'dried_kelp'];

const is = (...names) => n => names.includes(n);
const suffix = s => n => n.endsWith(s);

// KINDS: the item kinds (laya-go generate.Kinds): key, the item gather and
// mine get, the item craft makes, and which carried items match.
export const KINDS = [
    { key: 'wood', gather: 'log', craft: 'planks', carried: suffix('_log') },
    { key: 'planks', gather: 'planks', craft: 'planks', carried: suffix('_planks') },
    { key: 'stick', gather: 'stick', craft: 'stick', carried: is('stick') },
    { key: 'stone', gather: 'cobblestone', craft: 'stone', carried: is('cobblestone', 'stone') },
    { key: 'coal', gather: 'coal', craft: 'charcoal', carried: is('coal', 'charcoal') },
    { key: 'charcoal', gather: '', craft: 'charcoal', carried: is('charcoal') },
    { key: 'iron', gather: 'raw_iron', craft: 'iron_ingot', carried: is('iron_ingot', 'raw_iron') },
    { key: 'gold', gather: 'raw_gold', craft: 'gold_ingot', carried: is('gold_ingot', 'raw_gold') },
    { key: 'copper', gather: 'raw_copper', craft: 'copper_ingot', carried: is('copper_ingot', 'raw_copper') },
    { key: 'diamond', gather: 'diamond', craft: '', carried: is('diamond') },
    { key: 'emerald', gather: 'emerald', craft: '', carried: is('emerald') },
    { key: 'redstone', gather: 'redstone', craft: '', carried: is('redstone') },
    { key: 'lapis', gather: 'lapis_lazuli', craft: '', carried: is('lapis_lazuli') },
    { key: 'sand', gather: 'sand', craft: '', carried: is('sand') },
    { key: 'glass', gather: '', craft: 'glass', carried: is('glass') },
    { key: 'dirt', gather: 'dirt', craft: '', carried: is('dirt') },
    { key: 'gravel', gather: 'gravel', craft: '', carried: is('gravel') },
    { key: 'flint', gather: 'flint', craft: '', carried: is('flint') },
    { key: 'torch', gather: '', craft: 'torch', carried: is('torch') },
    { key: 'table', gather: '', craft: 'crafting_table', carried: is('crafting_table') },
    { key: 'furnace', gather: '', craft: 'furnace', carried: is('furnace') },
    { key: 'chest', gather: '', craft: 'chest', carried: is('chest') },
    { key: 'ladder', gather: '', craft: 'ladder', carried: is('ladder') },
    { key: 'bucket', gather: '', craft: 'bucket', carried: is('bucket') },
    { key: 'shield', gather: '', craft: 'shield', carried: is('shield') },
    { key: 'shears', gather: '', craft: 'shears', carried: is('shears') },
    { key: 'bowl', gather: '', craft: 'bowl', carried: is('bowl') },
    { key: 'food', gather: '', craft: '', carried: is(...FOODS) },
    { key: 'bread', gather: '', craft: '', carried: is('bread') },
    { key: 'apple', gather: '', craft: '', carried: is('apple', 'golden_apple') },
    { key: 'meat', gather: '', craft: '', carried: is('cooked_beef', 'beef', 'cooked_porkchop', 'porkchop', 'cooked_mutton', 'mutton', 'cooked_chicken') },
    { key: 'string', gather: 'string', craft: '', carried: is('string') },
    { key: 'arrow', gather: '', craft: '', carried: is('arrow') },
    { key: 'bone', gather: '', craft: '', carried: is('bone') },
    { key: 'wheat', gather: 'wheat', craft: '', carried: is('wheat') },
    { key: 'seeds', gather: 'wheat_seeds', craft: '', carried: is('wheat_seeds') },
    { key: 'wool', gather: 'white_wool', craft: '', carried: suffix('_wool') },
];

// KINDS_V2: prompt v2's kinds, v1's and the three new crops.
export const KINDS_V2 = [...KINDS,
    { key: 'carrots', gather: 'carrot', craft: '', carried: is('carrot') },
    { key: 'potatoes', gather: 'potato', craft: '', carried: is('potato') },
    { key: 'beetroot', gather: 'beetroot', craft: '', carried: is('beetroot') },
];

const itemOptions = kinds => {
    const o = [...kinds.map(k => k.key), ...TOOLS, ...ARMOR];
    for (const m of MOBS) if (!o.includes(m)) o.push(m);
    return [...o, NONE];
};

// ITEMS: the Item question's options (laya-go generate.ItemOptions); v2's
// ITEMS_V2.
export const ITEMS = itemOptions(KINDS);
export const ITEMS_V2 = itemOptions(KINDS_V2);

// kindOf: any version's kind (laya-go KindOf).
const kindOf = key => KINDS_V2.find(k => k.key === key);

// normalize is laya-go's generate.Normalize: lower case, apostrophes
// dropped, anything but a–z, 0–9 and _ as a space, spaces collapsed, cut to
// MAX_MESSAGE bytes at a space. (Everything kept is ASCII, so bytes are
// characters.)
export function normalize(text) {
    let out = '';
    for (const ch of String(text).toLowerCase()) {
        if (ch === "'" || ch === '’') continue;
        out += /[a-z0-9_]/.test(ch) ? ch : ' ';
    }
    out = out.split(/\s+/).filter(Boolean).join(' ');
    if (out.length > MAX_MESSAGE) {
        out = out.slice(0, MAX_MESSAGE);
        const i = out.lastIndexOf(' ');
        if (i > 0) out = out.slice(0, i);
    }
    return out;
}

// state writes the command state; null if a name has a space or is empty.
export function state(bot, speaker, message) {
    if (!bot || !speaker || /[\s]/.test(bot + speaker)) return null;
    return `Command.\nMe ${bot} From ${speaker}\nSaid ${normalize(message)}`;
}

// QUESTIONS: the five questions every command request asks.
export const QUESTIONS = {
    Addressed: { criteria: null, instructions: 'The message is for me.', type: 'noul' },
    Command: { criteria: COMMANDS.slice(), instructions: 'What should I do?', type: 'choice' },
    Item: { criteria: ITEMS.slice(), instructions: 'Which item or mob?', type: 'choice' },
    Tier: { criteria: TIERS.slice(), instructions: 'Which tier?', type: 'choice' },
    Count: { criteria: COUNTS.slice(), instructions: 'How many?', type: 'choice' },
};

// QUESTIONS_V2: prompt v2's (the same wording, v2's options).
export const QUESTIONS_V2 = {
    ...QUESTIONS,
    Command: { ...QUESTIONS.Command, criteria: COMMANDS_V2.slice() },
    Item: { ...QUESTIONS.Item, criteria: ITEMS_V2.slice() },
};

// questionsFor returns prompt version v's questions (v1 unless 'v2').
export const questionsFor = v => (v === 'v2' ? QUESTIONS_V2 : QUESTIONS);

// bestTier: the tier a tool without one is made in (laya-go BestTier).
export function bestTier(carry) {
    const have = name => carry.filter(s => s.item === name).reduce((n, s) => n + s.count, 0);
    if (have('diamond') >= 3) return 'diamond';
    if (have('iron_ingot') >= 3) return 'iron';
    if (have('cobblestone') >= 3) return 'stone';
    return 'wooden';
}

// pick: the carried item matching with the most items, the first on a tie.
export function pick(carry, match) {
    let best = NONE, n = 0;
    for (const s of carry) if (match(s.item) && s.count > n) { best = s.item; n = s.count; }
    return best;
}

// resolve is laya-go's generate.Resolve: the Minecraft item a command acts
// on, from the Item key, the Tier and what the bot carries ([{item, count}]),
// or NONE.
export function resolve(command, key, tier, carry) {
    if (!key || key === NONE) return NONE;
    const tool = TOOLS.includes(key), armor = ARMOR.includes(key);
    const noTier = !tier || tier === NONE;
    switch (command) {
        case 'attack':
            return MOBS.includes(key) ? key : NONE;
        case 'farm': // v2: the crop key
            return CROPS.includes(key) ? key : NONE;
        case 'gather': case 'mine': {
            const k = kindOf(key);
            return k && k.gather ? k.gather : NONE;
        }
        case 'craft': {
            if (tool) return `${noTier ? bestTier(carry) : tier}_${key}`;
            if (armor) return `${noTier || tier === 'wooden' || tier === 'stone' ? 'iron' : tier}_${key}`;
            const k = kindOf(key);
            return k && k.craft ? k.craft : NONE;
        }
        case 'give': case 'store': case 'eat': {
            let match;
            if (tool || armor) {
                match = n => n.endsWith('_' + key) && (noTier || n.startsWith(tier + '_'));
            } else {
                const k = kindOf(key);
                if (!k) return NONE;
                match = k.carried;
            }
            if (command === 'eat') {
                const m = match;
                match = n => m(n) && FOODS.includes(n);
            }
            return pick(carry, match);
        }
    }
    return NONE;
}

// carried lists a bot's inventory as [{item, count}], same items merged, in
// slot order.
export function carried(bot) {
    const out = [];
    for (const it of bot.inventory?.items?.() || []) {
        const s = out.find(x => x.item === it.name);
        if (s) s.count += it.count; else out.push({ item: it.name, count: it.count });
    }
    return out;
}
