// The legacy `!name(args)` lines at the harness boundary (bot-commands spec): andy_command and the
// game scenarios send them. Parsed into the same typed Command the command model produces; nothing
// is evaluated. Kept: the 18 commands the command model emits (Q10). Grammar and argument checks
// as src/agent/commands/index.js parseCommandMessage.
import { ORES, CROPS, GATHER_GOALS, PLACE_ITEMS, type Command, type Ore, type Crop, type GatherGoal, type PlaceItem } from '../types/index.js';

const commandRegex = /!(\w+)(?:\(((?:-?\d+(?:\.\d+)?|true|false|"[^"]*")(?:\s*,\s*(?:-?\d+(?:\.\d+)?|true|false|"[^"]*"))*)\))?/;
const argRegex = /-?\d+(?:\.\d+)?|true|false|"[^"]*"/g;

type ParamType = 'string' | 'int' | 'float' | 'ItemName' | 'BlockName';
interface Param { name: string; type: ParamType; optional?: boolean; domain?: [number, number] }
type Arg = string | number;
interface Spec { params: Param[]; build: (a: Arg[], from: string) => Command | string }

const s = (v: Arg | undefined) => String(v ?? '');
const n = (v: Arg | undefined) => Number(v);
const P = (name: string, type: ParamType, extra: Partial<Param> = {}): Param => ({ name, type, ...extra });
const INF = Number.POSITIVE_INFINITY;

export const LEGACY_COMMANDS: Record<string, Spec> = {
    stop: { params: [], build: () => ({ kind: 'stop' }) },
    followPlayer: { params: [P('player_name', 'string'), P('follow_dist', 'float', { domain: [0, INF] })],
        build: a => ({ kind: 'job', job: { kind: 'follow', player: s(a[0]), distance: n(a[1]) } }) },
    goToPlayer: { params: [P('player_name', 'string'), P('closeness', 'float', { domain: [0, INF] })],
        build: a => ({ kind: 'job', job: { kind: 'come', player: s(a[0]), distance: n(a[1]) } }) },
    stay: { params: [P('type', 'int', { domain: [-1, Number.MAX_SAFE_INTEGER] })],
        build: a => ({ kind: 'job', job: { kind: 'stay', seconds: n(a[0]) } }) },
    inventory: { params: [], build: () => ({ kind: 'inventory' }) },
    layaChores: { params: [P('state', 'string')], build: a => {
        const v = s(a[0]).toLowerCase();
        if (v !== 'on' && v !== 'off') return `Error: Param 'state' must be on or off.`;
        return { kind: 'chores', on: v === 'on' };
    } },
    attack: { params: [P('type', 'string')], build: a => ({ kind: 'job', job: { kind: 'hunt', mob: s(a[0]), item: null, count: 1 } }) },
    hunt: { params: [P('mob', 'string'), P('item', 'string'), P('count', 'int', { domain: [1, 64] })],
        build: a => ({ kind: 'job', job: { kind: 'hunt', mob: s(a[0]), item: s(a[1]), count: n(a[2]) } }) },
    layaGather: { params: [P('item_name', 'string'), P('num', 'int', { domain: [1, 64] })],
        build: a => ({ kind: 'job', job: { kind: 'gather', item: s(a[0]), count: n(a[1]) } }) },
    collectBlocks: { params: [P('type', 'BlockName'), P('num', 'int', { domain: [1, Number.MAX_SAFE_INTEGER] })],
        build: a => ({ kind: 'job', job: { kind: 'gather', item: s(a[0]), count: n(a[1]), legacy: 'collectBlocks' } }) },
    layaMine: { params: [P('ore', 'string'), P('count', 'int', { domain: [1, 64], optional: true })], build: a => {
        const ore = s(a[0]);
        if (!(ORES as readonly string[]).includes(ore)) return `Error: unknown ore ${ore} (${ORES.join(', ')}).`;
        return { kind: 'job', job: { kind: 'mine', ore: ore as Ore, count: a[1] === undefined ? 'forever' : n(a[1]) } };
    } },
    layaFarm: { params: [P('crop', 'string', { optional: true }), P('count', 'string', { optional: true })], build: a => {
        const crop = a[0] === undefined ? 'any' : s(a[0]);
        if (crop !== 'any' && !(CROPS as readonly string[]).includes(crop)) return `Error: unknown crop ${crop} (${CROPS.join(', ')} or any).`;
        const c = a[1] === undefined ? 'any' : s(a[1]);
        if (c !== 'any' && !/^\d+$/.test(c)) return `Error: Param 'count' must be a number or any.`;
        return { kind: 'job', job: { kind: 'farm', crop: crop as Crop | 'any', goal: c === 'any' ? 'forever' : { count: Number(c) } } };
    } },
    setHomeChest: { params: [], build: () => ({ kind: 'job', job: { kind: 'home' } }) },
    layaCraft: { params: [P('item_name', 'string'), P('num', 'int', { domain: [1, 64] })],
        build: a => ({ kind: 'job', job: { kind: 'craft', item: s(a[0]), count: n(a[1]) } }) },
    craftRecipe: { params: [P('recipe_name', 'ItemName'), P('num', 'int', { domain: [1, Number.MAX_SAFE_INTEGER] })],
        build: a => ({ kind: 'job', job: { kind: 'craft', item: s(a[0]), count: n(a[1]), legacy: 'craftRecipe' } }) },
    givePlayer: { params: [P('player_name', 'string'), P('item_name', 'ItemName'), P('num', 'int', { domain: [1, Number.MAX_SAFE_INTEGER] })],
        build: a => ({ kind: 'job', job: { kind: 'give', player: s(a[0]), item: s(a[1]), count: n(a[2]) } }) },
    putInChest: { params: [P('item_name', 'ItemName'), P('num', 'int', { domain: [1, Number.MAX_SAFE_INTEGER] })],
        build: a => ({ kind: 'job', job: { kind: 'store', item: s(a[0]), count: n(a[1]) } }) },
    consume: { params: [P('item_name', 'ItemName')], build: a => ({ kind: 'job', job: { kind: 'eat', item: s(a[0]) } }) },
    // 5.5's skill jobs: harness and test entries only (chores, 5.6, is their real caller). layaGather stays the 5.1
    // craft-model gather, so the gather skill's trigger is layaGatherSkill.
    layaHunt: { params: [P('goal', 'int', { domain: [1, 1000] })], build: a => ({ kind: 'job', job: { kind: 'huntFood', goal: n(a[0]) } }) },
    layaGatherSkill: { params: [P('target', 'string'), P('goal', 'int', { domain: [1, 1000] })], build: a => {
        const t = s(a[0]);
        if (!(GATHER_GOALS as readonly string[]).includes(t)) return `Error: unknown gather target ${t} (${GATHER_GOALS.join(', ')}).`;
        return { kind: 'job', job: { kind: 'gatherSkill', target: t as GatherGoal, goal: n(a[1]) } };
    } },
    layaPlace: { params: [P('item', 'string')], build: a => {
        const t = s(a[0]);
        if (!(PLACE_ITEMS as readonly string[]).includes(t)) return `Error: unknown place item ${t} (${PLACE_ITEMS.join(', ')}).`;
        return { kind: 'job', job: { kind: 'place', item: t as PlaceItem } };
    } },
};

