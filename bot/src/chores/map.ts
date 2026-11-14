// A chores answer and its goal → the job that runs it (skills-spec v1 §1 "Answers"; design §11.3): one case per
// Pairs entry, a total switch on the typed answer. The amounts come from models/chores goals.ts, none from here.
//   hunt food → huntFood (the hunt skill)            farm start/tend → farm, timed (minutes)
//   gather x → gatherSkill (the gather skill)        mine cobble → cobble; mine coal/iron → mine (iron at night until day)
//   craft x → craft (a bed: planks then the bed; a kit tool: into the kit)
//   place x → place (the place skill)                cook → cook; store unload → unload; store kit → kit
//   sleep → sleep; ask x → rest that says what he needs first; rest → rest
import type { JobSpec } from '../types/jobs.js';
import type { ChoresAnswer, ChoresGoal } from '../models/chores/index.js';

/** choreLabel: the run's name in the lease (action:chore:<label>) and the logs: '<skill>_<target>'. */
export const choreLabel = (a: ChoresAnswer): string => `${a.skill}_${a.target}`;

const badGoal = (a: ChoresAnswer, g: ChoresGoal): never => { throw new Error(`chores: goal ${g.kind} doesn't fit ${a.skill} ${a.target}`); };

/** choreJob: the JobSpec for an answer and its goal (throws on a goal of the wrong kind: goals.ts gives each its own). */
export function choreJob(a: ChoresAnswer, g: ChoresGoal): JobSpec {
    switch (a.skill) {
        case 'hunt':
            return g.kind === 'have' ? { kind: 'huntFood', goal: Math.max(1, g.goal), chest: g.chest } : badGoal(a, g);
        case 'farm':
            return g.kind === 'minutes' ? { kind: 'farm', crop: 'any', goal: { minutes: g.minutes } } : badGoal(a, g);
        case 'gather':
            return g.kind === 'have' ? { kind: 'gatherSkill', target: a.target, goal: Math.max(1, g.goal), chest: g.chest } : badGoal(a, g);
        case 'mine': {
            if (g.kind !== 'mine') return badGoal(a, g);
            if (a.target === 'cobble') return { kind: 'cobble', count: g.count === 'day' ? 64 : g.count };
            return g.count === 'day' ? { kind: 'mine', ore: a.target, count: 'forever', until: 'day' } : { kind: 'mine', ore: a.target, count: g.count };
        }
        case 'craft':
            if (g.kind !== 'craft') return badGoal(a, g);
            return { kind: 'craft', item: a.target, count: g.count, ...(g.kit ? { into: 'kit' as const } : {}) };
        case 'place': return { kind: 'place', item: a.target };
        case 'cook': return { kind: 'cook' };
        case 'store': return a.target === 'unload' ? { kind: 'unload' } : { kind: 'kit' };
        case 'sleep': return { kind: 'sleep' };
        case 'ask':
            return g.kind === 'seconds' ? { kind: 'rest', seconds: g.seconds, ask: a.target } : badGoal(a, g);
        case 'rest':
            return g.kind === 'seconds' ? { kind: 'rest', seconds: g.seconds } : badGoal(a, g);
    }
}
