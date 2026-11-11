// What andy says when a Laya job ends without doing it (commands/actions.js runJob).

const JOB_VERB = { layaCraft: 'make', layaGather: 'get', layaMine: 'mine', layaFarm: 'farm', hunt: 'hunt for' };

// jobFailedMessage: what andy says when a job ends without its goal, e.g.
// "I couldn't make 1 wooden_sword: take planks failed."
export function jobFailedMessage(job, result, r = {}) {
    const [item, n] = job.name === 'hunt' ? [job.args?.[1], job.args?.[2]] : [job.args?.[0], job.args?.[1]];
    const what = [Number.isFinite(+n) && n != null ? n : null, item == null ? null : String(item).replace(/_/g, ' ')]
        .filter(x => x != null && x !== '').join(' ');
    const verb = JOB_VERB[job.name] || 'finish';
    let why = typeof result?.reason === 'string' && result.reason ? result.reason
        : r.success === false ? 'something went wrong' : '';
    why = why.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
    return `I couldn't ${verb}${what ? ' ' + what : ''}${why ? ': ' + why : ''}.`;
}
