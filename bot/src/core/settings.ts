// Settings: the checkout's settings.js merged with SETTINGS_JSON and the env overrides, as main.js
// does for the old bot (the tools/test-world launch contract), plus the profile from --profiles.
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

export interface Settings {
    host: string; port: number; minecraft_version: string; auth: 'offline' | 'microsoft';
    mindserver_port: number; profiles: string[]; profile: { name: string; [k: string]: unknown };
    [k: string]: unknown;
}

export function parseProfiles(argv: string[]): string[] {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--profiles') while (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out.push(argv[++i]!);
    }
    return out;
}

export async function loadSettings(repoRoot: string, argv: string[], env: NodeJS.ProcessEnv): Promise<Settings> {
    const file = path.join(repoRoot, 'settings.js');
    const base = fs.existsSync(file) ? { ...((await import(pathToFileURL(file).href)) as { default: Record<string, unknown> }).default } : {};
    const s: Record<string, unknown> = { ...base };
    const profiles = parseProfiles(argv);
    if (profiles.length) s.profiles = profiles;
    if (env.MINECRAFT_PORT) s.port = env.MINECRAFT_PORT;
    if (env.MINDSERVER_PORT) s.mindserver_port = env.MINDSERVER_PORT;
    if (env.SETTINGS_JSON) Object.assign(s, JSON.parse(env.SETTINGS_JSON) as Record<string, unknown>);
    const list = (s.profiles as string[] | undefined) ?? ['./andy.json'];
    // andy only, one process (Q5): the first profile
    const profile = JSON.parse(fs.readFileSync(path.resolve(repoRoot, list[0]!), 'utf8')) as Settings['profile'];
    return {
        ...s,
        host: String(s.host ?? '127.0.0.1'),
        port: Number(s.port ?? 25565),
        minecraft_version: String(s.minecraft_version ?? 'auto'),
        auth: (s.auth === 'microsoft' ? 'microsoft' : 'offline'),
        mindserver_port: Number(s.mindserver_port ?? 8080),
        profiles: list,
        profile,
    } as Settings;
}
