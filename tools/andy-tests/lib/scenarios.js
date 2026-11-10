// Scenarios: test/game/scenarios.json. A scenario is data:
//   { name, tags, description, requires (Laya tasks), timeout (ms),
//     grace, settle (waiting for idle), setup [steps], action [steps],
//     wait (false: no wait for idle after the action), checks [checks],
//     cleanup [steps] }
// Strings may hold templates, filled at the test's start from andy's block
// position: {x} {y+1} {z-3}, and the names {andy} and {tester}.
import fs from 'fs';
import { CHECKS } from './checks.js';

// One key of each step names its kind.
export const STEPS = {
    cmd: 'a slash command run by tester ("/give {andy} bread 4")',
    say: 'tester says this in game chat',
    andy: 'a message (usually a !command) sent to andy through the mindserver, from tester',
    wait: 'pause this many ms',
    waitIdle: 'wait for andy to be idle (true, or {timeout, grace, settle})',
    waitFor: 'wait for andy\'s state: {stat, min, max} | {item, min, max} | {entity, present} | {action}',
    waitReply: 'wait for a line from andy matching this regex',
    waitLog: 'wait for a laya log entry {task, match}',
    tp: 'teleport tester: "x y z" (templates) or {dx, dy, dz} from andy',
    walk: 'tester walks {dx, dz} from where it stands, or to "x y z"',
    snapshot: 'save andy\'s inventory, position, health and food under this label',
    anchor: 'take andy\'s current block as {x} {y} {z} again',
};
const STEP_OPTIONS = new Set(['timeout', 'repeat', 'optional', 'note', 'replyMs']);

export function stepKind(step) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) return null;
    const kinds = Object.keys(step).filter(k => k in STEPS);
    return kinds.length === 1 ? kinds[0] : null;
}

const TEST_KEYS = new Set(['name', 'tags', 'description', 'requires', 'timeout', 'grace', 'settle', 'setup', 'action', 'wait', 'checks', 'cleanup', 'manual']);

// validate returns a list of problems (empty when the document is good).
export function validate(doc) {
    const problems = [];
    if (!doc || !Array.isArray(doc.tests)) return ['the file needs a "tests" array'];
    const seen = new Set();
    doc.tests.forEach((t, i) => {
        const where = `test ${i + 1}${t?.name ? ` (${t.name})` : ''}`;
        if (!t || typeof t !== 'object') { problems.push(`${where}: not an object`); return; }
        if (!t.name || typeof t.name !== 'string') problems.push(`${where}: needs a name`);
        else if (!/^[a-z0-9][a-z0-9-]*$/.test(t.name)) problems.push(`${where}: name should be lower-case-with-dashes`);
        else if (seen.has(t.name)) problems.push(`${where}: duplicate name`);
        seen.add(t.name);
        for (const k of Object.keys(t)) if (!TEST_KEYS.has(k)) problems.push(`${where}: unknown key "${k}"`);
        if (t.tags != null && (!Array.isArray(t.tags) || t.tags.some(x => typeof x !== 'string'))) problems.push(`${where}: tags must be a list of strings`);
        if (t.timeout != null && !(t.timeout > 0)) problems.push(`${where}: timeout must be a positive number of ms`);
        if (t.requires != null && !Array.isArray(t.requires)) problems.push(`${where}: requires must be a list of Laya task names`);
        for (const part of ['setup', 'action', 'cleanup']) {
            const steps = t[part] ?? [];
            if (!Array.isArray(steps)) { problems.push(`${where}: ${part} must be a list of steps`); continue; }
            steps.forEach((s, j) => {
                const kind = stepKind(s);
                if (!kind) { problems.push(`${where}: ${part} step ${j + 1} needs exactly one of ${Object.keys(STEPS).join(', ')} (got ${JSON.stringify(s)})`); return; }
                for (const k of Object.keys(s)) if (k !== kind && !STEP_OPTIONS.has(k)) problems.push(`${where}: ${part} step ${j + 1}: unknown option "${k}"`);
            });
        }
        if (!Array.isArray(t.action) || t.action.length === 0) problems.push(`${where}: needs an action (a list of steps)`);
        if (!Array.isArray(t.checks)) problems.push(`${where}: needs checks (a list, may be empty)`);
        else t.checks.forEach((c, j) => {
            if (!c || !CHECKS[c.type]) problems.push(`${where}: check ${j + 1} has unknown type ${JSON.stringify(c?.type)} (known: ${Object.keys(CHECKS).join(', ')})`);
        });
    });
    return problems;
}

