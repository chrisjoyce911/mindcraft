// The hunt questions (laya-go games/hunt Questions): Action and Target, the same for every state.
import { choice } from '../skill/index.js';
import { HUNT_KINDS } from './render.js';

export const HUNT_ACTIONS = ['attack', 'approach', 'collect', 'search', 'done', 'give_up'] as const;
export type HuntAction = (typeof HUNT_ACTIONS)[number];
export const HUNT_TARGETS = [...HUNT_KINDS, 'drops', 'none'] as const;
export type HuntTarget = (typeof HUNT_TARGETS)[number];

export function huntQuestions() {
    return {
        Action: choice('What should I do next to hunt?', HUNT_ACTIONS),
        Target: choice('Which animal or drops?', HUNT_TARGETS),
    };
}
