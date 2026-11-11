// A minimal MCP server over stdio: newline-delimited JSON-RPC 2.0 with
// initialize, ping, tools/list and tools/call. (No SDK, so nothing is added
// to the node_modules the bot shares.)

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

// createHandler returns handle(message) → response object or null (for
// notifications). call(name, args) runs a tool and returns any JSON value.
export function createHandler({ tools, call, info = { name: 'andy', version: '0.1.0' }, instructions = '' }) {
    const ok = (id, result) => ({ jsonrpc: '2.0', id, result });
    const err = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    return async function handle(msg) {
        if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
            return msg && 'id' in msg ? err(msg.id ?? null, -32600, 'Invalid Request') : null;
        }
        const isNote = !('id' in msg);
        const { id, method, params = {} } = msg;
        if (isNote) return null; // notifications/initialized, cancelled, …
        switch (method) {
        case 'initialize': {
            const asked = params.protocolVersion;
            return ok(id, {
                protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
                capabilities: { tools: { listChanged: false } },
                serverInfo: info,
                ...(instructions ? { instructions } : {}),
            });
        }
        case 'ping': return ok(id, {});
        case 'tools/list':
            return ok(id, { tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
        case 'tools/call': {
            if (!tools.some(t => t.name === params.name)) return err(id, -32602, `Unknown tool: ${params.name}`);
            try {
                const result = await call(params.name, params.arguments || {});
                const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
                return ok(id, { content: [{ type: 'text', text: text ?? 'null' }], isError: false });
            } catch (e) {
                return ok(id, { content: [{ type: 'text', text: `Error: ${e.message}` }], isError: true });
            }
        }
        default: return err(id, -32601, `Method not found: ${method}`);
        }
    };
}

// serve reads JSON lines from input and writes responses to output. Requests
// are handled concurrently (a long run_suite doesn't block status calls).
export function serve({ handle, input, output, onClose = () => {} }) {
    let buf = '';
    const write = obj => output.write(JSON.stringify(obj) + '\n');
    input.setEncoding?.('utf8');
    input.on('data', chunk => {
        buf += chunk;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            let msg;
            try { msg = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
            Promise.resolve(handle(msg)).then(r => { if (r) write(r); }, e => write({ jsonrpc: '2.0', id: msg.id ?? null, error: { code: -32603, message: e.message } }));
        }
    });
    input.on('end', onClose);
}
