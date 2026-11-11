// Actuator outcomes: {ok:true} or {ok:false, reason} with a closed set of reasons (bot-body spec).
export const FAIL_REASONS = [
    'cancelled', 'timeout', 'no-path', 'unreachable', 'missing-item', 'no-block', 'inventory-full', 'stuck', 'error',
] as const;
export type FailReason = (typeof FAIL_REASONS)[number];
export type Outcome = { ok: true } | { ok: false; reason: FailReason; detail?: string };

export const OK: Outcome = Object.freeze({ ok: true });
export function fail(reason: FailReason, detail?: string): Outcome {
    return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}
