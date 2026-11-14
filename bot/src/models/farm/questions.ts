// The farm questions (laya-go games/farm/prompt): Action, Item and Target (v1), with v2's actions and Unload (v2).
import type { Questions } from '../../types/models.js';
import { ACTIONS, ACTIONS_V2, MAX_CELLS, NONE, SIZE } from './data.js';
import type { FarmSituation } from './render.js';
import { BY_DISTANCE, at, cellName, isGrowing, isRipe, nearest, nearestDry, type GridPos } from './view.js';
import type { CellCode } from './data.js';

const interesting = (c: CellCode) => isRipe(c) || isGrowing(c) || c === 'F' || c === 'D' || c === 'G';

/** targetOptions: the Target question's options (laya-go rules.TargetOptions). */
export function targetOptions(s: FarmSituation): string[] {
    const pick = new Set<number>();
    const key = (p: GridPos) => p.z * SIZE + p.x;
    for (const m of [isRipe, (c: CellCode) => c === 'F', (c: CellCode) => c === 'D', (c: CellCode) => c === 'G', isGrowing]) {
        const p = nearest(s.grid, m);
        if (p) pick.add(key(p));
    }
    // v2 (a crop is set): the nearest dry ground, a pond's place
    if (s.crop) {
        const p = nearestDry(s.grid);
        if (p) pick.add(key(p));
    }
    for (const p of BY_DISTANCE) {
        if (pick.size >= MAX_CELLS) break;
        if (interesting(at(s.grid, p))) pick.add(key(p));
    }
    const out: string[] = BY_DISTANCE.filter(p => pick.has(key(p))).map(p => cellName(p.x, p.z));
    return [...out, ...s.animals.map(h => h.kind), NONE];
}

/** itemOptions: the Item question's options: the carried items, then none. */
export function itemOptions(s: FarmSituation): string[] {
    return [...s.carry.map(c => c.item), NONE];
}

const UNLOAD_TEXT = 'I should go and empty my pack into the home chest now.';

/** questions: prompt v1's three questions. */
export function questions(s: FarmSituation): Questions {
    return {
        Action: { criteria: ACTIONS.slice(), instructions: 'What should I do next on the farm?', type: 'choice' },
        Item: { criteria: itemOptions(s), instructions: 'Which item should I use?', type: 'choice' },
        Target: { criteria: targetOptions(s), instructions: 'Which cell or animals?', type: 'choice' },
    };
}

/** questionsV2: v1's questions with the v2 actions, and Unload. */
export function questionsV2(s: FarmSituation): Questions {
    return {
        ...questions(s),
        Action: { criteria: ACTIONS_V2.slice(), instructions: 'What should I do next on the farm?', type: 'choice' },
        Unload: { criteria: null, instructions: UNLOAD_TEXT, type: 'noul' },
    };
}
