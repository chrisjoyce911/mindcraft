// The mine step's decision (the decision block of the old bot's mine.js loop, as one pure function): the rules'
// answer (re-decided while it would step onto a drop), the model's answer when it is asked (v1 always; v2 with a
// plan step), the veto and override order, and the Unload choice. The model decides; the rules are the fallback:
//   no answer                       → no-answer      (walking back to the plan: walk-first, not asked)
//   not confident                   → low-confidence
//   unsafe or onto a drop           → veto (+ the veto word: fluid, fluid behind, bedrock, no floor, drop)
//   collect with nothing in sight   → nothing-seen
//   block with nothing to block     → nothing-to-block
//   torch with none carried         → no-torches
//   stop while a step is possible   → stop-early
//   off the plan when it is safe    → off-plan
// Unload (v2, a home chest known, not backing off): a full pack always; else the model when it is sure, else the
// rule; ore in sight with room in the pack is collected first; never with lava or water touching.
import type { ModelDecider } from '../../types/models.js';
import { readMine } from './answer.js';
import { isMove, kindOf, moveOf, QUESTIONS, QUESTIONS_V2, type MineAction, type MoveAction } from './questions.js';
import { state, type MineSituation } from './render.js';
import { decide, unload, type MineDecision } from './rules.js';
import { copyView, dug, setCell, touching, unsafe, type Unsafe, type View } from './view.js';

export const MAX_DROP_REDECIDES = 12;

export type MineWhy = 'no-answer' | 'walk-first' | 'low-confidence' | 'veto' | 'nothing-seen' | 'nothing-to-block' | 'no-torches'
    | 'stop-early' | 'off-plan';
export type MineVeto = Exclude<Unsafe, ''> | 'drop';

export interface MineStepInput {
    /** The situation as read (its view is the world as read; v2: with the pack fields). */
    s: MineSituation;
    /** A plan is followed (v2). Without a plan step (andy walks back to it) the model isn't asked. */
    hasPlan: boolean;
    /** isDrop: the move would leave andy over more than max_drop air (the world's dropBelow). */
    isDrop(a: MoveAction): boolean;
    client: ModelDecider | null;
    /** Unload may be chosen this step (v2 with a plan step, a home chest known, not backing off). */
    unloadAllowed: boolean;
}

/** What the model said, as the mine log keeps it. */
export interface MineModelFields { model: MineAction; p: number; hazard?: number; ms: number }

export interface MineStepDecision {
    /** The rules' answer (after the drop re-decides). */
    rule: MineDecision;
    /** The state text sent (the world as read). */
    state: string;
    /** The view the rules decided on: the moves onto a drop have their floor taken away. */
    view: View;
    /** The rules' moves dropped for a drop under them, in order. */
    dropped: MoveAction[];
    /** The model was asked. */
    asked: boolean;
    said?: MineModelFields;
    veto?: MineVeto;
    action: MineAction;
    source: 'model' | 'rules';
    why: MineWhy | null;
    /** The Unload choice, when allowed: its probability (undefined: not answered), whether to go now, later. */
    unload?: { p?: number; go: boolean; later: boolean; source: 'model' | 'rules' };
    /** A floor veto this step (no floor, a drop, or the plan step itself has none): the descent may stop. */
    floorVeto: boolean;
}

/** decideMineStep decides one mine step. */
export async function decideMineStep(i: MineStepInput): Promise<MineStepDecision> {
    const { s } = i;
    const dropMove = (a: MineAction) => isMove(a) && i.isDrop(a);
    let view = s.view;
    const dropped: MoveAction[] = [];
    let rule = decide(s);
    while (isMove(rule.action) && dropMove(rule.action) && dropped.length < MAX_DROP_REDECIDES) {
        dropped.push(rule.action);
        view = copyView(view);
        setCell(view, dug(moveOf(rule.action)!).floor, 'A');
        rule = decide({ ...s, view }); // the state text keeps the world as read
    }
    const text = state(s);
    let action: MineAction = rule.action, source: 'model' | 'rules' = 'rules', why: MineWhy | null = null;
    const asked = !i.hasPlan || !!s.plan;
    const d: MineStepDecision = { rule, state: text, view, dropped, asked, action, source, why, floorVeto: false };
    let r = null;
    if (asked) r = i.client ? readMine(await i.client.decide('mine', text, s.plan ? QUESTIONS_V2 : QUESTIONS).catch(() => null)) : null;
    else why = 'walk-first';
    if (!r) why = why || 'no-answer';
    else {
        const top = r.action;
        d.said = { model: top, p: r.p, ...(r.hazard !== undefined ? { hazard: r.hazard } : {}), ms: r.ms };
        const veto: MineVeto | '' = unsafe(view, moveOf(top)) || (dropMove(top) ? 'drop' : '');
        if (!r.confident) why = 'low-confidence';
        else if (veto) { why = 'veto'; d.veto = veto; }
        else if (top === 'collect' && !s.seen) why = 'nothing-seen';
        else if (top === 'block' && (!touching(view).length || !s.blocks)) why = 'nothing-to-block';
        else if (top === 'torch' && !s.torches) why = 'no-torches';
        else if (top === 'stop' && rule.action !== 'stop') why = 'stop-early';
        else if (s.plan && isMove(top) && top !== s.plan && rule.rule === 'follow-plan') why = 'off-plan';
        else { action = top; source = 'model'; }
    }
    Object.assign(d, { action, source, why });

    if (i.unloadAllowed && s.plan && s.home != null) {
        const u = r?.unload;
        const want = s.free === 0 || (u?.confident ? u.probability >= 0.5 : unload(s));
        // ore in sight and room for it: collect it first
        const later = want && s.seen > 0 && (s.free ?? 0) > 0;
        d.unload = { ...(u ? { p: u.probability } : {}), go: want && !later && !touching(view).length, later, source: u?.confident ? 'model' : 'rules' };
    }

    // floor vetoes in a row on the staircase: the ground below is a cave or a drop (the job stops the descent)
    const planMove = moveOf(s.plan);
    const planFloor = !!planMove && (unsafe(s.view, planMove) === 'no floor' || i.isDrop(s.plan!));
    d.floorVeto = d.veto === 'no floor' || d.veto === 'drop' || dropped.length > 0 || planFloor;
    return d;
}

export { kindOf };
