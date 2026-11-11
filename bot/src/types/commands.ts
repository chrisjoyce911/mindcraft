import type { JobSpec } from './jobs.js';
// What a player can ask, after the command model or the legacy parser (bot-commands spec).
export type Command =
    | { kind: 'job'; job: JobSpec }
    | { kind: 'stop' }
    | { kind: 'chores'; on: boolean }
    | { kind: 'inventory' }
    | { kind: 'reply'; text: string }
    | { kind: 'ignore' };
