// npm run laya:check [task]
//
// Checks the decision-model tasks in settings.decision_models: the server and
// whether it's reachable, the decision models it lists, the model the task
// uses, and, for tasks with a sample request, a real answer and its time. Run
// it after changing which model answers a task. Exits 1 if an enabled task
// can't be answered.

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import settings from '../../settings.js';
import { createLayaClient } from './laya.js';

// SAMPLES are known requests per task, used to ask a real question.
export const SAMPLES = {
    follow: new URL('../../test/fixtures/laya-follow-v1/request.json', import.meta.url),
    'follow:v2': new URL('../../test/fixtures/laya-follow-v2/request.json', import.meta.url),
};

// loadSample returns a task's sample request, matching its prompt version.
export function loadSample(task, prompt = 'v1') {
    const path = SAMPLES[prompt === 'v1' ? task : `${task}:${prompt}`] ?? SAMPLES[task];
    if (!path) return null;
    const { state, questions } = JSON.parse(readFileSync(path, 'utf8'));
    return { state, questions };
}

// formatReport writes one task's check as lines of text.
export function formatReport(r) {
    const lines = [`${r.task} (${r.enabled ? 'enabled' : 'off'})`];
    lines.push(`  server   ${r.url ?? '—'}  ${r.reachable ? 'reachable' : 'NOT reachable'}`);
    if (r.reachable) lines.push(`  models   ${r.models.length ? r.models.join(', ') : 'no decision models'}`);
    if (r.model) lines.push(`  uses     ${r.model}`);
    if (r.answer) {
        const parts = Object.entries(r.answer.answers).map(([name, a]) =>
            a.type === 'noul' ? `${name} ${a.probability.toFixed(2)}` : `${name} ${a.top} ${a.topProbability.toFixed(2)}${a.confident ? '' : ' (not confident)'}`);
        lines.push(`  sample   ${parts.join(', ')} in ${r.answer.ms} ms`);
    }
    if (r.error) lines.push(`  error    ${r.error}`);
    return lines.join('\n');
}

// run checks the named task, or every configured task, and returns the exit
// status.
export async function run(args, config = settings.decision_models, out = console.log) {
    const client = createLayaClient(() => config, { log: () => {} });
    const tasks = args.length ? args : Object.keys(config?.tasks || {});
    if (!tasks.length) {
        out('no decision-model tasks in settings.decision_models');
        return 1;
    }
    let status = 0;
    for (const task of tasks) {
        const r = await client.check(task, loadSample(task, config?.tasks?.[task]?.prompt));
        out(formatReport(r));
        if (r.enabled && (r.error || !r.reachable)) status = 1;
        if (!config?.tasks?.[task]) status = 1;
    }
    return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    process.exitCode = await run(process.argv.slice(2));
}
