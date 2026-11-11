#!/usr/bin/env node
// The layer rule (design §3): a layer imports only itself and the layers below it; log and home
// import only types and core; nothing imports the old bot (../src outside bot/).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ORDER = ['types', 'core', 'world', 'sensors', 'models', 'actuators', 'jobs', 'chores', 'director', 'command', 'harness', 'main'];
const SIDE = { log: ['types', 'core', 'log'], home: ['types', 'core', 'log', 'home'] };
const layerOf = rel => { const top = rel.split(path.sep)[0]; return top.endsWith('.ts') ? top.replace(/\.ts$/, '') : top; };

function allowed(from, to) {
    if (from === to) return true;
    if (SIDE[from]) return SIDE[from].includes(to);
    if (SIDE[to]) return ORDER.indexOf(from) > ORDER.indexOf('core');
    const a = ORDER.indexOf(from), b = ORDER.indexOf(to);
    return a >= 0 && b >= 0 && b <= a;
}

const problems = [];
const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []);
for (const file of walk(ROOT)) {
    const rel = path.relative(ROOT, file);
    const from = layerOf(rel);
    if (!ORDER.includes(from) && !SIDE[from]) { problems.push(`${rel}: unknown layer ${from}`); continue; }
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
        const spec = m[1] || m[2];
        if (!spec.startsWith('.')) continue;
        const target = path.resolve(path.dirname(file), spec);
        const trel = path.relative(ROOT, target);
        if (trel.startsWith('..')) { problems.push(`${rel}: imports ${spec} outside bot/src`); continue; }
        const to = layerOf(trel);
        if (!allowed(from, to)) problems.push(`${rel}: ${from} may not import ${to} (${spec})`);
    }
}
if (problems.length) { console.error('dependency rule broken:\n  ' + problems.join('\n  ')); process.exit(1); }
console.log(`dependency rule ok (${walk(ROOT).length} files)`);
