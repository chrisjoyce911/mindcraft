// The farm step's decision (the decision block of the old bot's farm.js loop, as one pure function, in the old
// order): the model's answer when it is sure; else with v2 the rules', with v1 a wait (low-confidence). A banned
// answer (it failed or was vetoed just now) gives way to the rules' answer, or a wait. No water and nothing growing:
// a wait becomes a pond on the nearest dry ground (with a water bucket), else find_water. A crop asked for: plant its
// seed. Then the item the answer needs and the veto. The job only carries the result out.
import { CROP_OF, NEEDS, NONE, SEEDS, isSeed, type FarmAction, type FarmCrop } from './data.js';
import type { FarmAsked } from './answer.js';
import type { FarmSituation } from './render.js';
import { decide, needed, veto, type FarmVeto } from './rules.js';
import { besideHole, growing, has, hasWater, parseCellName, pondCell } from './view.js';

/**
 * Who chose the step: the model, the rules (v2, unsure), a wait for a v1 unsure answer, the rules for a banned answer,
 * a dry wait made a pond, a find_water with water in view that isn't a water problem (6.2b: seeds, or the rules).
 */
export type FarmSource = 'model' | 'rules' | 'low-confidence' | 'banned' | 'dry' | 'water-near';

export interface FarmStepInput {
    s: FarmSituation;
    /** The model's answer (null: none; v2 only, v1's no-answer is the job's). */
    asked: FarmAsked | null;
    v2: boolean;
    crop: FarmCrop;
    /** isBanned: the action failed or was vetoed on that target just now. */
    isBanned(action: FarmAction, target: string): boolean;
}

/** What the model said, as the farm log keeps it: p and ms when it was sure, model_action too when it wasn't (v1). */
export interface FarmSaid { model_action?: string; p: number; ms: number }

export interface FarmStepDecision {
    /** What to do: act (an action on a cell or a herd), wait, or find water. */
    kind: 'act' | 'wait' | 'find_water';
    action: FarmAction;
    target: string;
    /** The answer's item (as logged). */
    item: string;
    /** The item the act uses (the crop's seed swapped in; the action's need when the answer names none). */
    use: string;
    source: FarmSource;
    /** The rules decided because the model wasn't sure (v2). */
    ruled: boolean;
    said?: FarmSaid;
    /** The banned answer ("action target"). */
    banned?: string;
    /** The item the answer needs that andy doesn't carry. */
    missing: string | null;
    veto: FarmVeto | null;
}

/** decideFarmStep decides one farm step on the situation read. */
export function decideFarmStep(i: FarmStepInput): FarmStepDecision {
    const { s, asked: r } = i;
    let action: FarmAction, target: string, item: string, source: FarmSource = 'model', ruled = false;
    let said: FarmSaid | undefined, banned: string | undefined;
    if (r && r.sure) {
        ({ action, target, item } = r);
        said = { p: r.p, ms: r.ms };
    } else if (i.v2) {
        ({ action, target, item } = decide(s));
        source = 'rules';
        ruled = true;
    } else {
        [action, target, item, source] = ['wait', NONE, NONE, 'low-confidence'];
        if (r) said = { model_action: r.action, p: r.p, ms: r.ms };
    }
    if (action !== 'wait' && i.isBanned(action, target)) {
        banned = `${action} ${target}`;
        const rule = decide(s);
        if (rule.action !== 'wait' && !i.isBanned(rule.action, rule.target)) ({ action, target, item } = rule);
        else [action, target, item] = ['wait', NONE, NONE];
        source = 'banned';
    }
    // 6.2b: find_water with water in the view isn't a water problem (the play run's 408 trips to the same water):
    // with no seed to plant it's the crop's seed that's missing; else the rules' answer, or a wait
    if (action === 'find_water' && hasWater(s.grid)) {
        source = 'water-near';
        if (!SEEDS.some(x => has(s, x))) {
            const seed = CROP_OF[i.crop === 'any' ? 'wheat' : i.crop].seed;
            return { kind: 'act', action, target, item, use: seed, source, ruled, ...(said ? { said } : {}), ...(banned ? { banned } : {}),
                missing: seed, veto: null };
        }
        const rule = decide(s);
        if (rule.action !== 'find_water' && (rule.action === 'wait' || !i.isBanned(rule.action, rule.target))) ({ action, target, item } = rule);
        else [action, target, item] = ['wait', NONE, NONE];
    }
    const base = { target, item, ruled, ...(said ? { said } : {}), ...(banned ? { banned } : {}) };

    // no water to farm with and nothing growing: a pond on the nearest dry ground with a water bucket, else find water
    const dry = !hasWater(s.grid) && !growing(s.grid);
    if (action === 'wait' && dry && has(s, 'water_bucket')) {
        const pond = pondCell(s.grid, c => i.isBanned('pond', c) || besideHole(s, parseCellName(c)!));
        if (pond) [action, target, item, source] = ['pond', pond, 'water_bucket', 'dry'];
    }
    if (action === 'find_water' || (action === 'wait' && dry))
        return { ...base, kind: 'find_water', action: 'find_water', use: NONE, source, missing: null, veto: null };
    if (action === 'wait') return { ...base, kind: 'wait', action, use: NONE, source, missing: null, veto: null };

    // a crop asked for: plant its seed when andy has it
    let use = item;
    if (action === 'plant' && i.crop !== 'any' && isSeed(item) && item !== CROP_OF[i.crop].seed && has(s, CROP_OF[i.crop].seed)) use = CROP_OF[i.crop].seed;
    const missing = needed(s, action, use);
    if (use === NONE) use = NEEDS[action] ?? NONE;
    return { kind: 'act', action, target, item, use, source, ruled, ...(said ? { said } : {}), ...(banned ? { banned } : {}),
        missing, veto: missing ? null : veto(s, action, target, use) };
}
