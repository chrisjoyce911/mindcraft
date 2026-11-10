// The MCP tools: thin wrappers over a Session, each call appended to the
// session report so ad-hoc sessions can be reviewed afterwards.
import { loadScenarios, select, describeStep } from './scenarios.js';
import { describeCheck } from './checks.js';
import { runTest, runSuite } from './runner.js';
import { Report } from './report.js';
import { TASKS } from './logs.js';

const num = (description, extra = {}) => ({ type: 'number', description, ...extra });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required, additionalProperties: false });

export function defineTools(session, { scenariosPath, newReport = title => new Report(session.config.reportDir, { title, now: session.now }) } = {}) {
    const scenarios = () => loadScenarios(scenariosPath || session.config.scenarios);
    const tools = [
        {
            name: 'connect',
            description: 'Connect to the mindserver and join the world as tester (tools also connect on first use). Returns where, andy\'s mindserver status and the session report path.',
            inputSchema: obj({ tester: { type: 'boolean', description: 'also join the world as tester (default true)' } }),
            run: a => session.connect({ tester: a.tester !== false }),
        },
        {
            name: 'disconnect',
            description: 'Leave the world (tester quits) and close the mindserver connection.',
            inputSchema: obj(),
            run: () => session.disconnect(),
        },
        {
            name: 'andy_status',
            description: 'Andy\'s live state from the mindserver: position, health, food, current action (Idle or e.g. action:layaMine), inventory, equipment, blocks at feet/head, nearby players and mob types, modes; tester\'s position and distance.',
            inputSchema: obj(),
            run: () => session.status(),
        },
        {
            name: 'andy_say',
            description: 'Tester says this in game chat (so it goes through andy\'s chat handling: the Laya command model or the LLM, speaker tester). Returns andy\'s replies within wait_ms.',
            inputSchema: obj({ text: str('what tester says, e.g. "andy make a wooden pickaxe"'), wait_ms: num('how long to collect replies (default 4000)') }, ['text']),
            run: a => session.say(a.text, a.wait_ms ?? 4000),
        },
        {
            name: 'andy_command',
            description: 'Send andy a message through the mindserver as tester (send-message), usually a !command such as !layaMine("coal", 3), !stop, !inventory. Returns andy\'s replies within wait_ms.',
            inputSchema: obj({ command: str('e.g. !setHomeChest or !layaFarm("wheat", 5)'), wait_ms: num('how long to collect replies (default 3000)') }, ['command']),
            run: a => session.command(a.command, a.wait_ms ?? 3000),
        },
        {
            name: 'server_command',
            description: 'Run a slash command, e.g. /time set day, /give andy bread 4, /fill ..., /summon zombie ~3 ~ ~. On the test world it goes over RCON unless it uses ~, ^ or @s (then tester types it, so ~ is relative to tester); elsewhere tester types it (cheats must be on). Returns the server\'s reply lines and which way it went (via).',
            inputSchema: obj({ command: str('the command, with or without the leading /'), wait_ms: num('how long to collect replies (default 1000)') }, ['command']),
            run: a => session.serverCommand(a.command, a.wait_ms ?? 1000),
        },
        {
            name: 'tester_tp',
            description: 'Teleport tester: to x y z, or relative to andy by dx dy dz (default 2 blocks east of andy) so "come here", "follow me" and !setHomeChest have a speaker beside him.',
            inputSchema: obj({ x: num('absolute x'), y: num('absolute y'), z: num('absolute z'), dx: num('blocks east of andy'), dy: num('blocks above andy'), dz: num('blocks south of andy') }),
            run: a => session.tp(a),
        },
        {
            name: 'tester_move',
            description: 'Tester walks (pathfinder, falling back to small teleports): by dx/dz from where it stands, or to x y z. For follow tests.',
            inputSchema: obj({ dx: num('blocks east'), dz: num('blocks south'), x: num('target x'), y: num('target y'), z: num('target z'), timeout_ms: num('default 20000') }),
            run: a => session.move({ ...a, timeoutMs: a.timeout_ms ?? 20000 }),
        },
        {
            name: 'andy_wait_idle',
            description: 'Wait until andy\'s current action ends (idle for settle_ms after being busy, or idle after grace_ms if he never got busy), or timeout. Returns idle/timedOut, the action labels seen and his chat meanwhile.',
            inputSchema: obj({ timeout_ms: num('default 120000'), grace_ms: num('default 5000'), settle_ms: num('default 3000') }),
            run: a => session.waitIdle({ timeout: a.timeout_ms ?? 120000, grace: a.grace_ms ?? 5000, settle: a.settle_ms ?? 3000 }),
        },
        {
            name: 'andy_chat_log',
            description: 'Andy\'s recent chat (mindserver bot-output and game chat), Brisbane times. Only lines since this session connected.',
            inputSchema: obj({ limit: num('default 30'), since_s: num('only the last N seconds') }),
            run: a => session.chatLog({ limit: a.limit ?? 30, sinceMs: a.since_s != null ? a.since_s * 1000 : null }),
        },
        {
            name: 'andy_logs',
            description: `Recent Laya step log entries (bots/andy/logs/laya-<task>.jsonl), oldest first, the long state text cut to 400 chars unless full. Tasks: ${TASKS.join(', ')}.`,
            inputSchema: obj({
                task: str('one task, or all when omitted', { enum: TASKS }), limit: num('default 20'), since_s: num('only the last N seconds'),
                since: str('ISO time to start from'), match: { description: 'fields to match, e.g. {"outcome":"fallback"} or {"action":"/harvest|plant/"}, or a text to find', type: ['object', 'string'] },
                full: { type: 'boolean', description: 'include the whole state text' },
            }),
            run: a => session.logs({ task: a.task ?? null, limit: a.limit ?? 20, sinceMs: a.since_s != null ? a.since_s * 1000 : null, since: a.since ?? null, match: a.match ?? null, full: !!a.full }),
        },
        {
            name: 'inventory_snapshot',
            description: 'Save andy\'s inventory, position, health and food under a label, for inventory_diff later.',
            inputSchema: obj({ label: str('name, default "snap"') }),
            run: a => session.snapshot(a.label || 'snap'),
        },
        {
            name: 'inventory_diff',
            description: 'Change in andy\'s inventory (and health, food, position) from a snapshot to another snapshot or to now.',
            inputSchema: obj({ from: str('snapshot label'), to: str('snapshot label (default: now)') }, ['from']),
            run: a => session.diff(a.from, a.to || null),
        },
        {
            name: 'chest_contents',
            description: 'Tester teleports onto the chest (or barrel) at x y z, opens it and returns {item: count}. Tester stays there.',
            inputSchema: obj({ x: num('x'), y: num('y'), z: num('z') }, ['x', 'y', 'z']),
            run: a => session.chestContents(a.x, a.y, a.z),
        },
        {
            name: 'world_status',
            description: 'The local test world (tools/test-world, 127.0.0.1:25566): container state, ready, players online, seed, template, the named sites, the test bot (andy started by bot_start) and which world the tools are using now.',
            inputSchema: obj(),
            run: () => session.worldStatus(),
        },
        {
            name: 'world_start',
            description: 'Start the local test world and wait until it accepts players (about 10 s), then point the tools at it (tester joins it, server commands go over RCON).',
            inputSchema: obj(),
            run: () => session.worldStart(),
        },
        {
            name: 'world_stop',
            description: 'Stop the local test world (the world is saved). Tester leaves; andy is kicked.',
            inputSchema: obj(),
            run: () => session.worldStop(),
        },
        {
            name: 'world_reset',
            description: 'Put the test world back to its template (stop, replace the world, start, wait; about 10 s), then start andy again through the mindserver if the test bot is running and wait until he is back in game. Snapshots are cleared.',
            inputSchema: obj({ andy_timeout_ms: num('how long to wait for andy to be back in game (default 90000)') }),
            run: a => session.worldReset({ andyTimeoutMs: a.andy_timeout_ms ?? 90000 }),
        },
        {
            name: 'bot_start',
            description: 'Start Mindcraft (andy) against the test world in the background, without touching settings.js: host 127.0.0.1:25566, mindserver 8091, the rest of this checkout\'s settings.js. Waits until andy is in game. Output goes to the test world\'s logs directory.',
            inputSchema: obj({ profiles: { type: 'array', items: { type: 'string' }, description: 'profile files (default ["./andy.json"])' }, wait_ms: num('how long to wait for andy in game (default 120000; 0 = don\'t wait)') }),
            run: a => session.botStart({ profiles: a.profiles, waitMs: a.wait_ms ?? 120000 }),
        },
        {
            name: 'bot_stop',
            description: 'Stop the test bot started by bot_start (Mindcraft and its agents).',
            inputSchema: obj(),
            run: () => session.botStop(),
        },
        {
            name: 'use_world',
            description: 'Point the tools at a world: "test" (the local test world) or "settings" (your own world from settings.js, e.g. a LAN world). Drops the current connections.',
            inputSchema: obj({ world: str('test or settings', { enum: ['test', 'settings'] }) }, ['world']),
            run: a => session.useWorld(a.world),
        },
        {
            name: 'site_tp',
            description: 'Test world only: teleport andy and/or tester to a named site (base, farm, dry, mine, cave; see world_status). With who "both" tester lands 2 blocks east of andy.',
            inputSchema: obj({ site: str('site name'), who: str('andy, tester or both (default)', { enum: ['andy', 'tester', 'both'] }) }, ['site']),
            run: a => session.siteTp(a.site, { who: a.who || 'both' }),
        },
        {
            name: 'list_tests',
            description: 'The scripted scenarios in order (test/game/scenarios.json), with tags, timeouts, required Laya tasks, steps and checks.',
            inputSchema: obj({ tag: str('only tests with this tag, e.g. quick, full, farm'), detail: { type: 'boolean', description: 'include steps and checks' } }),
            run: a => {
                const { tests } = scenarios();
                return select(tests, { tag: a.tag || null }).map(t => ({
                    name: t.name, tags: t.tags, timeout_s: (t.timeout ?? 120000) / 1000, requires: t.requires, description: t.description,
                    ...(a.detail ? { setup: t.setup.map(describeStep), action: t.action.map(describeStep), checks: t.checks.map(describeCheck), cleanup: t.cleanup.map(describeStep) } : {}),
                }));
            },
        },
        {
            name: 'run_test',
            description: 'Run one scripted scenario (setup, action, wait, checks, cleanup) and return its result: status, reason, each check, andy\'s replies, inventory change, laya log lines. Written to the session report.',
            inputSchema: obj({ name: str('scenario name (see list_tests)') }, ['name']),
            run: async a => {
                const { tests, defaults } = scenarios();
                const [t] = select(tests, { names: [a.name] });
                await session.connect();
                const r = await runTest(session, t, { defaults, report: session.report });
                return { ...r, report: session.report.paths() };
            },
        },
        {
            name: 'run_suite',
            description: 'Run scenarios in order, by tag (quick, full, …) and/or names, waiting for andy to be idle between tests. Writes its own report (bots/andy/logs/game-tests/<Brisbane time>.md/.jsonl) and returns the summary, each test\'s status and reason, and the report path. Slow tags (full) can take an hour.',
            inputSchema: obj({ tag: str('e.g. quick or full'), names: { type: 'array', items: { type: 'string' }, description: 'scenario names' } }),
            run: async a => {
                const { tests, defaults } = scenarios();
                const picked = select(tests, { names: a.names || [], tag: a.tag || null });
                if (!picked.length) throw new Error('No tests selected.');
                await session.connect();
                const report = newReport(`Andy game tests: ${a.tag || (a.names || []).join(', ')}`);
                return runSuite(session, picked, { defaults, report });
            },
        },
    ];
    return tools;
}

// callTool runs a tool by name, appending the call to the session report.
export async function callTool(tools, session, name, args = {}) {
    const tool = tools.find(t => t.name === name);
    if (!tool) throw new Error(`Unknown tool ${name}`);
    const t = session.now();
    try {
        const result = await tool.run(args || {});
        logCall(session, name, args, true, result, t);
        return result;
    } catch (e) {
        logCall(session, name, args, false, e.message, t);
        throw e;
    }
}

function logCall(session, tool, args, ok, result, t) {
    try {
        const ms = session.now() - t;
        session.report.event({ type: 'tool', tool, args, ok, ms, result: ok ? result : undefined, error: ok ? undefined : result });
        const short = JSON.stringify(ok ? result : result) ?? '';
        session.report.md(`- \`${tool}\` ${JSON.stringify(args)} → ${ok ? '' : '**error** '}${short.slice(0, 300).replace(/\n/g, ' ')}${short.length > 300 ? '…' : ''} (${ms} ms)\n`);
    } catch { /* never let reporting break a tool */ }
}
