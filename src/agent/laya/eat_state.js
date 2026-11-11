// The eat task's state: laya-go's eat prompt v1 (games/eat/prompt in laya-go),
// written from the bot's health, hunger, saturation, danger and the food it
// carries. test/laya_eat.test.js checks it against laya-go's golden request.
//
//   Eat.
//   Health 14 Food 12 Saturation 0.0 Danger no
//   apple x3 4 2.4
//   golden_apple x1 4 9.6 rare
//   rotten_flesh x2 4 0.8 bad

export const MAX_KINDS = 6;
export const NONE = 'none';

// FOODS is laya-go's food table (games/eat/food): Minecraft 1.21.6's 40 foods
// with points, TRUE saturation and tag. minecraft-data's "saturation" field is
// wrong; the true value is its saturationRatio ÷ 2.
export const FOODS = {
    apple: { points: 4, saturation: 2.4, tag: 'normal' },
    mushroom_stew: { points: 6, saturation: 7.2, tag: 'normal' },
    bread: { points: 5, saturation: 6.0, tag: 'normal' },
    porkchop: { points: 3, saturation: 1.8, tag: 'normal' },
    cooked_porkchop: { points: 8, saturation: 12.8, tag: 'normal' },
    golden_apple: { points: 4, saturation: 9.6, tag: 'rare' },
    enchanted_golden_apple: { points: 4, saturation: 9.6, tag: 'rare' },
    cod: { points: 2, saturation: 0.4, tag: 'normal' },
    salmon: { points: 2, saturation: 0.4, tag: 'normal' },
    tropical_fish: { points: 1, saturation: 0.2, tag: 'normal' },
    pufferfish: { points: 1, saturation: 0.2, tag: 'bad' },
    cooked_cod: { points: 5, saturation: 6.0, tag: 'normal' },
    cooked_salmon: { points: 6, saturation: 9.6, tag: 'normal' },
    cookie: { points: 2, saturation: 0.4, tag: 'normal' },
    melon_slice: { points: 2, saturation: 1.2, tag: 'normal' },
    dried_kelp: { points: 1, saturation: 0.6, tag: 'normal' },
    beef: { points: 3, saturation: 1.8, tag: 'normal' },
    cooked_beef: { points: 8, saturation: 12.8, tag: 'normal' },
    chicken: { points: 2, saturation: 1.2, tag: 'bad' },
    cooked_chicken: { points: 6, saturation: 7.2, tag: 'normal' },
    rotten_flesh: { points: 4, saturation: 0.8, tag: 'bad' },
    spider_eye: { points: 2, saturation: 3.2, tag: 'bad' },
    carrot: { points: 3, saturation: 3.6, tag: 'normal' },
    potato: { points: 1, saturation: 0.6, tag: 'normal' },
    baked_potato: { points: 5, saturation: 6.0, tag: 'normal' },
    poisonous_potato: { points: 2, saturation: 1.2, tag: 'bad' },
    golden_carrot: { points: 6, saturation: 14.4, tag: 'normal' },
    pumpkin_pie: { points: 8, saturation: 4.8, tag: 'normal' },
    rabbit: { points: 3, saturation: 1.8, tag: 'normal' },
    cooked_rabbit: { points: 5, saturation: 6.0, tag: 'normal' },
    rabbit_stew: { points: 10, saturation: 12.0, tag: 'normal' },
    mutton: { points: 2, saturation: 1.2, tag: 'normal' },
    cooked_mutton: { points: 6, saturation: 9.6, tag: 'normal' },
    chorus_fruit: { points: 4, saturation: 2.4, tag: 'bad' },
    beetroot: { points: 1, saturation: 1.2, tag: 'normal' },
    beetroot_soup: { points: 6, saturation: 7.2, tag: 'normal' },
    suspicious_stew: { points: 6, saturation: 7.2, tag: 'bad' },
    sweet_berries: { points: 2, saturation: 0.4, tag: 'normal' },
    glow_berries: { points: 2, saturation: 0.4, tag: 'normal' },
    honey_bottle: { points: 6, saturation: 1.2, tag: 'normal' },
};

// BAD_ORDER is the bad foods from least to most harmful (laya-go food.BadOrder).
export const BAD_ORDER = ['suspicious_stew', 'chorus_fruit', 'chicken', 'rotten_flesh', 'poisonous_potato', 'spider_eye', 'pufferfish'];

// carried groups inventory items into foods, keeping at most MAX_KINDS: rare
// first, then normal by points and saturation, then bad in BAD_ORDER. The kept
// foods stay in inventory order. Returns [{food, count}].
export function carried(items) {
    const order = [], counts = new Map();
    for (const it of items) {
        if (!FOODS[it.name]) continue;
        if (!counts.has(it.name)) order.push(it.name);
        counts.set(it.name, (counts.get(it.name) || 0) + it.count);
    }
    if (order.length > MAX_KINDS) {
        const rank = n => {
            const f = FOODS[n];
            if (f.tag === 'rare') return [0, 0, 0];
            if (f.tag === 'normal') return [1, -f.points, -f.saturation];
            return [2, BAD_ORDER.indexOf(n), 0];
        };
        const keep = new Set(order.slice().sort((a, b) => {
            const ra = rank(a), rb = rank(b);
            for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
            return a < b ? -1 : 1;
        }).slice(0, MAX_KINDS));
        return order.filter(n => keep.has(n)).map(n => ({ food: n, count: counts.get(n) }));
    }
    return order.map(n => ({ food: n, count: counts.get(n) }));
}

// situation reads what the eat rules decide from: health rounded down (at
// least 1), food, saturation, danger and the carried foods.
export function situation(bot, danger) {
    return {
        health: Math.max(1, Math.floor(bot.health)),
        food: bot.food,
        saturation: Math.round((bot.foodSaturation ?? 0) * 10) / 10,
        danger: !!danger,
        carry: carried(bot.inventory.items()),
    };
}

// state writes a situation as eat prompt v1.
export function state(s) {
    const lines = ['Eat.', `Health ${s.health} Food ${s.food} Saturation ${s.saturation.toFixed(1)} Danger ${s.danger ? 'yes' : 'no'}`];
    for (const { food, count } of s.carry) {
        const f = FOODS[food];
        lines.push(`${food} x${count} ${f.points} ${f.saturation.toFixed(1)}` + (f.tag === 'normal' ? '' : ' ' + f.tag));
    }
    return lines.join('\n');
}

// questions returns the two eat questions for a situation.
export function questions(s) {
    return {
        Eat: { criteria: null, instructions: 'I should eat now.', type: 'noul' },
        Food: { criteria: [...s.carry.map(c => c.food), NONE], instructions: 'Which food should I eat?', type: 'choice' },
    };
}
