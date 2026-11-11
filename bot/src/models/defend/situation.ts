// Facts → the defend situation (defend_state.js situation, fed as modes.js laya_defending did): only
// mobs attacking the bot or a player (user decision 2026-11-11), within MOB_RANGE + 2; a player within
// PLAYER_NEAR; night as mineflayer's isDay false (timeOfDay ≥ 13000, unlike the director's 13000–23000).
import type { Facts } from '../../types/index.js';
import { chooseWeapons, MOB_RANGE, nearMobs, PLAYER_NEAR, type DefendSituation, type SeenMob } from './render.js';

export const DEFEND_NIGHT_FROM = 13000;

export function defendSituation(f: Facts): DefendSituation {
    const names = f.items.map(i => i.name);
    const count = (n: string) => f.items.filter(i => i.name === n).reduce((k, i) => k + i.count, 0);
    const seen: SeenMob[] = f.mobs.filter(m => m.attacker && m.dist <= MOB_RANGE + 2).map(m => {
        const s: SeenMob = { kind: m.name, x: Math.floor(m.pos.x), z: Math.floor(m.pos.z), id: m.id };
        if (m.health !== undefined) s.health = m.health;
        return s;
    });
    return {
        health: Math.max(1, Math.min(20, Math.floor(f.health))),
        food: f.food,
        armor: f.armor,
        night: f.time >= DEFEND_NIGHT_FROM,
        playerNear: f.nearestPlayer !== null && f.nearestPlayer <= PLAYER_NEAR,
        weapons: chooseWeapons(names),
        arrows: count('arrow'),
        shield: count('shield') > 0 || f.offhand === 'shield',
        apples: count('golden_apple') + count('enchanted_golden_apple'),
        mobs: nearMobs(seen, Math.floor(f.pos.x), Math.floor(f.pos.z)),
    };
}
