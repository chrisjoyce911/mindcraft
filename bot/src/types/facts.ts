// Facts: what the sensors report, one snapshot per tick (design §3.1). bot/src/sensors fills them in
// (3.3); the models' adapters (models/<m>/situation.ts) turn them into each model's situation.
export interface Vec3Like { x: number; y: number; z: number }
export type MobKind = 'zombie' | 'skeleton' | 'creeper' | 'spider' | 'other';
export type Danger = 'none' | 'fluid' | 'fall' | 'drowning' | 'fire';
export type Armed = 'none' | 'sword' | 'axe' | 'other';
/** A mob's hit: its kind, entity id, when (ms) and how far it is from the bot now (ceil). */
export interface Attack { by: MobKind; entityId: number; at: number; dist: number }
/** A hostile mob the sensors see: raw entity name, kind, where, how far (exact), health if known. */
export interface MobFact {
    id: number; name: string; kind: MobKind; pos: Vec3Like; dist: number; health?: number;
    /** It hurt the bot or a player in the last 15 s, or it is a creeper fusing near one (attacks.ts). */
    attacker: boolean;
}
/** An inventory stack. */
export interface Carried { name: string; count: number }
export interface Facts {
    t: number; pos: Vec3Like;
    health: number; food: number;
    /** Food saturation, one decimal. */
    saturation: number;
    armed: Armed;
    /** The armour bar, 0–20. */
    armor: number;
    /** Hostiles within 16. */
    hostiles: number;
    /** The nearest hostile within 16, distance rounded up. */
    nearest: { kind: MobKind; dist: number } | null;
    /** Hostiles within MOB_SCAN (18), nearest first. */
    mobs: MobFact[];
    /** The mob that hurt the bot in the last 5 s, still alive (director v1.3 Me line). */
    me: Attack | null;
    /** The nearest player within 24 a mob hit in the last 5 s, else the nearest within 24 (exact dist). */
    player: { name: string; attacked: Attack | null; dist: number } | null;
    /** The distance to the nearest other player (any range), or null. */
    nearestPlayer: number | null;
    light: number;
    /** timeOfDay in [13000, 23000) (the director's night). */
    night: boolean;
    /** The raw time of day (0–23999). */
    time: number;
    under: boolean; danger: Danger;
    /** Free inventory slots. */
    free: number; valuables: number; foodItems: number;
    /** Inventory items in slot order. */
    items: Carried[];
    /** Worn armour names (slots 5–8) and the off-hand item. */
    worn: string[]; offhand: string | null;
    /** The home chest's distance (ceil), or null when none is known or it is gone. */
    home: { dist: number } | null;
    /** A home_chest place is saved but the block there (loaded) is not a chest. */
    homeGone: boolean;
    stuck: boolean;
}
/** Remembered places, as memory.json `places`: {name: [x, y, z]}. */
export type Places = Record<string, [number, number, number]>;
