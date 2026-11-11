// Mindserver-compatible socket.io server (bot-harness spec, test/fixtures/harness-contract):
// listen-to-agents → state-update every second; agents-status; bot-output; send-message;
// get-settings; start-agent. Plus a minimal status page (Q7) from the same full state.
import http from 'http';
import { Server, type Socket } from 'socket.io';

export interface AgentLink {
    name: string;
    inGame(): boolean;
    /** the full state, or null when not in game */
    state(): unknown | null;
    settings(): unknown;
    /** a message as if `from` said it */
    message(from: string, message: string): void;
    start(): void;
    stop(): void;
}

export interface HarnessServer { io: Server; http: http.Server; output(text: string): void; statusChanged(): void; close(): Promise<void>; port: number }

export function startHarness(port: number, agent: AgentLink, log: (m: string) => void = console.log): Promise<HarnessServer> {
    const server = http.createServer((req, res) => {
        if (req.url === '/state.json') {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ agent: agent.name, inGame: agent.inGame(), state: agent.state() }));
            return;
        }
        if (req.url === '/' || req.url === '/index.html') {
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(STATUS_PAGE.replace('__AGENT__', agent.name));
            return;
        }
        res.statusCode = 404; res.end('not found');
    });
    const io = new Server(server);
    const listeners = new Set<Socket>();
    let timer: NodeJS.Timeout | null = null;

    const statusList = () => [{ name: agent.name, in_game: agent.inGame(), viewerPort: null, socket_connected: true }];
    const tick = () => {
        const states: Record<string, unknown> = {};
        if (agent.inGame()) {
            try { const s = agent.state(); if (s) states[agent.name] = s; } catch (e) { states[agent.name] = { error: String(e) }; }
        }
        for (const l of listeners) l.emit('state-update', states);
    };

    io.on('connection', socket => {
        socket.emit('agents-status', statusList());
        socket.on('listen-to-agents', () => {
            listeners.add(socket);
            timer ??= setInterval(tick, 1000);
        });
        socket.on('disconnect', () => {
            listeners.delete(socket);
            if (!listeners.size && timer) { clearInterval(timer); timer = null; }
        });
        socket.on('get-settings', (name: string, cb?: (r: unknown) => void) => {
            if (typeof cb !== 'function') return;
            cb(name === agent.name ? { settings: agent.settings() } : { error: `Agent '${name}' not found.` });
        });
        socket.on('send-message', (name: string, data: { from?: string; message?: string }) => {
            if (name !== agent.name) { log(`Agent ${name} not in game, cannot send message via MindServer.`); return; }
            try { agent.message(String(data?.from ?? ''), String(data?.message ?? '')); } catch (e) { log(`send-message failed: ${String(e)}`); }
        });
        socket.on('start-agent', (name: string) => { if (name === agent.name) agent.start(); });
        socket.on('stop-agent', (name: string) => { if (name === agent.name) agent.stop(); });
    });

    return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, 'localhost', () => {
            const addr = server.address();
            const bound = typeof addr === 'object' && addr ? addr.port : port;
            log(`MindServer running on port ${bound} on host localhost`);
            resolve({
                io, http: server, port: bound,
                output: text => { io.emit('bot-output', agent.name, text); },
                statusChanged: () => { io.emit('agents-status', statusList()); },
                close: () => new Promise<void>(r => { if (timer) clearInterval(timer); io.close(() => r()); }),
            });
        });
    });
}

const STATUS_PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>__AGENT__ status</title><style>
:root{--bg:#fff;--fg:#1d1d1f;--mut:#6e6e73;--card:#f5f5f7}
@media (prefers-color-scheme:dark){:root{--bg:#111;--fg:#eee;--mut:#999;--card:#1c1c1e}}
body{background:var(--bg);color:var(--fg);font:14px/1.4 system-ui,sans-serif;margin:16px}
.card{background:var(--card);border-radius:8px;padding:12px;margin:8px 0}h1{font-size:18px}.m{color:var(--mut)}pre{white-space:pre-wrap;margin:0}
</style></head><body><h1>__AGENT__</h1><div id="s" class="card m">connecting…</div><div class="card"><pre id="inv"></pre></div>
<script>
async function t(){try{const r=await (await fetch('/state.json')).json();const s=r.state;
if(!r.inGame||!s){document.getElementById('s').textContent='not in game';return}
const g=s.gameplay,p=g.position;document.getElementById('s').textContent=
(s.action.isIdle?'Idle':s.action.current)+' · health '+g.health+' food '+g.hunger+' · '+p.x+' '+p.y+' '+p.z+' · '+g.timeLabel;
document.getElementById('inv').textContent=JSON.stringify({inventory:s.inventory.counts,places:s.places,nearby:s.nearby},null,1)}catch(e){document.getElementById('s').textContent='bot not reachable'}}
t();setInterval(t,1000)</script></body></html>`;
