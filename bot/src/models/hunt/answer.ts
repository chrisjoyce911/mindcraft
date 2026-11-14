// The hunt answer: Action and Target words → a typed step. Pairs that don't fit (attack drops, collect cow, done
// cow) are malformed: the rules decide that step.
import type { Words } from '../skill/index.js';
import { isHuntKind, type HuntKind } from './render.js';

export type HuntStep =
    | { action: 'attack' | 'approach'; target: HuntKind }
    | { action: 'collect' }
    | { action: 'search' | 'done' | 'give_up' };

export function readHunt(w: Words): HuntStep | null {
    const a = w.Action, t = w.Target ?? '';
    switch (a) {
        case 'attack': case 'approach': return isHuntKind(t) ? { action: a, target: t } : null;
        case 'collect': return t === 'drops' ? { action: a } : null;
        case 'search': case 'done': case 'give_up': return t === 'none' ? { action: a } : null;
        default: return null;
    }
}

/** huntWords: a step's Action and Target words. */
export const huntWords = (s: HuntStep): Words =>
    ({ Action: s.action, Target: 'target' in s ? s.target : s.action === 'collect' ? 'drops' : 'none' });
