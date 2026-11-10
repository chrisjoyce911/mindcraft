/* global process */
// The real outside world for TestWorld and the bot: docker, the file system,
// RCON, a status ping. Unit tests pass fakes instead.
import { spawn } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import { Rcon } from './rcon.js';
import { stamp } from '../../andy-tests/lib/time.js';

export function run(cmd, args, { env = {}, cwd } = {}) {
    return new Promise(resolve => {
        const p = spawn(cmd, args, { env: { ...process.env, ...env }, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
        let stdout = '', stderr = '';
        p.stdout.on('data', d => { stdout += d; });
        p.stderr.on('data', d => { stderr += d; });
        p.on('error', e => resolve({ code: 127, stdout, stderr: `${stderr}${e.message}` }));
        p.on('close', code => resolve({ code, stdout, stderr }));
    });
}

// copyDir: an APFS clone (cp -c, instant and no extra disk) on macOS, a
// plain recursive copy elsewhere or if cloning fails.
export async function copyDir(from, to) {
    if (process.platform === 'darwin') {
        const r = await run('cp', ['-cR', from, to]);
        if (r.code === 0) return;
        fs.rmSync(to, { recursive: true, force: true });
    }
    fs.cpSync(from, to, { recursive: true });
}

export async function ping(host, port, timeout = 3000) {
    const { default: mc } = await import('minecraft-protocol');
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`no status reply from ${host}:${port}`)), timeout);
        mc.ping({ host, port, closeTimeout: timeout }, (err, res) => {
            clearTimeout(timer);
            if (err) reject(new Error(`${host}:${port}: ${err.message || err}`));
            else resolve({ version: res?.version?.name, players: res?.players });
        });
    });
}

export function realWorldDeps({ log = line => console.log(line) } = {}) {
    return {
        run, fs, copyDir, ping, log,
        makeRcon: o => new Rcon(o),
        randomSecret: () => crypto.randomBytes(24).toString('base64url'),
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        now: Date.now,
    };
}

// realBotDeps: the bot runs detached in its own process group, its output
// appended to a log file, so it outlives the MCP server call that started it.
export function realBotDeps() {
    return {
        fs,
        spawn: (cmd, args, { cwd, env, log }) => {
            const out = fs.openSync(log, 'a');
            const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', out, out] });
            child.unref();
            fs.closeSync(out);
            return child;
        },
        kill: (pid, sig) => process.kill(pid, sig),
        sleep: ms => new Promise(r => setTimeout(r, ms)),
        now: Date.now,
        stamp: () => stamp(),
    };
}
