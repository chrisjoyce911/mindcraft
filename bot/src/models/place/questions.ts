// The place question (laya-go games/place Questions): Target, its options from the grid.
import { choice } from '../skill/index.js';
import type { PlaceSituation } from './render.js';
import { placeOptions } from './rules.js';

export function placeQuestions(s: PlaceSituation) {
    return { Target: choice('Where should I place it?', placeOptions(s)) };
}
