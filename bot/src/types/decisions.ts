// One union per model question, exactly the model's answer words (design §3.1).
export const ACTIVITIES = ['continue', 'defend', 'flee', 'eat', 'heal', 'unload', 'resume', 'idle'] as const;
export type Activity = (typeof ACTIVITIES)[number];
export interface Decision<A extends string> { answer: A; source: 'model' | 'rules'; rule?: string; p?: number; why?: string }
