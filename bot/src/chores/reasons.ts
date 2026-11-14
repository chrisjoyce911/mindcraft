// Why a chore run failed, as the Last line's closed list says it (skills-spec v1 §1; v2.go Reasons). The skill jobs
// (hunt, gather, place) and the chores jobs (cook, unload, kit, sleep, rest) already end with a listed reason; the
// older jobs (mine, farm, craft, the legacy collect) end with free text, mapped here by an explicit table (no pickaxe
// or tool → no_tool, full → full, nothing found → no_source, a missing item → missing_<kind>, else stuck). A run cut
// short (a player's command, stop or death) is interrupted. Nothing outside the list reaches Last.
import { isChoreReason, missing, type ChoreReason } from '../types/chores.js';
export { itemKind, missing } from '../types/chores.js';
import type { JobEnd } from '../types/jobs.js';

/**
 * The free-text reasons, tested in order (the first that matches wins): the mine job's finish reasons, the farm
 * job's FarmEndReason, the craft job's failedEnd reasons, collectBlocks' messages and the actuators' outcomes.
 */
export const REASON_TABLE: readonly { test: RegExp; reason: ChoreReason | ((m: RegExpExecArray) => ChoreReason) }[] = [
    // a missing item: the place skill (missing_<item>), the craft job from a chore (missing_<kind>), the old need_<item>
    { test: /^(?:missing|need)_(.+)$/, reason: m => missing(m[1]!) },
    // no tool: the mine job ("needs a stone_pickaxe"), collectBlocks ("Don't have right tools", "Don't have bucket"), the farm job
    { test: /needs a \w*pickaxe|don't have right tools|don't have bucket|^no hoe$|^no_tool$/i, reason: 'no_tool' },
    // full
    { test: /^full$|inventory is full|no free slot/i, reason: 'full' },
    // nothing found: collectBlocks ("No stone nearby to collect."), the mine job's ran-out ("no coal after 300 steps",
    // "plan: …" when the mine is used up), the farm job's no water / no seeds / nothing to do, give_up
    { test: /^no_source$|nearby to collect|^no \w+ after \d+ steps$|^plan: |^no water$|^no seeds$|^nothing to do$|could not find|no \w+ near/i, reason: 'no_source' },
    { test: /^no_spot$/, reason: 'no_spot' },
    { test: /^timeout$|max[- ]steps|^count not reached in time$/i, reason: 'timeout' },
    // hurt with nothing to eat (the mine job)
    { test: /hurt with no food/i, reason: 'missing_food' },
    // stuck: steps failing in a row, trapped, an unsafe mine, a model that doesn't answer, the craft task off …
    { test: /steps failed in a row|trapped|unsafe|^stuck$|no answer|no-answer|task is off|doesn't know|failed/i, reason: 'stuck' },
];

/** choreReason: a JobEnd that isn't done as the Last line's reason (null for done). */
export function choreReason(end: JobEnd): ChoreReason | null {
    switch (end.how) {
        case 'done': return null;
        case 'cancelled': return 'interrupted';
        case 'failed': case 'blocked': {
            const r = end.reason.trim();
            if (isChoreReason(r)) return r;
            for (const row of REASON_TABLE) {
                const m = row.test.exec(r);
                if (m) return typeof row.reason === 'function' ? row.reason(m) : row.reason;
            }
            return 'stuck';
        }
    }
}
