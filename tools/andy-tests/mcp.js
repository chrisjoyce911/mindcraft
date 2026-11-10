#!/usr/bin/env node
// MCP server "andy" (stdio): drive andy live from Claude Code.
//   claude mcp add andy -- node /abs/path/to/mindcraft/tools/andy-tests/mcp.js
// stdout carries only JSON-RPC: every console line goes to stderr.
for (const k of ['log', 'info', 'warn', 'debug']) console[k] = (...a) => console.error(...a);

/* global process */
async function main() {
const { loadConfig } = await import('./lib/config.js');
const { Session } = await import('./lib/session.js');
const { realDeps } = await import('./lib/real.js');
const { defineTools, callTool } = await import('./lib/tools.js');
const { createHandler, serve } = await import('./lib/mcp_protocol.js');

const config = await loadConfig();
const session = new Session({ config, deps: realDeps(config) });
const tools = defineTools(session);

const instructions = `Controls the Mindcraft bot "${config.agent}" in the user's Minecraft world. The player "${config.tester}" (a mineflayer bot this server runs) joins the same world: server_command runs slash commands as ${config.tester} (cheats must be on), andy_say chats as ${config.tester}, andy_command sends !commands through the mindserver (port ${config.mindserverPort}). Tools connect on first use. Start with andy_status; use andy_wait_idle after giving andy a job, andy_logs to see the Laya model's steps, list_tests/run_test for scripted scenarios. Every call is logged to ${config.reportDir}. Times are Brisbane (AEST). The local test world (tools/test-world): world_status, world_start, world_reset (back to the template in ~10 s), bot_start (andy against it, settings.js untouched), site_tp to named sites; the world tools switch the session to it (use_world switches back). Now using: ${config.world === 'test' ? 'the test world' : 'settings.js'} (${config.host}:${config.port}).`;

const handle = createHandler({ tools, call: (name, args) => callTool(tools, session, name, args), instructions });
serve({
    handle, input: process.stdin, output: process.stdout,
    onClose: () => { session.disconnect(); process.exit(0); },
});
process.on('SIGINT', () => { session.disconnect(); process.exit(0); });
process.on('SIGTERM', () => { session.disconnect(); process.exit(0); });
process.on('unhandledRejection', e => console.error('andy mcp: unhandled', e));
}

main().catch(e => { console.error('andy mcp failed to start:', e); process.exit(1); });
