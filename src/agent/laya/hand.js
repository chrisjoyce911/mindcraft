// What andy holds when no job is running: the best weapon, else the tool in
// hand, else the best pickaxe, else nothing. After a job or a pickup the
// main hand often holds whatever landed in the selected hotbar slot (an
// arrow, a torch, cobblestone), so he would fight bare-handed. Pure: the
// agent equips what handChoice returns.

const TIERS = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden'];
const TOOL = /_(pickaxe|axe|shovel|sword|hoe)$|^(shears|flint_and_steel|fishing_rod|bow|crossbow|shield|trident|mace)$/;

const tierOf = name => { const i = TIERS.indexOf(String(name).split('_')[0]); return i < 0 ? TIERS.length : i; };

// bestOf: the best-tier item among names matching re, or null.
function bestOf(names, re) {
    return names.filter(n => re.test(n)).sort((a, b) => tierOf(a) - tierOf(b))[0] || null;
}

// bestWeapon: the best sword, else the best axe (not a pickaxe), or null.
export function bestWeapon(names) {
    return bestOf(names, /_sword$/) || bestOf(names, /(^|_)axe$/);
}

// handChoice says what to hold: {equip: name} to equip an item, {empty: true}
// to clear the hand, or null to leave it. items: the carried item names;
// held: the main hand item's name or null.
export function handChoice(items, held) {
    const weapon = bestWeapon(items);
    if (weapon) return held === weapon ? null : { equip: weapon };
    if (!held || TOOL.test(held)) return null;
    const pick = bestOf(items, /_pickaxe$/);
    return pick ? { equip: pick } : { empty: true };
}
