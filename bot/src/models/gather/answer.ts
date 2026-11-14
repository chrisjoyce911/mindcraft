// The gather answer: the Action word → a typed step.
import type { Words } from '../skill/index.js';
import { isGatherAction, type GatherAction } from './questions.js';

export interface GatherStep { action: GatherAction }

export function readGather(w: Words): GatherStep | null {
    const a = w.Action ?? '';
    return isGatherAction(a) ? { action: a } : null;
}
