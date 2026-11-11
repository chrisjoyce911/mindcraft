// The full state the harness serves in state-update (test/fixtures/harness-contract), the same
// shape and values as src/agent/library/full_state.js. Read only.
import type { Bot } from 'mineflayer';
import type { Places } from '../types/index.js';

export interface Activity { idle: boolean; label: string }

export interface FullState {
    name: string;
    gameplay: { position: { x: number; y: number; z: number }; dimension: string; gamemode: string; health: number;
        hunger: number; biome: string; weather: string; timeOfDay: number; timeLabel: string };
    action: { current: string; kind: string; isIdle: boolean };
    surroundings: { below: string; legs: string; head: string; firstBlockAboveHead: string };
    inventory: { counts: Record<string, number>; stacksUsed: number; totalSlots: number;
        equipment: { helmet: string | null; chestplate: string | null; leggings: string | null; boots: string | null; mainHand: string | null } };
    nearby: { humanPlayers: string[]; botPlayers: string[]; entityTypes: string[] };
    modes: { summary: string };
    places: Places;
}

/** No modes in the new bot: the director decides (design §5.3). */
export const MODES_SUMMARY = 'Agent Modes:\n- none (new bot: the director decides)';

const r2 = (v: number) => Number(v.toFixed(2));

function blockName(bot: Bot, dx: number, dy: number, dz: number): string {
    return bot.blockAt(bot.entity.position.offset(dx, dy, dz))?.name ?? 'air';
}

function firstBlockAboveHead(bot: Bot, distance = 32): string {
    const ignore = ['air', 'cave_air'];
    for (let i = 0; i < distance; i++) {
        const name = blockName(bot, 0, i + 2, 0);
        if (!ignore.includes(name)) return `${name} (${i} blocks up)`;
    }
    return 'none';
}

function nearby(bot: Bot, maxDist: number) {
    const me = bot.entity.position;
    return Object.values(bot.entities)
        .map(e => ({ e, d: e.position.distanceTo(me) }))
        .filter(x => x.d <= maxDist)
        .sort((a, b) => a.d - b.d)
        .map(x => x.e);
}

export function fullState(bot: Bot, name: string, activity: Activity, places: Places): FullState {
    const pos = bot.entity.position;
    const t = bot.time.timeOfDay;
    const w = bot as unknown as { thunderState: number; rainState: number };
    const weather = w.thunderState > 0 ? 'Thunderstorm' : w.rainState > 0 ? 'Rain' : 'Clear';
    const counts: Record<string, number> = {};
    for (const it of bot.inventory.slots) if (it?.name) counts[it.name] = (counts[it.name] ?? 0) + it.count;
    const slot = (i: number) => bot.inventory.slots[i]?.name ?? null;
    const players: string[] = [];
    for (const e of nearby(bot, 64)) if (e.type === 'player' && e.username && e.username !== bot.username && !players.includes(e.username)) players.push(e.username);
    const types: string[] = [];
    for (const e of nearby(bot, 16)) if (e.name && !types.includes(e.name)) types.push(e.name);
    let biome = 'unknown';
    try {
        const id = bot.world.getBiome(pos);
        biome = (bot.registry.biomes as unknown as Record<number, { name: string }>)[id]?.name ?? 'unknown';
    } catch { /* chunk not loaded */ }
    return {
        name,
        gameplay: {
            position: { x: r2(pos.x), y: r2(pos.y), z: r2(pos.z) },
            dimension: bot.game.dimension, gamemode: bot.game.gameMode,
            health: Math.round(bot.health), hunger: Math.round(bot.food), biome, weather,
            timeOfDay: t, timeLabel: t < 6000 ? 'Morning' : t < 12000 ? 'Afternoon' : 'Night',
        },
        action: activity.idle
            ? { current: activity.label || 'Idle', kind: 'idle', isIdle: true }
            : { current: activity.label, kind: 'acting', isIdle: false },
        surroundings: { below: blockName(bot, 0, -1, 0), legs: blockName(bot, 0, 0, 0), head: blockName(bot, 0, 1, 0), firstBlockAboveHead: firstBlockAboveHead(bot) },
        inventory: {
            counts, stacksUsed: bot.inventory.items().length, totalSlots: bot.inventory.slots.length,
            equipment: { helmet: slot(5), chestplate: slot(6), leggings: slot(7), boots: slot(8), mainHand: bot.heldItem?.name ?? null },
        },
        nearby: { humanPlayers: players, botPlayers: [], entityTypes: types.filter(t => t !== 'player' && t !== 'item') },
        modes: { summary: MODES_SUMMARY },
        places: { ...places },
    };
}
