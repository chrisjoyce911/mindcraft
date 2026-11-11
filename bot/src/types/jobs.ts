// Job specs (design §3.1, §11.3). The legacy parser and the command model both produce these.
export const ORES = ['coal', 'copper', 'iron', 'lapis', 'gold', 'redstone', 'diamond'] as const;
export type Ore = (typeof ORES)[number];
export const CROPS = ['wheat', 'carrots', 'potatoes', 'beetroot'] as const;
export type Crop = (typeof CROPS)[number];
export type ItemName = string;
export type MobName = string;

export type JobSpec =
    | { kind: 'follow'; player: string; distance: number }
    | { kind: 'come'; player: string; distance: number }
    | { kind: 'stay'; seconds: number }                       // -1 = until told otherwise
    | { kind: 'mine'; ore: Ore; count: number | 'forever' }
    | { kind: 'farm'; crop: Crop | 'any'; goal: { count: number } | 'forever' }
    | { kind: 'craft'; item: ItemName; count: number; legacy?: 'craftRecipe' }
    | { kind: 'gather'; item: ItemName; count: number; legacy?: 'collectBlocks' }
    | { kind: 'hunt'; mob: MobName; item: ItemName | null; count: number }
    | { kind: 'give'; player: string; item: ItemName; count: number }
    | { kind: 'store'; item: ItemName; count: number }
    | { kind: 'eat'; item: ItemName }
    | { kind: 'home' };
export type JobKind = JobSpec['kind'];
export type JobOrigin = 'player' | 'chore';
export interface JobState<P = unknown> {
    id: string; spec: JobSpec; origin: JobOrigin; by?: string; progress: P;
    status: 'running' | 'paused'; startedAt: number;
    /** When an activity or a stop paused it. */
    pausedAt?: number;
}
export type JobEnd = { how: 'done' } | { how: 'failed' | 'blocked'; reason: string } | { how: 'cancelled' };
