// Abort helpers: every wait in the bot takes an AbortSignal (design §4).

/** Thrown (rejected) by the helpers below when their signal aborts. */
export class AbortedError extends Error {
    constructor(message = 'aborted') { super(message); this.name = 'AbortedError'; }
}
export class TimeoutError extends Error {
    constructor(ms: number) { super(`timed out after ${ms} ms`); this.name = 'TimeoutError'; }
}

export function isAborted(e: unknown): boolean {
    return e instanceof AbortedError || (e instanceof Error && e.name === 'AbortError');
}

/** sleep resolves after ms, or rejects with AbortedError as soon as the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new AbortedError());
        const timer = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
        const onAbort = () => { clearTimeout(timer); reject(new AbortedError()); };
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

/**
 * race settles with the promise, or rejects with AbortedError as soon as the signal aborts (the
 * promise keeps running; its late result is ignored). onAbort runs once on abort, e.g. to stop the body.
 */
export function race<T>(promise: Promise<T>, signal: AbortSignal, onAbort?: () => void): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const abort = () => { try { onAbort?.(); } catch { /* the stop is best effort */ } reject(new AbortedError()); };
        if (signal.aborted) { promise.catch(() => {}); return abort(); }
        signal.addEventListener('abort', abort, { once: true });
        promise.then(
            v => { signal.removeEventListener('abort', abort); resolve(v); },
            e => { signal.removeEventListener('abort', abort); reject(e); },
        );
    });
}

/** withTimeout: a signal that aborts when the parent does or after ms (reason: TimeoutError). */
export function withTimeout(ms: number, parent?: AbortSignal): { signal: AbortSignal; dispose: () => void } {
    const c = new AbortController();
    const timer = setTimeout(() => c.abort(new TimeoutError(ms)), ms);
    const onParent = () => c.abort(parent?.reason ?? new AbortedError());
    if (parent?.aborted) onParent(); else parent?.addEventListener('abort', onParent, { once: true });
    return { signal: c.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', onParent); } };
}

/** timedOut: true when the signal aborted because of withTimeout's deadline. */
export function timedOut(signal: AbortSignal): boolean {
    return signal.aborted && signal.reason instanceof TimeoutError;
}
