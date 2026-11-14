// The mine model (laya-go games/mine, prompt v1/v2, rules v2.1): typed port of the old bot's mine_state.js,
// mine_plan.js and the pure parts of mine.js.
export * from './data.js';
export * from './view.js';
export * from './questions.js';
export * from './render.js';
export * from './answer.js';
export * from './rules.js';
export * from './plan.js';
export * from './geometry.js';
export { decideMineStep, MAX_DROP_REDECIDES, type MineStepInput, type MineStepDecision, type MineWhy, type MineVeto, type MineModelFields } from './decide.js';
