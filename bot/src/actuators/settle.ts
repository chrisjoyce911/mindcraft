// settle (the old craft.js settle): wait until done() holds (the inventory shows what a craft made), polling every
// step ms for at most ms; then a short quiet time so slot updates still on the way arrive before the next step
// reads the inventory or starts another craft. Returns whether done() held. An abort ends the wait at once.

export interface SettleOptions {
    ms?: number;
    step?: number;
    quiet?: number;
    signal?: AbortSignal;
    /** The wait (tests pass a fake clock); resolves false when the signal aborted. */
    sleep?: (ms: number) => Promise<unknown>;
}

/** wait: true after ms, false as soon as the signal aborts (never rejects). */
export const wait = (ms: number, signal?: AbortSignal) => new Promise<boolean>(resolve => {
    if (signal?.aborted) return resolve(false);
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(true); }, ms);
    const onAbort = () => { clearTimeout(t); resolve(false); };
    signal?.addEventListener('abort', onAbort, { once: true });
});

export async function settle(done: () => boolean, { ms = 3000, step = 50, quiet = 150, signal, sleep }: SettleOptions = {}): Promise<boolean> {
    const pause = sleep ?? ((t: number) => wait(t, signal));
    let waited = 0;
    while (!done() && waited < ms && !signal?.aborted) { await pause(step); waited += step; }
    const ok = done();
    if (quiet > 0 && !signal?.aborted) await pause(quiet);
    return ok;
}
