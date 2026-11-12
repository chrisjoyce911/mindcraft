import type { JobSpec } from './jobs.js';
// What a player can ask, after the command model or the legacy parser (bot-commands spec).
export type Command =
    | { kind: 'job'; job: JobSpec }
    | { kind: 'stop' }
    | { kind: 'chores'; on: boolean }
    | { kind: 'inventory' }
    | { kind: 'reply'; text: string }
    | { kind: 'ignore' };

/** How a player's message reached andy: open chat or a whisper (/msg, /tell). */
export type Channel = 'chat' | 'whisper';

/** Where andy's replies go: open chat, or a whisper back to the player who whispered. */
export type ReplyRoute = { kind: 'chat' } | { kind: 'whisper'; to: string };
