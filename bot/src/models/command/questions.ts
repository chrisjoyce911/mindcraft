// The command questions: Addressed (noul), Command, Item, Tier and Count (choice), in the old request's key
// order. The wording is the same in every prompt; the options are the prompt's.

import type { Questions } from '../../types/models.js';
import { COUNTS, TIERS, commandWords, itemWords, type CommandPrompt } from './vocab.js';

/** commandQuestions returns prompt v's five questions. */
export function commandQuestions(v: CommandPrompt) {
    return {
        Addressed: { criteria: null, instructions: 'The message is for me.', type: 'noul' },
        Command: { criteria: commandWords(v).slice(), instructions: 'What should I do?', type: 'choice' },
        Item: { criteria: itemWords(v).slice(), instructions: 'Which item or mob?', type: 'choice' },
        Tier: { criteria: TIERS.slice(), instructions: 'Which tier?', type: 'choice' },
        Count: { criteria: COUNTS.slice(), instructions: 'How many?', type: 'choice' },
    } as const satisfies Questions;
}
