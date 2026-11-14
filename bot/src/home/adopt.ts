// Home chest by sign (the old pack_actions.js packDeps home with adopt): with no home chest saved, look at most every
// ADOPT_EVERY_MS for a sign with andy's name on or next to a chest (home/chest.ts signedChest, within SIGN_RANGE);
// a chest found is saved as the home chest and andy says so. Used by the farm and mine jobs' home(). Pure: the
// search and the place book are passed in.
import type { Vec3Like } from '../types/index.js';

export const ADOPT_EVERY_MS = 30000;

export interface AdoptDeps {
    /** The saved home chest, or null. */
    recall(): Vec3Like | null;
    /** Saves the home chest. */
    remember(c: Vec3Like): void;
    /** The chest a sign with andy's name marks, or null (the world's search). */
    find(): Vec3Like | null;
    /** Says something (in game and on the console). */
    say(text: string): void;
    now?: () => number;
}

export const adoptedText = (c: Vec3Like) => `Found my name on a sign: the chest at ${c.x} ${c.y} ${c.z} is my home chest now.`;

/** homeAdopter returns home(): the saved home chest, else a signed chest (searched at most every ADOPT_EVERY_MS). */
export function homeAdopter(d: AdoptDeps): () => Vec3Like | null {
    let lookedAt = -Infinity;
    const now = d.now ?? Date.now;
    return () => {
        const h = d.recall();
        if (h || now() - lookedAt < ADOPT_EVERY_MS) return h;
        lookedAt = now();
        const c = d.find();
        if (!c) return null;
        d.remember(c);
        d.say(adoptedText(c));
        return { x: c.x, y: c.y, z: c.z };
    };
}