export function containsLegacyCommand(message: string): boolean {
    return commandRegex.test(message);
}

/** parseLegacy: a Command, or an error message for andy to say (never evaluated). */
export function parseLegacy(message: string, from = ''): Command | string {
    const m = message.match(commandRegex);
    if (!m) return 'Command is incorrectly formatted';
    const name = m[1]!;
    const spec = LEGACY_COMMANDS[name];
    if (!spec) return `!${name} is not a command.`;
    const raw = m[2] ? (m[2].match(argRegex) ?? []) : [];
    const required = spec.params.filter(p => !p.optional).length;
    if (raw.length < required || raw.length > spec.params.length) {
        const want = required === spec.params.length ? `${required}` : `${required}-${spec.params.length}`;
        return `Command !${name} was given ${raw.length} args, but requires ${want} args.`;
    }
    const args: Arg[] = [];
    for (let i = 0; i < raw.length; i++) {
        const p = spec.params[i]!;
        let v = raw[i]!.trim();
        if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
        let arg: Arg = v;
        if (p.type === 'int') arg = Number.parseInt(v);
        else if (p.type === 'float') arg = Number.parseFloat(v);
        else if ((p.type === 'ItemName' || p.type === 'BlockName') && (v.endsWith('plank') || v.endsWith('seed'))) arg = v + 's';
        if (typeof arg === 'number') {
            if (Number.isNaN(arg)) return `Error: Param '${p.name}' must be of type ${p.type}.`;
            if (p.domain && !(arg >= p.domain[0] && arg < p.domain[1])) return `Error: Param '${p.name}' must be an element of [${p.domain[0]}, ${p.domain[1]}).`;
        }
        args.push(arg);
    }
    return spec.build(args, from);
}
