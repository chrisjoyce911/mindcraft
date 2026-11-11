// Laya decision models: the settings that name a task's server and model, the questions sent to
// /v1/decisions and the normal form of their answers (design §6). Task names stay strings here; the
// per-task unions come with the renderers (3.2).

export type QuestionType = 'choice' | 'score' | 'noul';

export interface Question {
    type: QuestionType;
    /** Options in the order they are asked (choice/score), a map of option → description, or null (noul). */
    criteria: readonly string[] | Readonly<Record<string, unknown>> | null;
    instructions?: string;
    [k: string]: unknown;
}
export type Questions = Readonly<Record<string, Question>>;

export interface ServerConfig { url: string }
export interface TaskConfig {
    enabled: boolean;
    server: string;
    /** Empty or missing: discover the server's only decisions model. */
    model?: string;
    /** Prompt version to write when the server does not name one. */
    prompt?: string;
    timeout_ms?: number;
    min_confidence?: number;
}
export interface DecisionModelsConfig {
    servers: Record<string, ServerConfig>;
    tasks: Record<string, TaskConfig>;
}

/** Why decide() returned null. `disabled` is not counted as asked. */
export const MODEL_FAIL_REASONS = ['disabled', 'timeout', 'unreachable', 'http', 'malformed', 'no_model'] as const;
export type ModelFailReason = (typeof MODEL_FAIL_REASONS)[number];

export interface NoulAnswer {
    type: 'noul';
    probability: number;
    top: 'true' | 'false';
    topProbability: number;
    confident: boolean;
}
export interface OptionAnswer {
    type: 'choice' | 'score';
    top: string;
    topProbability: number;
    probabilities: Record<string, number>;
    confident: boolean;
}
export type NormalAnswer = NoulAnswer | OptionAnswer;

export interface DecideResult {
    model: string;
    ms: number;
    answers: Record<string, NormalAnswer>;
}

export interface TaskStats {
    asked: number;
    answered: number;
    failed: Record<ModelFailReason, number>;
    meanMs: number;
    maxMs: number;
}

export interface DecisionSample { state: string; questions: Questions }

export interface CheckReport {
    task: string;
    enabled: boolean;
    url: string | null;
    reachable: boolean;
    models: string[];
    model: string | null;
    /** The served prompt version for the model, or null when the server names none. */
    prompt: string | null;
    answer: { ms: number; answers: Record<string, NormalAnswer> } | null;
    error: string | null;
}

/** What the model modules need from the client (models/client.ts LayaClient satisfies it; tests pass fakes). */
export interface ModelDecider {
    decide(task: string, state: string, questions: Questions): Promise<DecideResult | null>;
}
