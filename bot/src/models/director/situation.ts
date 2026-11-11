// Facts → the director's situation (the old agent's _directorSituation). The job, paused job and
// last outcome are the job stack's; home suppression after a failed unload is the director's (3.4).
import type { Facts } from '../../types/index.js';
import type { DirectorJobKind, DirectorSituation, JobView, Last } from './render.js';

export function directorSituation(f: Facts, job: JobView | null = null, paused: DirectorJobKind | null = null, last: Last = 'none'): DirectorSituation {
    const p = f.player;
    return {
        job, paused,
        health: f.health, food: f.food, armed: f.armed, armor: f.armor,
        hostiles: f.hostiles, nearest: f.nearest ? { kind: f.nearest.kind, dist: f.nearest.dist } : null,
        light: f.light, night: f.night, under: f.under,
        free: f.free, home: f.home ? f.home.dist : null, valuables: f.valuables, foodItems: f.foodItems,
        danger: f.danger, last,
        player: p ? { name: p.name, attacked: !!p.attacked, by: p.attacked ? p.attacked.by : 'none', dist: p.dist } : null,
        me: f.me ? { attacked: true, by: f.me.by, dist: f.me.dist } : { attacked: false, by: 'none', dist: 0 },
    };
}