export function parseScenarios(text, source = 'scenarios') {
    let doc;
    try { doc = JSON.parse(text); } catch (e) { throw new Error(`${source}: not valid JSON: ${e.message}`); }
    const problems = validate(doc);
    if (problems.length) throw new Error(`${source}:\n  ${problems.join('\n  ')}`);
    const defaults = { timeout: 120000, grace: 5000, settle: 3000, ...(doc.defaults || {}) };
    const tests = doc.tests.map(t => ({ tags: [], requires: [], setup: [], cleanup: [], ...t }));
    return { defaults, tests };
}

export function loadScenarios(file) {
    return parseScenarios(fs.readFileSync(file, 'utf8'), file);
}

// select picks tests in file order: by names (all must exist), then by tag.
// "full" means every test; "quick" only those tagged quick.
export function select(tests, { names = [], tag = null } = {}) {
    let out = tests;
    if (names.length) {
        const missing = names.filter(n => !tests.some(t => t.name === n));
        if (missing.length) throw new Error(`No test named ${missing.join(', ')}. Tests: ${tests.map(t => t.name).join(', ')}`);
        out = tests.filter(t => names.includes(t.name));
    }
    if (tag && tag !== 'all') out = out.filter(t => t.tags.includes(tag));
    return out;
}

// expand fills templates in strings (deeply in objects and arrays).
// ctx: {x, y, z, andy, tester}.
export function expand(value, ctx) {
    if (typeof value === 'string') {
        return value.replace(/\{(x|y|z)([+-]\d+)?\}|\{(andy|tester)\}/g, (m, axis, off, name) => {
            if (name) return ctx[name] ?? m;
            if (ctx[axis] == null) return m;
            return String(ctx[axis] + (off ? Number(off) : 0));
        });
    }
    if (Array.isArray(value)) return value.map(v => expand(v, ctx));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expand(v, ctx)]));
    return value;
}

// coords parses "x y z" into numbers.
export function coords(text) {
    const p = String(text).trim().split(/\s+/).map(Number);
    if (p.length !== 3 || p.some(n => !Number.isFinite(n))) throw new Error(`not "x y z" coordinates: ${text}`);
    return { x: p[0], y: p[1], z: p[2] };
}

// describeStep: one line for reports and the manual checklist.
export function describeStep(step) {
    const kind = stepKind(step);
    const v = step[kind];
    const rep = step.repeat > 1 ? ` (×${step.repeat})` : '';
    switch (kind) {
    case 'cmd': return `${v}${rep}`;
    case 'say': return `say "${v}"`;
    case 'andy': return `to andy: ${v}`;
    case 'wait': return `wait ${v / 1000}s`;
    case 'waitIdle': return 'wait until andy is idle';
    case 'waitFor': return `wait for ${JSON.stringify(v)}`;
    case 'waitReply': return `wait for andy to say /${v}/`;
    case 'waitLog': return `wait for laya-${v.task} ${JSON.stringify(v.match ?? {})}`;
    case 'tp': return `tp tester ${typeof v === 'string' ? v : JSON.stringify(v)}`;
    case 'walk': return `tester walks ${typeof v === 'string' ? 'to ' + v : JSON.stringify(v)}`;
    case 'snapshot': return `snapshot "${v}"`;
    case 'anchor': return 'take andy\'s position again';
    default: return JSON.stringify(step);
    }
}
