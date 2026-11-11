// What andy says when a job ends without doing it (the old bot's src/agent/laya/job_message.js), e.g.
// "I couldn't make 1 wooden sword: take planks failed."
import type { JobSpec } from '../types/index.js';

const VERB: Partial<Record<JobSpec['kind'], string>> = { craft: 'make', gather: 'get', mine: 'mine', farm: 'farm', hunt: 'hunt for',
    huntFood: 'hunt for', gatherSkill: 'get', place: 'place' };

/** what: the count and item a job is about, as the old args gave them ([item, n]; a hunt's [mob, item, n]). */
function what(spec: JobSpec): [string | null, number | null] {
    switch (spec.kind) {
        case 'craft': case 'gather': case 'give': case 'store': return [spec.item, spec.count];
        case 'hunt': return [spec.item, spec.count];
        case 'mine': return [spec.ore, spec.count === 'forever' ? null : spec.count];
        case 'farm': return [spec.crop, spec.goal === 'forever' || !('count' in spec.goal) ? null : spec.goal.count];
        case 'cobble': return ['cobblestone', spec.count];
        case 'eat': return [spec.item, null];
        case 'huntFood': return ['food', spec.goal];
        case 'gatherSkill': return [spec.target, spec.goal];
        case 'place': return [`the ${spec.item}`, null];
        default: return [null, null];
    }
}

/** jobFailedMessage: what andy says when a job ends without its goal; reason (may be empty) says why. */
export function jobFailedMessage(spec: JobSpec, reason: string | null | undefined): string {
    const [item, n] = what(spec);
    const words = [n !== null && Number.isFinite(n) ? String(n) : null, item == null ? null : item.replace(/_/g, ' ')]
        .filter((x): x is string => x !== null && x !== '').join(' ');
    const verb = VERB[spec.kind] ?? 'finish';
    const why = (reason ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `I couldn't ${verb}${words ? ' ' + words : ''}${why ? ': ' + why : ''}.`;
}
