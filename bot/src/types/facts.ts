// Facts: what the sensors report, one snapshot per tick (design §3.1). Phase 2 has no sensors yet;
// these are the shapes the later phases fill in.
export interface Vec3Like { x: number; y: number; z: number }
export type MobKind = 'zombie' | 'skeleton' | 'creeper' | 'spider' | 'other';
export type Danger = 'none' | 'fluid' | 'fall' | 'drowning' | 'fire';
export type Armed = 'none' | 'sword' | 'axe' | 'other';
export interface Attack { by: MobKind; entityId: number; at: number; dist: number }
export interface Facts {
    t: number; pos: Vec3Like; health: number; food: number; armed: Armed; armor: number;
    hostiles: number; nearest: { kind: MobKind; dist: number } | null;
    me: Attack | null;
    player: { name: string; attacked: Attack | null; dist: number } | null;
    light: number; night: boolean; under: boolean; danger: Danger;
    free: number; valuables: number; foodItems: number; home: { dist: number } | null;
    stuck: boolean;
}
/** Remembered places, as memory.json `places`: {name: [x, y, z]}. */
export type Places = Record<string, [number, number, number]>;
