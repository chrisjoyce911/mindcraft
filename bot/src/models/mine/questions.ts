// The mine questions (laya-go games/mine/prompt): Action and Hazard (v1), plus Unload (v2), and the typed actions.
import type { Questions } from '../../types/models.js';
import { DIRS, MOVE_KINDS, isDir, isMoveKind, type Dir, type MoveKind } from './data.js';
import type { Move } from './view.js';

export type MoveAction = `${MoveKind} ${Dir}`;
/** A mine step: the Action question's options. */
export type MineAction = 'collect' | MoveAction | 'torch' | 'block' | 'stop';

/** ACTIONS: the Action question's options, in laya-go's order. */
export const ACTIONS: readonly MineAction[] = ['collect',
    ...MOVE_KINDS.flatMap(k => DIRS.map(d => `${k} ${d}` as const)),
    'torch', 'block', 'stop'];

export const isMineAction = (s: string): s is MineAction => (ACTIONS as readonly string[]).includes(s);

/** moveOf: the move of a move action, else null. */
export function moveOf(a: string | null | undefined): Move | null {
    if (!a) return null;
    const [kind, dir] = a.split(' ');
    return kind && dir && isMoveKind(kind) && isDir(dir) ? { kind, dir } : null;
}
export const moveAction = (m: Move): MoveAction => `${m.kind} ${m.dir}`;
export const isMove = (a: string | null | undefined): a is MoveAction => moveOf(a) !== null;
/** kindOf: the action's first word (collect, tunnel, down, up, torch, block, stop). */
export const kindOf = (a: MineAction): MoveKind | 'collect' | 'torch' | 'block' | 'stop' =>
    a.split(' ')[0] as MoveKind | 'collect' | 'torch' | 'block' | 'stop';

export const QUESTIONS = {
    Action: { criteria: ACTIONS.slice(), instructions: 'Which step should I take?', type: 'choice' },
    Hazard: { criteria: null, instructions: 'Lava or water is next to me.', type: 'noul' },
} as const satisfies Questions;

/** QUESTIONS_V2 adds Unload: whether to empty the pack into the home chest. */
export const QUESTIONS_V2 = {
    ...QUESTIONS,
    Unload: { criteria: null, instructions: 'I should go and empty my pack into the home chest now.', type: 'noul' },
} as const satisfies Questions;
