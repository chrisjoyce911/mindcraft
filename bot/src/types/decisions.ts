// One union per model question, exactly the model's answer words (design §3.1), and the rule names
// each model's rules report (laya-go games/<task>/rules).

// ---- director (shared spec v1.3) ----
export const ACTIVITIES = ['continue', 'defend', 'flee', 'eat', 'heal', 'unload', 'resume', 'idle'] as const;
export type Activity = (typeof ACTIVITIES)[number];
/** The director answers that run a safety activity (they pause a job under them, design §5.2). */
export const SAFETY_ACTIVITIES = ['defend', 'flee', 'eat', 'heal'] as const;
export type SafetyActivity = (typeof SAFETY_ACTIVITIES)[number];
export const isSafety = (a: string): a is SafetyActivity => (SAFETY_ACTIVITIES as readonly string[]).includes(a);
/**
 * The runner a safety answer starts: its own name, except flee with Danger fire/fluid/drowning, which runs
 * escape (design §5.3 "flee-danger → escape actuator"; not a new answer word).
 */
export type ActivityRunnerName = SafetyActivity | 'escape';
/** The director prompt versions the bot can write (a served model on an older one is sent its own text). */
export const DIRECTOR_PROMPTS = ['v1', 'v1.2', 'v1.3'] as const;
export type DirectorPrompt = (typeof DIRECTOR_PROMPTS)[number];
/** The director rules, in order (laya-go games/director/rules). */
export const DIRECTOR_RULES = ['flee-danger', 'flee-hostile', 'flee-creeper', 'flee-low', 'flee-ranged', 'defend', 'defend-player', 'heal',
    'eat-hungry', 'unload-full', 'unload-near', 'unload-valuables', 'resume-paused', 'continue', 'resume-failed', 'idle-failed', 'eat-idle', 'idle'] as const;
export type DirectorRule = (typeof DIRECTOR_RULES)[number];

// ---- eat (prompt v1) ----
/** The eat rules, in order (laya-go games/eat/rules.Rules). */
export const EAT_RULES = ['no-food', 'emergency', 'danger', 'full', 'no-need', 'fits', 'least-waste', 'bad', 'no-good-food'] as const;
export type EatRule = (typeof EAT_RULES)[number];

// ---- defend (prompt v1) ----
export const DEFEND_ACTIONS = ['fight', 'flee', 'shield', 'backoff', 'eat', 'ignore'] as const;
export type DefendAction = (typeof DEFEND_ACTIONS)[number];
/** The defend rules, in order (laya-go games/defend/rules.Rules). */
export const DEFEND_RULES = ['calm', 'creeper-near', 'creeper-strong', 'creeper-shoot', 'creeper-away', 'low-eat', 'low-backoff', 'low-flee',
    'outnumbered', 'melee', 'shoot', 'close-in', 'kite'] as const;
export type DefendRule = (typeof DEFEND_RULES)[number];

// ---- why the rules decided although a model was asked (today's log words) ----
/**
 * no-answer: the client returned null; low-confidence: an answer below min_confidence; disagree: eat's two
 * answers contradict; veto: a safety rule refused the answer (the reason is in `veto`); nothing-to-defend,
 * not-hungry: a director answer that can't be acted on; malformed: an answer word outside the option set.
 */
export const FALLBACK_WHYS = ['no-answer', 'low-confidence', 'disagree', 'veto', 'nothing-to-defend', 'not-hungry', 'malformed'] as const;
export type FallbackWhy = (typeof FALLBACK_WHYS)[number];

/** Why a follow step fell back to the pathfinder follow (the old follow.js FALLBACK_REASONS, in order). */
export const FOLLOW_FALLBACKS = ['no-answer', 'low-confidence', 'wait', 'veto', 'stuck'] as const;
export type FollowFallback = (typeof FOLLOW_FALLBACKS)[number];

/** Eat's safety vetoes (the old bot's eat.js safety()). */
export const EAT_VETOES = ['not-carried', 'rare', 'danger', 'full', 'bad'] as const;
export type EatVeto = (typeof EAT_VETOES)[number];
/** Defend's safety vetoes (the old bot's defend.js safety()). */
export const DEFEND_VETOES = ['ignore-threat', 'no-apple', 'no-target', 'no-arrows'] as const;
export type DefendVeto = (typeof DEFEND_VETOES)[number];

/**
 * A model's decision: the answer acted on, who decided it, the rules' rule name, the state text sent (or
 * that would have been sent), and, when a model was asked, its top probability; `why` says why the rules
 * decided although a model was asked.
 */
export interface Decision<A extends string, R extends string = string> {
    answer: A;
    source: 'model' | 'rules';
    rule: R;
    state: string;
    p?: number;
    why?: FallbackWhy;
    /** The model's own answer word when the rules decided against it. */
    model?: string;
    veto?: string;
    override?: string;
}
