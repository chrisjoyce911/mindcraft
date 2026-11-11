// The chores v2 questions (laya-go games/chores/v2 Questions): Skill and Target, the same for every state.
import { choice } from '../skill/index.js';
import { CHORE_SKILLS, CHORE_TARGETS } from '../../types/chores.js';

export function choresQuestions() {
    return {
        Skill: choice('Which skill should I use next?', CHORE_SKILLS),
        Target: choice('On what?', CHORE_TARGETS),
    };
}
