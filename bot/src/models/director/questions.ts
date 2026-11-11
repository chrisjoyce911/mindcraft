// The director's question (shared spec v1–v1.3: one question, the same words in every version).

import { ACTIVITIES, DIRECTOR_PROMPTS, type DirectorPrompt } from '../../types/decisions.js';
import type { Questions } from '../../types/models.js';

/** QUESTIONS is the director's question set; key order is the golden request's. */
export const QUESTIONS = {
    Activity: { criteria: ACTIVITIES, instructions: 'What should I do now?', type: 'choice' },
} as const satisfies Questions;

/** promptOf turns the served (or configured) prompt version into one the renderer writes: v1, v1.2, else v1.3. */
export function promptOf(version: string | null | undefined): DirectorPrompt {
    return (DIRECTOR_PROMPTS as readonly string[]).includes(version ?? '') ? (version as DirectorPrompt) : 'v1.3';
}
