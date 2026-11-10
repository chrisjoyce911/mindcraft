// scrubMemory takes requests and jobs out of the LLM's memory summary: the
// summary once said "chrisjoyce911 frequently requests coal" and "asked to
// mine 9 iron", and the LLM then started a coal job on its own. Jobs live on
// the job stack (laya/director.js), never in memory. Pure.

const REQUEST = /\b(requests?|requested|requesting|asks?|asked|asking|wants?|wanted|told me to|commanded)\b/i;
const JOB = /\b(mine|mining|mined|gather|collect|craft|crafted|farm|get|give|gave|sent|bring)\b/i;
const HABIT = /\b(frequently|often|usually|always|keeps?|repeatedly)\b/i;

// scrubMemory drops each sentence that records a request or a job (a
// request verb with a job verb, or a habit with a request verb).
export function scrubMemory(text) {
    if (!text) return text;
    // sentences end at . ! or ? (and a closing quote) before a capital
    const sentences = String(text).split(/(?<=[.!?]["']?)\s+(?=[A-Z])/);
    return sentences.filter(s => !(REQUEST.test(s) && (JOB.test(s) || HABIT.test(s)))).join(' ').trim();
}
