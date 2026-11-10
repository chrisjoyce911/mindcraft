// The chat LLM switch: settings.llm (default true, upstream behaviour). With
// it false the chat LLM is out of the loop:
//   - player chat goes only to the Laya command model; chat, unsure and
//     unknown messages get a short canned reply (command.js CANNED);
//   - system and self messages (mode interrupt auto-messages, death,
//     conversation timeouts, init_message) and other bots' messages never
//     reach the LLM: an interrupted Laya job resumes by itself, a death is
//     announced and everything stops;
//   - no self-prompting (!goal), no memory summaries, no bot-to-bot LLM
//     talk, no !newAction code writing, no NPC goal setting, no vision;
//   - !commands typed by players still work (except those needing the LLM).
// Pure: no mineflayer, so it is tested on its own (test/llm_gate.test.js).

// llmOn is whether the chat LLM may be asked.
export function llmOn(settings) {
    return settings?.llm !== false;
}

// NEEDS_LLM are the commands that only work with the LLM.
export const NEEDS_LLM = new Set(['!newAction', '!goal']);

export const NO_LLM_REPLY = "I can't do that one: my chat brain is switched off. Plain commands work, e.g. follow me, mine 8 iron.";

// route decides where a message goes:
//   'command'   a player typed a !command: run it
//   'refuse'    a player typed a !command that needs the LLM, which is off
//   'laya'      ask the Laya command model (a player's plain chat)
//   'canned'    reply with the canned line (LLM off, no command model)
//   'llm'       the LLM handles it (the upstream path)
//   'drop'      nobody answers (LLM off: system, self and other bots)
// m: {llm, selfPrompt, fromOtherBot, userCommand (the !command named or
// null), commandTask (the Laya command task is on)}.
export function route(m) {
    const fromPlayer = !m.selfPrompt && !m.fromOtherBot;
    if (fromPlayer && m.userCommand) return !m.llm && NEEDS_LLM.has(m.userCommand) ? 'refuse' : 'command';
    if (m.llm) return fromPlayer && m.commandTask ? 'laya' : 'llm';
    if (!fromPlayer) return 'drop';
    return m.commandTask ? 'laya' : 'canned';
}

// deathMessage is what the bot says after dying with the LLM off.
export function deathMessage(pos, cause) {
    const at = pos ? `${Math.floor(pos.x)} ${Math.floor(pos.y)} ${Math.floor(pos.z)}` : 'an unknown place';
    const why = cause ? ` (${cause})` : '';
    return `I died at ${at}${why}. I've stopped; my things are there for a few minutes.`;
}
