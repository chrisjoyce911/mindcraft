// Runtime events, queued; they never act directly (design §5.1).
export type BotEvent =
    | { kind: 'chat'; from: string; message: string; via: 'game' | 'harness' }
    | { kind: 'spawn' } | { kind: 'death' } | { kind: 'end'; reason: string };
