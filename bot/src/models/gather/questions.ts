// The gather question (laya-go games/gather Questions): Action, the same for every state.
import { choice } from '../skill/index.js';

export const GATHER_ACTIONS = ['cut', 'shear', 'kill', 'approach', 'collect', 'search', 'done', 'give_up'] as const;
export type GatherAction = (typeof GATHER_ACTIONS)[number];
export const isGatherAction = (s: string): s is GatherAction => (GATHER_ACTIONS as readonly string[]).includes(s);

export function gatherQuestions() {
    return { Action: choice('What should I do next to gather?', GATHER_ACTIONS) };
}
