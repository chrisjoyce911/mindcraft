// The follow model's step decision: ask Move and Hazard about one window and read the answer. The job
// (jobs/follow.ts) carries the old follow.js branches out (wait counting, the veto, stepping, the fallback).
// Pure: the client is passed in.

import type { ModelDecider } from '../../types/models.js';
import { read, type FollowRead } from './answer.js';
import { FOLLOW_QUESTIONS } from './questions.js';
import type { FollowWindow } from './render.js';

export * from './render.js';
export * from './questions.js';
export * from './rules.js';
export * from './answer.js';

/** decideFollowStep asks the follow task about the window; a throw or no reply reads as no-answer. */
export async function decideFollowStep(window: FollowWindow, client: ModelDecider): Promise<FollowRead> {
    const r = await client.decide('follow', window.state, FOLLOW_QUESTIONS).catch(() => null);
    return read(r);
}
