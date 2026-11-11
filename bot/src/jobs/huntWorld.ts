// The hunt job's world: what andy carries, the nearest mob of a kind (actuators/hunt nearestMob, HUNT_RANGE 24),
// killing it (killEntity: fight until it dies, the old attackEntity without pvp) and picking up the drops (the old
// pickupNearbyItems, range 8). 5.5's hunt skill job drives the same actuators.
import type { Act } from '../actuators/bot.js';
import { killEntity, nearestMob } from '../actuators/hunt.js';
import { pickupNearby } from '../actuators/collect.js';
import { wait } from '../actuators/settle.js';
import type { HuntWorld } from './hunt.js';

/** The wait after a kill before picking up: the drops appear as the mob's body goes. */
export const DROP_WAIT_MS = 500;

export function huntWorld(a: Act): HuntWorld {
    return {
        have: item => a.bot.items().filter(i => i.name === item).reduce((n, i) => n + i.count, 0),
        nearest: mob => nearestMob(a, mob),
        kill: (e, signal) => killEntity(a, e, signal),
        pickup: async signal => {
            if (!(await wait(DROP_WAIT_MS, signal))) return;
            await pickupNearby(a, signal);
        },
    };
}
